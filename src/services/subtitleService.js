import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { acquireRefreshLock, releaseRefreshLock } from '../cache/redis.js';
import * as core from './subtitleServiceCore.js';

const inFlight = new Map();
const waitMs = Math.min(20_000, Math.max(250, Number(process.env.CACHE_SINGLEFLIGHT_WAIT_MS) || 5_000));
const pollMs = Math.min(1_000, Math.max(25, Number(process.env.CACHE_SINGLEFLIGHT_POLL_MS) || 100));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function singleflightKey(search) {
  const identity = JSON.stringify({
    type: search?.type || 'movie',
    id: search?.id || '',
    imdbId: search?.imdbId || '',
    tmdbId: search?.tmdbId || '',
    season: search?.season || null,
    episode: search?.episode || null,
    videoHash: search?.videoHash || search?.hash || '',
    videoSize: search?.videoSize || search?.size || '',
    filename: search?.filename || '',
    query: search?.query || search?.title || '',
    release: config.app.version,
  });
  return `cold-search:${createHash('sha256').update(identity).digest('hex')}`;
}

async function runDistributed(search, key) {
  let lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
  if (!lock.acquired) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
      if (lock.acquired) break;
    }
  }
  if (!lock.acquired) return core.searchSubtitles(search);
  try {
    return await core.searchSubtitles(search);
  } finally {
    await releaseRefreshLock(lock);
  }
}

export async function searchSubtitles(search) {
  const key = singleflightKey(search);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = runDistributed(search, key);
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

export const getProvidersStatus = core.getProvidersStatus;
export const getProviderMetricsStatus = core.getProviderMetricsStatus;
export const getBreakersStatus = core.getBreakersStatus;
export const resetProviderBreaker = core.resetProviderBreaker;
export const getProviderLimitersStatus = core.getProviderLimitersStatus;
export const mergeResults = core.mergeResults;
