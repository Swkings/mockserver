import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import yaml from 'js-yaml';
import { createRoutes } from '../routes.js';
import { moveEnvironmentEntry } from '../../shared/environmentLayout.js';
import { Store } from '../store.js';

function setupStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockserver-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('legacy projects share migrated environments and keep service overrides after restart', (t) => {
  const dir = setupStore(t);
  const environments = [{ id: 'old-test', name: 'Test', host: 'https://test.example.test' }];
  fs.writeFileSync(path.join(dir, 'projects.yaml'), yaml.dump({
    projects: [
      { id: 'orders', environments, clientHeaders: { 'x-foo': 'orders' }, clientCookies: { token: 'orders' } },
      { id: 'users', environments },
    ],
  }));

  const store = new Store(dir);
  assert.equal(store.projects[0].activeEnvironmentId, store.projects[1].activeEnvironmentId);
  assert.equal(store.projects[0].environments, undefined);
  assert.equal(store.projects[0].clientHeaders['x-foo'], 'orders');
  assert.equal(store.projects[0].clientCookies.token, 'orders');
  const environment = store.listEnvironments().find((env) => env.id === 'old-test');
  assert.deepEqual(Object.keys(environment.nodePorts), ['orders', 'users']);

  store.upsertEnvironment({ ...environment, nodePorts: { orders: { ip: '127.0.0.1', port: 30201 } } });
  store.upsertProject({ ...store.projects[0], serviceKey: 'catalog' });
  const reopened = new Store(dir);
  const saved = reopened.listEnvironments().find((env) => env.id === 'old-test');
  assert.deepEqual(saved.nodePorts.catalog, { ip: '127.0.0.1', port: 30201, protocol: 'http' });
  assert.equal(saved.nodePorts.orders, undefined);
  assert.throws(() => reopened.upsertProject({ id: 'duplicate', serviceKey: 'catalog' }), /已被其他项目使用/);
  assert.throws(() => reopened.deleteEnvironment(saved.id), /仍被项目使用/);
  const portable = yaml.load(reopened.exportProject('orders'));
  assert.equal(portable.environments[0].nodePorts.catalog.port, 30201);
});

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return server.address().port;
}

test('HTTP uses a shared environment gateway and skips its cookies in NodePort mode', async (t) => {
  const store = new Store(setupStore(t));
  store.upsertProject({ id: 'orders', clientApis: [{
    id: 'get-order', method: 'GET', url: '/orders/{id}', pathParams: { id: '12' },
    headers: { 'X-LEVEL': 'api', Cookie: 'shared=api' },
  }], clientHeaders: { 'x-level': 'service', 'x-overrides': 'service' }, clientCookies: { session: 'service' } });

  const target = (name) => http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ name, url: req.url, headers: req.headers }));
  });
  const gatewayPort = await listen(t, target('gateway'));
  const directPort = await listen(t, target('direct'));
  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(store, { syncAll() {} }));
  const controlPort = await listen(t, http.createServer(app));
  const base = `http://127.0.0.1:${controlPort}/api`;
  async function request(method, url, data, status = 200) {
    const response = await fetch(base + url, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(response.status, status);
    return response.json();
  }
  const environment = await request('POST', '/environments', {
    name: 'Test', host: `http://127.0.0.1:${gatewayPort}`,
    headers: { 'x-level': 'environment', 'X-Overrides': 'environment', 'x-common': 'environment', Cookie: 'legacy=environment' },
    cookies: { shared: 'environment', gateway: 'environment', session: 'environment' },
    nodePorts: { orders: { ip: '127.0.0.1', port: directPort } },
  });
  await request('PUT', '/projects/orders', { ...store.getProject('orders'), activeEnvironmentId: environment.id });
  const sendPath = '/client-apis/orders/get-order/send';
  let result = JSON.parse((await request('POST', sendPath, {})).body);
  assert.equal(result.name, 'gateway');
  assert.equal(result.url, '/orders/12');
  assert.equal(result.headers['x-level'], 'api');
  assert.equal(result.headers['x-overrides'], 'service');
  assert.equal(result.headers['x-common'], 'environment');
  for (const cookie of ['legacy=environment', 'gateway=environment', 'shared=api', 'session=service']) {
    assert.ok(result.headers.cookie.split('; ').includes(cookie));
  }

  await request('PUT', '/projects/orders', { ...store.getProject('orders'), nodePortEnabled: true });
  result = JSON.parse((await request('POST', sendPath, {
    url: `http://127.0.0.1:${gatewayPort}/orders/12`, proxy: true,
  })).body);
  assert.equal(result.name, 'direct');
  assert.equal(result.url, '/orders/12');
  assert.equal(result.headers['x-common'], 'environment');
  assert.deepEqual(result.headers.cookie.split('; ').sort(), ['session=service', 'shared=api']);

  await request('PUT', `/environments/${environment.id}`, { ...environment, nodePorts: {} });
  const missing = await request('POST', sendPath, {}, 400);
  assert.match(missing.error, /配置 NodePort/);
});

