import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_ACTIVITY_STORAGE_KEY,
  readProjectActivity,
  removeProjectActivity,
  resolveProjectActivity,
  writeProjectActivity,
} from '../../client/src/utils/projectActivity.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const project = {
  apis: [{ id: 'http-mock-1' }],
  clientApis: [{ id: 'http-client-1' }],
  grpcMocks: [{ id: 'grpc-mock-1' }],
  grpcClients: [{ id: 'grpc-client-1' }],
};

test('project activity resolves the saved type, item, view, and location', () => {
  assert.deepEqual(resolveProjectActivity(project, {
    type: 'grpc-client',
    itemId: 'grpc-client-1',
    mainView: 'record',
    location: 'settings',
  }), {
    type: 'grpc-client',
    itemId: 'grpc-client-1',
    mainView: 'record',
    location: 'settings',
  });
});

test('project activity falls back safely when the saved item was deleted', () => {
  assert.deepEqual(resolveProjectActivity(project, {
    type: 'grpc-mock',
    itemId: 'deleted',
  }), {
    type: 'grpc-mock',
    itemId: 'grpc-mock-1',
    mainView: 'edit',
    location: 'item',
  });

  assert.deepEqual(resolveProjectActivity({ apis: [], clientApis: project.clientApis }, {
    type: 'grpc-mock',
    itemId: 'deleted',
  }), {
    type: 'client-api',
    itemId: 'http-client-1',
    mainView: 'edit',
    location: 'item',
  });
});

test('project activity storage is isolated by project id', () => {
  const storage = memoryStorage();
  writeProjectActivity('project-a', { type: 'api', itemId: 'a' }, storage);
  writeProjectActivity('project-b', { type: 'grpc-client', itemId: 'b' }, storage);

  assert.deepEqual(readProjectActivity('project-a', storage), { type: 'api', itemId: 'a' });
  assert.deepEqual(readProjectActivity('project-b', storage), { type: 'grpc-client', itemId: 'b' });

  removeProjectActivity('project-a', storage);
  assert.equal(readProjectActivity('project-a', storage), null);
  assert.ok(storage.getItem(PROJECT_ACTIVITY_STORAGE_KEY));
});
