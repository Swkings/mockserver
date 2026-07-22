import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_RECORD_STORAGE_PREFIX,
  clearAllRequestRecords,
  clearProjectRequestRecords,
  mergeRequestRecords,
  readProjectRequestRecords,
  writeProjectRequestRecords,
} from '../../client/src/utils/requestRecords.js';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

const records = [
  { id: 'older', projectId: 'project-a', matchedApiId: 'api-a', timestamp: '2026-01-01T00:00:00.000Z' },
  { id: 'newer', projectId: 'project-a', matchedApiId: 'api-b', timestamp: '2026-01-02T00:00:00.000Z' },
];

test('request records merge newest-first and deduplicate by id', () => {
  const updated = { ...records[0], responseStatus: 201 };
  assert.deepEqual(mergeRequestRecords(records, [updated]), [records[1], updated]);
  assert.equal(mergeRequestRecords(records, [], 1).length, 1);
});

test('request records persist and clear per project or API', () => {
  const storage = memoryStorage();
  writeProjectRequestRecords('project-a', records, storage);
  writeProjectRequestRecords('project-b', [{ ...records[0], id: 'other', projectId: 'project-b' }], storage);

  assert.deepEqual(readProjectRequestRecords('project-a', storage), [records[1], records[0]]);
  clearProjectRequestRecords('project-a', 'api-a', storage);
  assert.deepEqual(readProjectRequestRecords('project-a', storage), [records[1]]);

  clearProjectRequestRecords('project-a', undefined, storage);
  assert.deepEqual(readProjectRequestRecords('project-a', storage), []);
  assert.equal(readProjectRequestRecords('project-b', storage).length, 1);

  clearAllRequestRecords(storage);
  assert.equal(storage.getItem(REQUEST_RECORD_STORAGE_PREFIX + 'project-b'), null);
});