test('environment folders preserve order and references across restart and configuration import', (t) => {
  const store = new Store(setupStore(t));
  store.upsertProject({ id: 'orders' });
  const qa = store.upsertEnvironment({
    name: 'QA',
    grpcTarget: 'gateway.example.test:50051',
    nodePorts: { orders: { ip: '192.0.2.1', port: 30080, grpc: { ip: '192.0.2.2', port: 30551, protocol: 'https' } } },
  });
  store.upsertProject({ ...store.getProject('orders'), activeEnvironmentId: qa.id });

  const initial = store.getEnvironmentLayout();
  const grouped = [...initial.layout, { type: 'folder', id: 'nonprod', name: 'Non-production', children: [
    { type: 'folder', id: 'nested', name: 'Testing', children: [] },
  ] }];
  const moved = moveEnvironmentEntry(grouped, qa.id, 'nested', 'inside');
  const ordered = moveEnvironmentEntry(moved, 'nonprod', 'local', 'before');
  const saved = store.updateEnvironmentLayout(ordered, initial.revision);

  assert.equal(moveEnvironmentEntry(saved.layout, 'nonprod', 'nested', 'inside'), null);
  assert.throws(() => store.updateEnvironmentLayout(initial.layout, initial.revision), { status: 409 });
  assert.throws(() => store.updateEnvironmentLayout([...saved.layout, saved.layout[0]], saved.revision), /结构无效/);

  const restarted = new Store(path.dirname(store.configFile));
  assert.deepEqual(restarted.getEnvironmentLayout(), saved);
  assert.equal(restarted.getProject('orders').activeEnvironmentId, qa.id);
  assert.deepEqual(restarted.listEnvironments().find(({ id }) => id === qa.id).nodePorts.orders.grpc, {
    ip: '192.0.2.2', port: 30551, protocol: 'https',
  });

  const imported = new Store(setupStore(t));
  const privateEnvironment = imported.upsertEnvironment({ name: 'Private environment' });
  imported.importConfig(restarted.exportConfig(), { merge: true });
  assert.deepEqual(imported.getEnvironmentLayout().layout, [...saved.layout, { type: 'environment', id: privateEnvironment.id }]);
  assert.equal(imported.getProject('orders').activeEnvironmentId, qa.id);
});

test('environment names are unique across creation, renaming and configuration import', (t) => {
  const store = new Store(setupStore(t));
  const qa = store.upsertEnvironment({ name: 'QA' });
  assert.throws(() => store.upsertEnvironment({ name: '  qa  ' }), { status: 409 });
  const dev = store.upsertEnvironment({ name: 'Dev' });
  assert.throws(() => store.upsertEnvironment({ ...dev, name: 'Qa' }), { status: 409 });
  assert.equal(store.upsertEnvironment({ ...qa, name: 'qa' }).id, qa.id);
  assert.throws(() => store.importConfig({
    environments: [{ id: 'imported-qa', name: 'QA' }],
  }, { merge: true }), { status: 409 });
  assert.equal(store.listEnvironments().length, 3);
});
