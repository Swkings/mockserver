import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterGrpcMethods,
  findMatchingGrpcItem,
  moveGrpcMethodIndex,
  sortGrpcMethods,
} from '../../client/src/utils/grpc.js';

test('sortGrpcMethods orders method names alphabetically without mutating input', () => {
  const methods = [
    { name: 'WatchOrders' },
    { name: 'createOrder' },
    { name: 'CancelOrder' },
  ];

  const sorted = sortGrpcMethods(methods);

  assert.deepEqual(sorted.map((method) => method.name), ['CancelOrder', 'createOrder', 'WatchOrders']);
  assert.deepEqual(methods.map((method) => method.name), ['WatchOrders', 'createOrder', 'CancelOrder']);
});

test('filterGrpcMethods filters the alphabetized method list by name, key, or path', () => {
  const methods = [
    { name: 'WatchOrders', key: 'watchOrders', path: '/shop.Order/WatchOrders' },
    { name: 'CreateOrder', key: 'createOrder', path: '/shop.Order/CreateOrder' },
    { name: 'CancelOrder', key: 'cancelOrder', path: '/shop.Order/CancelOrder' },
  ];

  assert.deepEqual(
    filterGrpcMethods(methods, 'order').map((method) => method.name),
    ['CancelOrder', 'CreateOrder', 'WatchOrders']
  );
  assert.deepEqual(
    filterGrpcMethods(methods, 'watch').map((method) => method.name),
    ['WatchOrders']
  );
});

test('moveGrpcMethodIndex wraps keyboard navigation through filtered methods', () => {
  assert.equal(moveGrpcMethodIndex(-1, 3, 1), 0);
  assert.equal(moveGrpcMethodIndex(0, 3, -1), 2);
  assert.equal(moveGrpcMethodIndex(2, 3, 1), 0);
  assert.equal(moveGrpcMethodIndex(0, 0, 1), -1);
});

test('findMatchingGrpcItem keeps the same RPC method across Server and Client', () => {
  const clientItems = [
    { id: 'client-create', packageName: 'shop', serviceName: 'Order', methodName: 'CreateOrder' },
    { id: 'client-cancel', packageName: 'shop', serviceName: 'Order', methodName: 'CancelOrder' },
  ];
  const serverItem = {
    id: 'server-cancel',
    packageName: 'shop',
    serviceName: 'Order',
    methodName: 'CancelOrder',
  };

  assert.equal(findMatchingGrpcItem(clientItems, serverItem)?.id, 'client-cancel');
});

test('findMatchingGrpcItem does not guess when a method name is ambiguous', () => {
  const clientItems = [
    { id: 'client-a', packageName: 'one', serviceName: 'First', methodName: 'Sync' },
    { id: 'client-b', packageName: 'two', serviceName: 'Second', methodName: 'Sync' },
  ];

  assert.equal(findMatchingGrpcItem(clientItems, { methodName: 'Sync' }), null);
});

test('findMatchingGrpcItem restores the preferred duplicate method item', () => {
  const clientItems = [
    { id: 'client-first', packageName: 'shop', serviceName: 'Order', methodName: 'Sync', request: '{"value":1}' },
    { id: 'client-saved', packageName: 'shop', serviceName: 'Order', methodName: 'Sync', request: '{"value":2}' },
  ];
  const serverItem = { packageName: 'shop', serviceName: 'Order', methodName: 'Sync' };

  assert.equal(findMatchingGrpcItem(clientItems, serverItem, 'client-saved')?.id, 'client-saved');
  assert.equal(findMatchingGrpcItem(clientItems, serverItem, 'client-saved')?.request, '{"value":2}');
});
