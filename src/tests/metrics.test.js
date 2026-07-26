import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderMetrics, recordProviderCall } from '../utils/metrics.js';

test('circuit-breaker skips preserve the underlying provider failure', () => {
  const provider = 'metrics-preserve-root-cause';
  recordProviderCall(provider, {
    ok: false,
    ms: 25,
    error: 'HTTP 429: provider quota exceeded',
  });
  recordProviderCall(provider, {
    ok: false,
    error: 'circuit-breaker-open',
  });

  const metrics = getProviderMetrics()[provider];
  assert.equal(metrics.fail, 2);
  assert.equal(metrics.lastError, 'HTTP 429: provider quota exceeded');
});
