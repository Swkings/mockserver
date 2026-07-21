import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { GrpcEngine } from '../grpcEngine.js';
import { inspectGrpcProto, invokeGrpc } from '../grpcRuntime.js';

const proto = `syntax = "proto3";
package demo;
service Flow {
  rpc Unary (Message) returns (Message);
  rpc ServerStream (Message) returns (stream Message);
  rpc ClientStream (stream Message) returns (Message);
  rpc Bidi (stream Message) returns (stream Message);
}
message Message { string value = 1; }
`;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for gRPC server');
}

function mock(id, methodName, response) {
  return {
    id,
    name: methodName,
    enabled: true,
    proto,
    protoFilename: 'flow.proto',
    packageName: 'demo',
    serviceName: 'Flow',
    methodName,
    response: JSON.stringify(response),
  };
}

test('inspectGrpcProto reports unary and all streaming modes', () => {
  const [service] = inspectGrpcProto({ proto, protoFilename: 'flow.proto' });
  assert.equal(service.fullName, 'demo.Flow');
  assert.deepEqual(service.methods.map((method) => [method.name, method.requestStream, method.responseStream]), [
    ['Unary', false, false],
    ['ServerStream', false, true],
    ['ClientStream', true, false],
    ['Bidi', true, true],
  ]);
});

test("inspectGrpcProto exposes request field schemas", () => {
  const schemaProto = `syntax = "proto3";
package schema;
message Child { int32 count = 1; }
enum Kind { UNKNOWN = 0; ACTIVE = 1; }
message Request {
  string user_name = 1;
  Child child = 2;
  repeated int64 ids = 3;
  Kind kind = 4;
  map<string, Child> children = 5;
}
service SchemaService { rpc Create(Request) returns(Child); }
`;
  const [service] = inspectGrpcProto({ proto: schemaProto, protoFilename: "schema.proto" });
  const schema = service.methods[0].requestSchema;
  assert.equal(schema.typeName, "schema.Request");
  assert.deepEqual(schema.fields.map((field) => [field.name, field.kind, field.type, field.repeated]), [
    ["userName", "scalar", "string", false],
    ["child", "message", "schema.Child", false],
    ["ids", "scalar", "int64", true],
    ["kind", "enum", "schema.Kind", false],
    ["children", "map", "map", true],
  ]);
  assert.deepEqual(schema.fields[1].message.fields.map((field) => field.name), ["count"]);
  assert.deepEqual(schema.fields[3].values, ["UNKNOWN", "ACTIVE"]);
  assert.equal(schema.fields[4].value.message.fields[0].type, "int32");
  assert.equal(service.methods[0].responseSchema.typeName, "schema.Child");
  assert.deepEqual(service.methods[0].responseSchema.fields.map((field) => [field.name, field.type]), [["count", "int32"]]);
});

test('GrpcEngine and client invoke unary and streaming methods', async (t) => {
  const port = await freePort();
  const project = {
    id: 'grpc-test',
    name: 'gRPC Test',
    grpcEnabled: true,
    grpcHost: '127.0.0.1',
    grpcPort: port,
    grpcMocks: [
      mock('unary', 'Unary', { value: 'unary-response' }),
      mock('server-stream', 'ServerStream', [{ value: 'one' }, { value: 'two' }]),
      mock('client-stream', 'ClientStream', { value: 'collected' }),
      mock('bidi', 'Bidi', [{ value: 'left' }, { value: 'right' }]),
    ],
  };
  const records = [];
  const store = {
    projects: [project],
    getProject: (id) => id === project.id ? project : null,
    addRequest: (record) => records.push(record),
  };
  const engine = new GrpcEngine(store);
  t.after(() => engine.stopProject(project.id));
  engine.syncAll();
  await waitFor(() => engine.status()[0].running);

  const base = {
    proto,
    protoFilename: 'flow.proto',
    packageName: 'demo',
    serviceName: 'Flow',
    target: `127.0.0.1:${port}`,
    timeoutMs: 2000,
  };
  const unary = await invokeGrpc({ ...base, methodName: 'Unary', request: '{"value":"request"}' });
  const serverStream = await invokeGrpc({ ...base, methodName: 'ServerStream', request: '{}' });
  const clientStream = await invokeGrpc({ ...base, methodName: 'ClientStream', request: '[{"value":"a"},{"value":"b"}]' });
  const bidi = await invokeGrpc({ ...base, methodName: 'Bidi', request: '[{"value":"a"}]' });

  assert.deepEqual(unary.response, { value: 'unary-response' });
  assert.deepEqual(serverStream.response, [{ value: 'one' }, { value: 'two' }]);
  assert.deepEqual(clientStream.response, { value: 'collected' });
  assert.deepEqual(bidi.response, [{ value: 'left' }, { value: 'right' }]);
  assert.equal(records.length, 4);
  assert.ok(records.every((record) => record.protocol === 'grpc' && record.responseStatus === 0));
});
