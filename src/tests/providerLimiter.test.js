import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderLimiter } from '../utils/providerLimiter.js';

test('provider limiter enforces an independent concurrency ceiling', async () => {
  const limiter = new ProviderLimiter('provider', { maxConcurrent: 1 });
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const task = () => limiter.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => {
      releases.push(resolve);
    });
    active -= 1;
  });

  const pending = [task(), task(), task()];
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  assert.equal(limiter.status().active, 1);
  assert.equal(limiter.status().queued, 2);

  releases.shift()();
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  releases.shift()();
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  releases.shift()();
  await Promise.all(pending);
  assert.equal(maxActive, 1);
});

test('provider limiter removes an aborted queued request', async () => {
  const limiter = new ProviderLimiter('provider', { maxConcurrent: 1 });
  let release;
  const first = limiter.run(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController();
  const second = limiter.run(async () => true, { signal: controller.signal });
  controller.abort(new DOMException('deadline', 'AbortError'));
  await assert.rejects(second, error => error?.name === 'AbortError');
  assert.equal(limiter.status().queued, 0);
  release();
  await first;
});

test('provider limiter enforces the configured start interval', async () => {
  const limiter = new ProviderLimiter('provider', {
    maxConcurrent: 1,
    minIntervalMs: 50,
  });
  const starts = [];
  for (let index = 0; index < 3; index += 1) {
    await limiter.run(async () => {
      starts.push(Date.now());
    });
  }
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] - starts[index - 1] >= 45);
  }
  assert.deepEqual(limiter.status(), {
    name: 'provider',
    active: 0,
    queued: 0,
    maxConcurrent: 1,
    minIntervalMs: 50,
    effectiveMaxConcurrent: 1,
    effectiveMinIntervalMs: 50,
    adaptivePenalty: 0,
    blockedUntil: null,
  });
});

test('provider limiter backs off deterministically after overload and recovers on success', () => {
  let clock = 1_000;
  const limiter = new ProviderLimiter('provider', {
    maxConcurrent: 3,
    minIntervalMs: 100,
    now: () => clock,
  });
  limiter.recordOutcome({ ok: false, ms: 500, statusCode: 429, retryAfterMs: 2_000 });
  let status = limiter.status();
  assert.equal(status.adaptivePenalty, 2);
  assert.equal(status.effectiveMaxConcurrent, 1);
  assert.ok(status.effectiveMinIntervalMs > 100);
  assert.equal(status.blockedUntil, 3_000);

  clock = 3_100;
  limiter.recordOutcome({ ok: true, ms: 100 });
  limiter.recordOutcome({ ok: true, ms: 100 });
  status = limiter.status();
  assert.equal(status.adaptivePenalty, 0);
  assert.equal(status.effectiveMaxConcurrent, 3);
  assert.equal(status.effectiveMinIntervalMs, 100);
});

test('provider limiter reduces concurrency after sustained high latency without a failure', () => {
  const limiter = new ProviderLimiter('provider', {
    maxConcurrent: 4,
    minIntervalMs: 0,
    latencyThresholdMs: 500,
  });
  limiter.recordOutcome({ ok: true, ms: 900 });
  limiter.recordOutcome({ ok: true, ms: 900 });
  const status = limiter.status();
  assert.equal(status.adaptivePenalty, 2);
  assert.equal(status.effectiveMaxConcurrent, 1);
});
