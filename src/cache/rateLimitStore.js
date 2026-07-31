// @ts-check
import { config } from '../config.js';
import {
  __resetSharedRedisClientForTests,
  __setSharedRedisClientForTests,
  getSharedRedisClient,
} from './redisClient.js';

const INCREMENT_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

const DECREMENT_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
current = tonumber(current)
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
return redis.call('DECR', KEYS[1])
`;

function safeSegment(value) {
  return String(value || 'default').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 160);
}

export class RedisRateLimitStore {
  localKeys = false;

  constructor(namespace) {
    this.namespace = safeSegment(namespace);
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = Math.max(1_000, Number(options?.windowMs) || 60_000);
  }

  key(clientKey) {
    return `${config.cache.keyPrefix}:ratelimit:${this.namespace}:${safeSegment(clientKey)}`;
  }

  async increment(clientKey) {
    const client = await getSharedRedisClient();
    if (!client) throw new Error('Redis rate-limit store is not configured');
    const raw = /** @type {any} */ (await client.eval(INCREMENT_LUA, 1, this.key(clientKey), this.windowMs));
    const totalHits = Math.max(1, Number(raw?.[0]) || 1);
    const ttlMs = Math.max(1, Number(raw?.[1]) || this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(clientKey) {
    const client = await getSharedRedisClient();
    if (client) await client.eval(DECREMENT_LUA, 1, this.key(clientKey));
  }

  async resetKey(clientKey) {
    const client = await getSharedRedisClient();
    if (client) await client.del(this.key(clientKey));
  }

  shutdown() {}
}

export function createDistributedRateLimitStore(namespace) {
  return config.cache.redisUrl ? new RedisRateLimitStore(namespace) : null;
}

export function __setRateLimitRedisForTests(client) {
  __setSharedRedisClientForTests(client);
}

export async function __resetRateLimitRedisForTests() {
  __resetSharedRedisClientForTests();
}
