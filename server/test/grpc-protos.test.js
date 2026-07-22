import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectGrpcProtos, resolveProjectGrpcConfig } from '../utils/grpcProtos.js';

const proto = 'syntax = "proto3"; service Demo { rpc Ping(Req) returns (Req); } message Req {}';

test('legacy method-level protos migrate to one shared project proto', () => {
  let nextId = 0;
  const normalized = normalizeProjectGrpcProtos({
    grpcMocks: [{ id: 'mock', proto, protoFilename: 'demo.proto' }],
    grpcClients: [{ id: 'client', proto, protoFilename: 'demo.proto' }],
  }, () => 'proto-' + (++nextId));

  assert.equal(normalized.protos.length, 1);
  assert.equal(normalized.grpcMocks[0].protoId, 'proto-1');
  assert.equal(normalized.grpcClients[0].protoId, 'proto-1');
  assert.equal('proto' in normalized.grpcMocks[0], false);
  assert.equal('protoFilename' in normalized.grpcClients[0], false);
});

test('project proto references resolve to runtime configs', () => {
  const project = { protos: [{ id: 'shared', name: 'Demo', filename: 'demo.proto', content: proto }] };
  const resolved = resolveProjectGrpcConfig(project, { id: 'method', protoId: 'shared', methodName: 'Ping' });
  assert.equal(resolved.proto, proto);
  assert.equal(resolved.protoFilename, 'demo.proto');
  assert.throws(
    () => resolveProjectGrpcConfig(project, { id: 'missing', protoId: 'unknown' }),
    /未关联 Proto/
  );
});

test('existing project proto references stay attached during normalization', () => {
  const normalized = normalizeProjectGrpcProtos({
    protos: [{ id: 'shared', name: 'Demo', filename: 'demo.proto', content: proto }],
    grpcMocks: [{ id: 'mock', protoId: 'shared' }],
    grpcClients: [{ id: 'client', protoId: 'shared' }],
  });

  assert.equal(normalized.protos.length, 1);
  assert.equal(normalized.grpcMocks[0].protoId, 'shared');
  assert.equal(normalized.grpcClients[0].protoId, 'shared');
});
