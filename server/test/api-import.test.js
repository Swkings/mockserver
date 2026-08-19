import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importCurlCommand,
  importOpenApiDocument,
  parseCurlCommand,
} from '../../client/src/utils/apiImport.js';

test('imports OpenAPI 3 operations as HTTP Client APIs', () => {
  const document = {
    openapi: '3.0.3',
    info: { title: 'Pet Service' },
    servers: [{ url: 'https://api.example.com/v1' }],
    paths: {
      '/pets/{petId}': {
        parameters: [{ in: 'path', name: 'petId', required: true, schema: { type: 'string', example: 'pet-1' }, description: 'Pet ID' }],
        post: {
          summary: 'Update pet',
          parameters: [{ in: 'query', name: 'notify', schema: { type: 'boolean', default: true } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string', example: 'Milo' } } },
              },
            },
          },
          responses: { 204: { description: 'Updated' } },
        },
      },
    },
  };

  const result = importOpenApiDocument(document, { type: 'client-api', folderId: 'pets', idFactory: () => 'client-1' });
  assert.equal(result.host, 'https://api.example.com');
  assert.equal(result.title, 'Pet Service');
  assert.deepEqual(result.items, [{
    id: 'client-1',
    name: 'Update pet',
    method: 'POST',
    url: '/v1/pets/{petId}',
    headers: { 'Content-Type': 'application/json' },
    useProjectHeaders: true,
    useProjectCookies: true,
    proxy: false,
    insecureTls: false,
    body: '{\n  "name": "Milo"\n}',
    allowGetBody: false,
    description: 'Update pet',
    folderId: 'pets',
    pathParams: { petId: 'pet-1' },
    pathParamDescriptions: { petId: 'Pet ID' },
    queryParams: { notify: 'true' },
    queryParamDescriptions: undefined,
  }]);
});

test('imports Swagger 2 response examples as HTTP Mock APIs', () => {
  const document = {
    swagger: '2.0',
    info: { title: 'Legacy API' },
    schemes: ['https'],
    host: 'legacy.example.com',
    basePath: '/api',
    produces: ['application/json'],
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          responses: {
            200: {
              description: 'OK',
              schema: { type: 'object', properties: { id: { type: 'integer', example: 7 } } },
            },
          },
        },
      },
    },
  };

  const result = importOpenApiDocument(document, { type: 'api', idFactory: () => 'mock-1' });
  assert.equal(result.host, 'https://legacy.example.com');
  assert.equal(result.items[0].name, 'getUser');
  assert.deepEqual(result.items[0].match, { method: 'GET', path: '/api/users/{id}', headers: undefined });
  assert.equal(result.items[0].response.status, 200);
  assert.equal(result.items[0].response.body, '{\n  "id": 7\n}');
});

test('parses a multiline cURL command without executing it', () => {
  const parsed = parseCurlCommand(`curl -X PATCH 'https://api.example.com/users/42?notify=true' \\
    -H 'Content-Type: application/json' \\
    -H 'X-Trace: a:b' \\
    -b 'sid=abc' \\
    --data-raw '{"name":"Ada Lovelace"}'`);

  assert.deepEqual(parsed, {
    method: 'PATCH',
    host: 'https://api.example.com',
    path: '/users/42',
    queryParams: { notify: 'true' },
    headers: {
      'Content-Type': 'application/json',
      'X-Trace': 'a:b',
      Cookie: 'sid=abc',
    },
    body: '{"name":"Ada Lovelace"}',
  });
});

test('creates a Client API from cURL and infers POST when data is present', () => {
  const result = importCurlCommand("curl 'http://localhost:9000/items?q=one' -d 'name=demo'", {
    type: 'client-api',
    idFactory: () => 'curl-1',
  });
  assert.equal(result.host, 'http://localhost:9000');
  assert.equal(result.items[0].method, 'POST');
  assert.equal(result.items[0].url, '/items');
  assert.deepEqual(result.items[0].queryParams, { q: 'one' });
  assert.equal(result.items[0].body, 'name=demo');
});

test('supports compact cURL request, header, and data flags', () => {
  const parsed = parseCurlCommand("curl -XPOST -H'Content-Type: application/json' --data-raw='{\"ok\":true}' https://example.com/check");
  assert.equal(parsed.method, 'POST');
  assert.deepEqual(parsed.headers, { 'Content-Type': 'application/json' });
  assert.equal(parsed.body, '{"ok":true}');
  assert.equal(parsed.path, '/check');
});

test('rejects text that is not a cURL command', () => {
  assert.throws(() => parseCurlCommand('wget https://example.com'), /curl/);
});
