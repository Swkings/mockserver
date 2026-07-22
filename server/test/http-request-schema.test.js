import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHttpRequestSchema, schemaExample } from '../../client/src/utils/httpRequestSchema.js';

test('parses Go structs with json tags, arrays, maps, and nested structs', () => {
  const schema = parseHttpRequestSchema(
    'type Address struct {\n'
      + '  City string `json:"city"`\n'
      + '}\n'
      + 'type CreateUserRequest struct {\n'
      + '  Name string `json:"name"`\n'
      + '  Age int `json:"age,omitempty"`\n'
      + '  Tags []string `json:"tags"`\n'
      + '  Address Address `json:"address"`\n'
      + '  Meta map[string]any `json:"meta"`\n'
      + '}',
    'go'
  );

  assert.equal(schema.typeName, 'CreateUserRequest');
  assert.deepEqual(schema.fields.map((field) => field.name), ['name', 'age', 'tags', 'address', 'meta']);
  assert.equal(schema.fields[1].required, false);
  assert.equal(schema.fields[2].repeated, true);
  assert.equal(schema.fields[3].message.fields[0].name, 'city');
  assert.equal(schema.fields[4].kind, 'map');
});

test('parses TypeScript and Python request models with selectable roots', () => {
  const typescript = parseHttpRequestSchema(
    'interface Address { city: string }\n'
      + 'export interface UserInput {\n'
      + '  name: string;\n'
      + '  age?: number;\n'
      + '  address: Address;\n'
      + '  roles: Array<string>;\n'
      + '}',
    'typescript',
    'UserInput'
  );
  assert.equal(typescript.fields[1].required, false);
  assert.equal(typescript.fields[2].kind, 'message');
  assert.equal(typescript.fields[3].repeated, true);

  const python = parseHttpRequestSchema(
    'class Address(BaseModel):\n'
      + '    city: str\n\n'
      + 'class UserPayload(BaseModel):\n'
      + '    name: str\n'
      + '    age: int | None = None\n'
      + '    address: Address\n'
      + '    tags: list[str]\n',
    'python'
  );
  assert.equal(python.typeName, 'UserPayload');
  assert.equal(python.fields[1].required, false);
  assert.equal(python.fields[2].message.fields[0].type, 'string');
  assert.equal(python.fields[3].repeated, true);
});

test('parses JavaScript objects and JSON and generates an example body', () => {
  const javascript = parseHttpRequestSchema(
    'const createUserRequest = {\n'
      + "  name: 'Alice',\n"
      + '  age: 18,\n'
      + '  active: true,\n'
      + "  address: { city: 'Shanghai' },\n"
      + "  tags: ['admin']\n"
      + '};',
    'javascript'
  );
  assert.deepEqual(javascript.fields.map((field) => field.type), ['string', 'integer', 'boolean', 'object', 'string']);
  assert.equal(javascript.fields[4].repeated, true);

  const json = parseHttpRequestSchema('{"name":"Alice","count":2}', 'auto');
  assert.equal(json.language, 'json');
  assert.deepEqual(schemaExample(json), { name: 'string', count: 0 });
});


test('parses Java DTO fields and auto-detects plain Python models', () => {
  const java = parseHttpRequestSchema(
    'public class CreateOrderRequest {\n'
      + '  private String orderNo;\n'
      + '  private Integer count;\n'
      + '  private List<String> tags;\n'
      + '}',
    'java'
  );
  assert.equal(java.typeName, 'CreateOrderRequest');
  assert.deepEqual(java.fields.map((field) => field.name), ['orderNo', 'count', 'tags']);
  assert.equal(java.fields[2].repeated, true);

  const python = parseHttpRequestSchema('class SearchRequest:\n    keyword: str\n    page: int\n', 'auto');
  assert.equal(python.language, 'python');
  assert.deepEqual(python.fields.map((field) => field.type), ['string', 'integer']);
});
