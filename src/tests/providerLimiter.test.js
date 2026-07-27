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
    await new Promise(resolve => releases.push(resolve));
    active -= 1;
  });

  const pending = [task(), task(), task()];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(limiter.status().active, 1);
  assert.equal(limiter.status().queued, 2);

  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
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
