import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderCycle } from '../services/subtitleServiceCore.js';

// These pure policy assertions protect the cache decision contract used by v4.4.1.
test('healthy provider cycle is complete even when some providers return a valid empty list', () => {
  assert.equal(classifyProviderCycle({ attempted: 4, succeeded: 4, failed: 0 }), 'complete');
});

test('mixed provider success and failure is degraded', () => {
  assert.equal(classifyProviderCycle({ attempted: 4, succeeded: 3, failed: 1 }), 'degraded');
});

test('all attempted provider calls failing is failed', () => {
  assert.equal(classifyProviderCycle({ attempted: 3, succeeded: 0, failed: 3 }), 'failed');
});
