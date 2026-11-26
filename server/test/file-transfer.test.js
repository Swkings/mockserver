import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRoutes } from '../routes.js';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('Client API sends multipart and binary files and returns downloadable bytes', async (t) => {
  const received = [];
  const target = express();
  target.post('/upload', express.raw({ type: '*/*' }), (req, res) => {
    received.push({ type: req.headers['content-type'], body: req.body });
    res.set('Content-Disposition', 'attachment; filename="result.bin"');
    res.type('application/octet-stream').send(Buffer.from([0, 255, 1, 2]));
  });
  const upstream = await listen(target);
  t.after(() => upstream.server.close());

  const records = [];
  const store = {
    getProject: () => ({ id: 'project', name: 'Project', clientApis: [{ id: 'api', method: 'POST', url: '/upload', headers: { 'Content-Type': 'application/json' } }] }),
    addRequest: (record) => records.push(record),
  };
  const control = express();
  control.use(express.json({ limit: '40mb' }));
  control.use('/api', createRoutes(store, {}));
  const local = await listen(control);
  t.after(() => local.server.close());

  const file = { name: 'sample.bin', type: 'application/octet-stream', base64: Buffer.from([0, 255, 42]).toString('base64') };
  for (const bodyType of ['multipart', 'binary']) {
    const response = await fetch(`${local.url}/api/client-apis/project/api/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${upstream.url}/upload`, bodyType, fileFieldName: 'document', body: '{"label":"one"}', file }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(result.download.base64, 'base64'), Buffer.from([0, 255, 1, 2]));
    assert.equal(result.download.contentDisposition, 'attachment; filename="result.bin"');
  }
  assert.match(received[0].type, /^multipart\/form-data; boundary=/);
  assert.match(received[0].body.toString(), /name="document"; filename="sample.bin"/);
  assert.match(received[0].body.toString(), /name="label"/);
  assert.equal(received[1].type, 'application/octet-stream');
  assert.deepEqual(received[1].body, Buffer.from([0, 255, 42]));
  assert.ok(records.every((record) => !record.body.includes(file.base64) && !record.responseBody.includes('ÿ')));
});
