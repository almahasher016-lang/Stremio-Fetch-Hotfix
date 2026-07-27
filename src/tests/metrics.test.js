import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderMetrics, prometheusMetrics, recordProviderCall } from '../utils/metrics.js';

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

test('provider metrics expose deterministic p50 and p95 latency', () => {
  const provider = 'metrics-percentiles';
  for (const ms of [100, 200, 300, 900]) {
    recordProviderCall(provider, { ok: true, count: 1, ms });
  }
  const metrics = getProviderMetrics()[provider];
  assert.equal(metrics.p50Ms, 200);
  assert.equal(metrics.p95Ms, 900);
  assert.equal(metrics.totalResults, 4);
  const prometheus = prometheusMetrics();
  assert.match(prometheus, /m7md_provider_duration_ms_p95\{provider="metrics-percentiles"} 900/);
  assert.match(prometheus, /m7md_provider_duration_ms_bucket\{provider="metrics-percentiles",le="\+Inf"} 4/);
});
