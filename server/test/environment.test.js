import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPathParams,
  resolveClientApiUrl as resolveClientUrl,
} from '../../client/src/utils/environment.js';
import { resolveClientApiUrl as resolveServerUrl } from '../utils/environment.js';

test('keeps colon placeholders when path parameter values are empty', () => {
  assert.equal(applyPathParams('/users/:id', { id: '' }), '/users/:id');
  assert.equal(applyPathParams('/users/{id}', { id: '' }), '/users/:id');
  assert.equal(applyPathParams('/users/:id', { id: null }), '/users/:id');
});

test('does not encode a colon placeholder supplied as the parameter value', () => {
  assert.equal(applyPathParams('/users/:id', { id: ':id' }), '/users/:id');
  assert.equal(applyPathParams('/users/{id}', { id: ':id' }), '/users/:id');
});

test('client and server URL resolution preserve empty path parameters', () => {
  const environments = [{ id: 'test', host: 'https://api.example.com' }];
  const clientApi = {
    url: '/users/{id}/orders/:orderId',
    pathParams: { id: '', orderId: ':orderId' },
  };

  assert.equal(resolveClientUrl({
    environments,
    activeEnvironmentId: 'test',
    clientApi,
  }), 'https://api.example.com/users/:id/orders/:orderId');
  assert.equal(resolveServerUrl({
    environments,
    activeEnvironmentId: 'test',
  }, clientApi), 'https://api.example.com/users/:id/orders/:orderId');
});

test('still URL-encodes ordinary path parameter values', () => {
  assert.equal(applyPathParams('/users/:id', { id: 'a/b c' }), '/users/a%2Fb%20c');
});

test('NodePort resolution uses the service key and preserves HTTP path and query', () => {
  const project = {
    activeEnvironmentId: 'test',
    environments: [{
      id: 'test', host: 'https://gateway.example.test/base',
      nodePorts: { orders: { ip: '2001:db8::1', port: 30080, protocol: 'http' } },
    }],
    serviceKey: 'orders',
    nodePortEnabled: true,
  };
  const clientApi = { url: 'https://other.example.test/orders/{id}', pathParams: { id: 'one/two' }, queryParams: { batch: 2 } };
  assert.equal(resolveServerUrl(project, clientApi), 'http://[2001:db8::1]:30080/orders/one%2Ftwo?batch=2');
  assert.equal(resolveClientUrl({ ...project, clientApi }), resolveServerUrl(project, clientApi));
  assert.equal(resolveServerUrl({ ...project, serviceKey: 'missing' }, clientApi), '');
});
