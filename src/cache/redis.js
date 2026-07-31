import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { recordCache, recordRefreshLock, getCacheMetrics } from '../utils/metrics.js';
import {
  __resetSharedRedisClientForTests,
  __setSharedRedisClientForTests,
  closeSharedRedisClient,
  getSharedRedisClient,
} from './redisClient.js';

const memory = new Map();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeKey(key) {
  return `${config.cache.keyPrefix}:${key}`;
}

function safeLockKey(key) {
  const digest = createHash('sha256').update(String(key)).digest('hex');
  return `lock:refresh:${digest}`;
}

function wrap(value, ttlSeconds, staleSeconds = config.cache.staleSeconds) {
  const now = nowSeconds();
  return {
    __cacheV: 2,
    value,
    createdAt: now,
    expiresAt: now + ttlSeconds,
    staleAt: now + ttlSeconds + staleSeconds,
  };
}

function unwrap(raw, { allowStale = false } = {}) {
  if (!raw) return null;
  const entry = raw.__cacheV ? raw : { __cacheV: 1, value: raw, expiresAt: 0, staleAt: 0 };
  const now = nowSeconds();
  if (entry.expiresAt > now) return { hit: true, stale: false, value: entry.value, entry };
  if (allowStale && entry.staleAt > now) return { hit: true, stale: true, value: entry.value, entry };
  return null;
}

function pruneMemory() {
  const now = nowSeconds();
  for (const [key, entry] of memory) {
    const staleAt = entry?.staleAt || entry?.expiresAt || 0;
    if (staleAt <= now) memory.delete(key);
  }
  while (memory.size > config.cache.memoryMaxItems) {
    const oldestKey = memory.keys().next().value;
    if (!oldestKey) break;
    memory.delete(oldestKey);
  }
}

export async function cacheGetEntry(key, options = {}) {
  const fullKey = normalizeKey(key);
  const cached = unwrap(memory.get(fullKey), options);
  if (cached) {
    recordCache(cached.stale ? 'memory-stale' : 'memory-hit');
    return { ...cached, source: 'memory' };
  }
  if (memory.has(fullKey)) memory.delete(fullKey);

  const client = await getSharedRedisClient();
  if (!client) {
    recordCache('miss');
    return null;
  }
  try {
    const raw = await client.get(fullKey);
    const parsed = raw ? JSON.parse(raw) : null;
    const fromRedis = unwrap(parsed, options);
    if (!fromRedis) {
      recordCache('miss');
      return null;
    }
    memory.set(fullKey, fromRedis.entry);
    pruneMemory();
    recordCache(fromRedis.stale ? 'redis-stale' : 'redis-hit');
    return { ...fromRedis, source: 'redis' };
  } catch (err) {
    recordCache('error');
    console.warn('[cache:get]', err.message);
    return null;
  }
}

export async function cacheGet(key) {
  const found = await cacheGetEntry(key);
  return found ? found.value : null;
}

export async function cacheSet(key, value, ttlSeconds = config.cache.ttlSeconds, staleSeconds = config.cache.staleSeconds) {
  const fullKey = normalizeKey(key);
  const entry = wrap(value, ttlSeconds, staleSeconds);
  memory.set(fullKey, entry);
  pruneMemory();
  recordCache('set');

  const client = await getSharedRedisClient();
  if (!client) return;
  try {
    const redisTtl = Math.max(1, ttlSeconds + staleSeconds);
    await client.set(fullKey, JSON.stringify(entry), 'EX', redisTtl);
  } catch (err) {
    recordCache('error');
    console.warn('[cache:set]', err.message);
  }
}

export async function clearCache(scope = 'all') {
  const normalizedScope = String(scope || 'all').toLowerCase();
  if (!['all', 'search', 'encoding'].includes(normalizedScope)) {
    throw new Error('Unsupported cache scope');
  }
  const prefix = `${config.cache.keyPrefix}:`;
  const scopedPrefix = normalizedScope === 'all' ? prefix : `${prefix}${normalizedScope}:`;
  let memoryDeleted = 0;
  for (const key of memory.keys()) {
    if (!key.startsWith(scopedPrefix)) continue;
    memory.delete(key);
    memoryDeleted += 1;
  }

  const client = await getSharedRedisClient();
  if (!client) return { scope: normalizedScope, memoryDeleted, redisDeleted: 0 };
  let redisDeleted = 0;
  try {
    let cursor = '0';
    const pattern = `${scopedPrefix}*`;
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = String(nextCursor);
      if (keys.length) {
        redisDeleted += Number(await client.del(...keys)) || 0;
      }
    } while (cursor !== '0');
    return { scope: normalizedScope, memoryDeleted, redisDeleted };
  } catch (err) {
    recordCache('error');
    console.warn('[cache:clear]', err.message);
    throw err;
  }
}

export async function acquireRefreshLock(key, ttlSeconds = config.cache.refreshLockTtlSeconds) {
  const client = await getSharedRedisClient();
  if (!client) {
    recordRefreshLock('fallback-local');
    return { acquired: true, distributed: false, key: null, token: null };
  }

  const fullKey = normalizeKey(safeLockKey(key));
  const token = randomUUID();
  try {
    const result = await client.set(fullKey, token, 'NX', 'EX', Math.max(1, ttlSeconds));
    if (result === 'OK') {
      recordRefreshLock('redis-acquired');
      return { acquired: true, distributed: true, key: fullKey, token };
    }
    recordRefreshLock('redis-skipped');
    return { acquired: false, distributed: true, key: fullKey, token: null };
  } catch (err) {
    recordRefreshLock('redis-error');
    console.warn('[cache:refresh-lock]', err.message);
    return { acquired: true, distributed: false, key: null, token: null, fallback: true };
  }
}

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export async function releaseRefreshLock(lock) {
  if (!lock?.distributed || !lock.key || !lock.token) return;
  const client = await getSharedRedisClient();
  if (!client) return;
  try {
    const released = await client.eval(RELEASE_LOCK_LUA, 1, lock.key, lock.token);
    recordRefreshLock(Number(released) === 1 ? 'redis-released' : 'redis-release-skipped');
  } catch (err) {
    recordRefreshLock('redis-error');
    console.warn('[cache:refresh-unlock]', err.message);
  }
}

export function __setRedisClientForTests(client) {
  __setSharedRedisClientForTests(client);
}

export function __resetCacheForTests() {
  __resetSharedRedisClientForTests();
  memory.clear();
}

export function __lockKeyForTests(key) {
  return normalizeKey(safeLockKey(key));
}

export async function closeRedis() {
  await closeSharedRedisClient();
}

export function getCacheStatus() {
  return {
    memoryItems: memory.size,
    redis: Boolean(config.cache.redisUrl),
    prefix: config.cache.keyPrefix,
    staleWhileRevalidate: config.cache.staleWhileRevalidate,
    ...getCacheMetrics(),
  };
}
