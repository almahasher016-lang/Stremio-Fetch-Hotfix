import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { assertAdminAuth } from '../api/middleware/adminAuth.js';

function request(headers = {}, extra = {}) {
  return { headers, query: {}, body: {}, ...extra };
}

test('administrator authentication accepts bearer and dedicated header tokens', () => {
  assert.doesNotThrow(() => assertAdminAuth(request({
    authorization: `Bearer ${config.admin.token}`,
  })));
  assert.doesNotThrow(() => assertAdminAuth(request({
    'x-admin-token': config.admin.token,
  })));
});

test('administrator authentication rejects missing, invalid, query, and body tokens', () => {
  for (const req of [
    request(),
    request({ 'x-admin-token': 'wrong' }),
    request({}, { query: { token: config.admin.token } }),
    request({}, { body: { token: config.admin.token } }),
  ]) {
    assert.throws(() => assertAdminAuth(req), error => error?.status === 401);
  }
});
