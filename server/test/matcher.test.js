import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRequest, sortApis } from '../matcher.js';

test('matches OpenAPI-style and colon path parameters', () => {
  assert.equal(matchRequest(
    { match: { method: 'GET', path: '/users/{userId}/orders/:orderId' } },
    { method: 'GET', path: '/users/u-1/orders/o-2', headers: {} },
    ''
  ), true);
  assert.equal(matchRequest(
    { match: { method: 'GET', path: '/users/{userId}/orders/:orderId' } },
    { method: 'GET', path: '/users/u-1/orders', headers: {} },
    ''
  ), false);
  assert.equal(matchRequest(
    { match: { method: 'GET', path: '/references/urn:example' } },
    { method: 'GET', path: '/references/urn:other', headers: {} },
    ''
  ), false);
});

test('matchRequest matches method and path', () => {
  const api = {
    match: { method: 'POST', path: '/scada/iot-collector/api/v1/task/feedback' },
  };
  const req = { method: 'POST', path: '/scada/iot-collector/api/v1/task/feedback', headers: {} };
  assert.equal(matchRequest(api, req, '{"robotTaskCode":"88697"}'), true);
});

test('matchRequest rejects wrong method', () => {
  const api = {
    match: { method: 'POST', path: '/task/feedback' },
  };
  const req = { method: 'GET', path: '/task/feedback', headers: {} };
  assert.equal(matchRequest(api, req, ''), false);
});

test('matchRequest supports bodyContains', () => {
  const api = {
    match: { method: 'POST', path: '/flight/task', bodyContains: '88697' },
  };
  const req = { method: 'POST', path: '/flight/task', headers: {} };
  assert.equal(matchRequest(api, req, '{"robotTaskCode":"88697"}'), true);
  assert.equal(matchRequest(api, req, '{"robotTaskCode":"00000"}'), false);
});

test('matchRequest supports jsonMatch', () => {
  const api = {
    match: {
      method: 'POST',
      path: '/flight/task/forcecancel',
      jsonMatch: { applyType: '87' },
    },
  };
  const req = { method: 'POST', path: '/flight/task/forcecancel', headers: {} };
  assert.equal(matchRequest(api, req, '{"robotTaskCode":"88697","applyType":"87"}'), true);
});

test('sortApis orders by priority desc', () => {
  const apis = [{ name: 'a', priority: 1 }, { name: 'b', priority: 10 }];
  assert.equal(sortApis(apis)[0].name, 'b');
});
