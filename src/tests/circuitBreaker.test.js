import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../utils/circuitBreaker.js';

test('circuit breaker permits one half-open probe and exponentially backs off after probe failure', () => {
  let now = 1_000;
  const breaker = new CircuitBreaker('provider', {
    limit: 2,
    resetMs: 100,
    maxResetMs: 800,
    now: () => now,
  });

  assert.equal(breaker.tryAcquire(), true);
  breaker.recordFailure();
  assert.equal(breaker.tryAcquire(), true);
  breaker.recordFailure();
  assert.equal(breaker.status().state, 'open');
  assert.equal(breaker.status().resetMs, 100);
  assert.equal(breaker.tryAcquire(), false);

  now += 100;
  assert.equal(breaker.tryAcquire(), true);
  assert.equal(breaker.status().state, 'half-open');
  assert.equal(breaker.tryAcquire(), false);
  breaker.recordFailure();
  assert.equal(breaker.status().state, 'open');
  assert.equal(breaker.status().resetMs, 200);

  now += 200;
  assert.equal(breaker.tryAcquire(), true);
  breaker.recordSuccess();
  assert.equal(breaker.status().state, 'closed');
  assert.equal(breaker.status().failures, 0);
});

test('circuit breaker manual reset closes the breaker immediately', () => {
  const breaker = new CircuitBreaker('provider', { limit: 1 });
  breaker.recordFailure();
  assert.equal(breaker.status().state, 'open');
  breaker.reset();
  assert.equal(breaker.status().state, 'closed');
  assert.equal(breaker.tryAcquire(), true);
});
