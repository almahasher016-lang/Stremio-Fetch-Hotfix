import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RedisRateLimitStore,
  __resetRateLimitRedisForTests,
  __setRateLimitRedisForTests,
} from '../cache/rateLimitStore.js';

test.afterEach(() => __resetRateLimitRedisForTests());

test('RedisRateLimitStore returns shared hit count and reset time', async () => {
  const calls = [];
  __setRateLimitRedisForTests({
    status: 'ready',
    async eval(...args) { calls.push(args); return [3, 4_000]; },
    async del() { return 1; },
  });
  const store = new RedisRateLimitStore('public');
  store.init({ windowMs: 5_000 });
  const before = Date.now();
  const result = await store.increment('203.0.113.10');
  assert.equal(result.totalHits, 3);
  assert.ok(result.resetTime.getTime() >= before + 3_900);
  assert.match(calls[0][2], /ratelimit:public:203\.0\.113\.10$/);
});

test('RedisRateLimitStore supports decrement and reset', async () => {
  let evalCalls = 0;
  let deleted = '';
  __setRateLimitRedisForTests({
    status: 'ready',
    async eval() { evalCalls += 1; return 0; },
    async del(key) { deleted = key; return 1; },
  });
  const store = new RedisRateLimitStore('admin-write');
  await store.decrement('client');
  await store.resetKey('client');
  assert.equal(evalCalls, 1);
  assert.match(deleted, /ratelimit:admin-write:client$/);
});
