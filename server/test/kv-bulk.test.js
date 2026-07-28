import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBulkText, rowsToBulkText } from '../../client/src/utils/kvBulk.js';

const newline = String.fromCharCode(10);

test('bulk editor supports equals-separated fields and values', () => {
  assert.deepEqual(parseBulkText('token=abc=123' + newline + 'enabled=true', 'equals'), [
    { key: 'token', value: 'abc=123' },
    { key: 'enabled', value: 'true' },
  ]);

  assert.equal(rowsToBulkText([
    { key: 'token', value: 'abc=123' },
    { key: 'enabled', value: 'true' },
  ], 'equals'), 'token=abc=123' + newline + 'enabled=true');
});

test('bulk editor supports semicolon-separated records', () => {
  assert.deepEqual(parseBulkText('name=mockserver; port=3900;enabled=true;', 'equals'), [
    { key: 'name', value: 'mockserver' },
    { key: 'port', value: '3900' },
    { key: 'enabled', value: 'true' },
  ]);
});

test('bulk editor accepts mixed newline and semicolon record separators', () => {
  assert.deepEqual(parseBulkText('first:1;second:2' + newline + 'third:3', 'colon'), [
    { key: 'first', value: '1' },
    { key: 'second', value: '2' },
    { key: 'third', value: '3' },
  ]);
});
