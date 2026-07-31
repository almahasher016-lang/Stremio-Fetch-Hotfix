// @ts-check
import { Redis } from 'ioredis';
import { config } from '../config.js';

/** @type {Redis | null} */
let redis = null;
/** @type {Promise<Redis> | null} */
let connectingPromise = null;
/** @type {any} */
let redisOverride = null;

function createClient() {
  const client = new Redis(config.cache.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', error => console.warn('[redis]', error.message));
  return client;
}

export function getSharedRedisClient() {
  if (redisOverride) return Promise.resolve(redisOverride);
  if (!config.cache.redisUrl) return Promise.resolve(null);
  if (redis?.status === 'ready') return Promise.resolve(redis);
  if (connectingPromise) return connectingPromise;

  const candidate = redis || createClient();
  redis = candidate;
  const connectOperation = candidate.status === 'wait' || candidate.status === 'end'
    ? candidate.connect()
    : Promise.resolve();

  /** @type {Promise<Redis>} */
  let trackedAttempt;
  trackedAttempt = connectOperation
    .then(() => candidate)
    .catch(error => {
      if (redis === candidate) redis = null;
      if (connectingPromise === trackedAttempt) connectingPromise = null;
      candidate.disconnect();
      throw error;
    })
    .finally(() => {
      if (connectingPromise === trackedAttempt) connectingPromise = null;
    });
  connectingPromise = trackedAttempt;
  return trackedAttempt;
}

export async function closeSharedRedisClient() {
  const client = redis;
  redis = null;
  connectingPromise = null;
  if (!client) return;
  await client.quit().catch(() => client.disconnect());
}

export function __setSharedRedisClientForTests(client) {
  redisOverride = client;
}

export function __resetSharedRedisClientForTests() {
  redisOverride = null;
}
