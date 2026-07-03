import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __lockKeyForTests,
  __resetCacheForTests,
  __setRedisClientForTests,
  acquireRefreshLock,
  releaseRefreshLock,
  getCacheStatus,
} from '../cache/redis.js';

class FakeRedis {
  constructor() {
    this.status = 'ready';
    this.map = new Map();
    this.now = 0;
  }

  async connect() {}

  advance(seconds) {
    this.now += seconds;
  }

  cleanup(key) {
    const entry = this.map.get(key);
    if (entry && entry.expiresAt <= this.now) this.map.delete(key);
  }

  async get(key) {
    this.cleanup(key);
    return this.map.get(key)?.value ?? null;
  }

  async set(key, value, ...args) {
    this.cleanup(key);
    const nx = args.includes('NX');
    const exIndex = args.indexOf('EX');
    const ttl = exIndex >= 0 ? Number(args[exIndex + 1]) : 0;
    if (nx && this.map.has(key)) return null;
    this.map.set(key, { value, expiresAt: ttl ? this.now + ttl : Number.POSITIVE_INFINITY });
    return 'OK';
  }

  async eval(_script, _numKeys, key, token) {
    this.cleanup(key);
    const entry = this.map.get(key);
    if (entry?.value === token) {
      this.map.delete(key);
      return 1;
    }
    return 0;
  }
}

test('acquireRefreshLock falls back safely when Redis is not configured', async () => {
  __resetCacheForTests();
  const lock = await acquireRefreshLock('unit-test-lock', 5);
  assert.equal(lock.acquired, true);
  assert.equal(lock.distributed, false);
  await releaseRefreshLock(lock);
  const status = getCacheStatus();
  assert.equal(status.refreshLocks.fallbackLocal >= 1, true);
  __resetCacheForTests();
});

test('Redis refresh lock allows one owner and rejects a second owner', async () => {
  const fake = new FakeRedis();
  __setRedisClientForTests(fake);

  const first = await acquireRefreshLock('same-cache-key', 60);
  const second = await acquireRefreshLock('same-cache-key', 60);

  assert.equal(first.acquired, true);
  assert.equal(first.distributed, true);
  assert.equal(second.acquired, false);
  assert.equal(second.distributed, true);

  await releaseRefreshLock(first);
  __resetCacheForTests();
});

test('Redis refresh lock release does not delete another owner token', async () => {
  const fake = new FakeRedis();
  __setRedisClientForTests(fake);

  const key = 'protected-cache-key';
  const lockKey = __lockKeyForTests(key);
  const owner = await acquireRefreshLock(key, 60);

  await releaseRefreshLock({ ...owner, token: 'wrong-token' });
  assert.equal(await fake.get(lockKey), owner.token);

  const blocked = await acquireRefreshLock(key, 60);
  assert.equal(blocked.acquired, false);

  await releaseRefreshLock(owner);
  assert.equal(await fake.get(lockKey), null);
  __resetCacheForTests();
});

test('Redis refresh lock becomes available again after TTL expiry', async () => {
  const fake = new FakeRedis();
  __setRedisClientForTests(fake);

  const first = await acquireRefreshLock('expiring-cache-key', 2);
  const blocked = await acquireRefreshLock('expiring-cache-key', 2);
  fake.advance(3);
  const afterExpiry = await acquireRefreshLock('expiring-cache-key', 2);

  assert.equal(first.acquired, true);
  assert.equal(blocked.acquired, false);
  assert.equal(afterExpiry.acquired, true);

  await releaseRefreshLock(afterExpiry);
  __resetCacheForTests();
});

test('refresh lock key is sha256 based and stable without long raw identifiers', () => {
  __resetCacheForTests();
  const veryLongKey = `search:${'x'.repeat(500)}`;
  const lockKey = __lockKeyForTests(veryLongKey);
  assert.match(lockKey, /lock:refresh:[a-f0-9]{64}$/);
  assert.equal(lockKey.includes('x'.repeat(160)), false);
});
