import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { applyAccuracyPreflight } from './accuracyPreflight.js';
import * as core from './subtitleServiceCore.js';

const inFlight = new Map();
const waitMs = Math.min(20_000, Math.max(250, Number(process.env.CACHE_SINGLEFLIGHT_WAIT_MS) || 5_000));
const pollMs = Math.min(1_000, Math.max(25, Number(process.env.CACHE_SINGLEFLIGHT_POLL_MS) || 100));

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizedFilename(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
}

function availabilityKeySpecs(search = {}) {
  const type = String(search.type || 'movie').toLowerCase();
  const id = String(search.id || search.imdbId || search.tmdbId || search.query || search.title || '').trim().toLowerCase();
  const season = Number(search.season || 0) || 0;
  const episode = Number(search.episode || 0) || 0;
  const videoHash = String(search.videoHash || search.hash || '').trim().toLowerCase();
  const videoSize = String(search.videoSize || search.size || '').trim();
  const filename = normalizedFilename(search.filename);
  const raw = [];
  if (videoHash) raw.push({ kind: 'exact', raw: `hash|${type}|${videoHash}|${videoSize}` });
  if (filename) raw.push({ kind: 'release', raw: `release|${type}|${id}|${season}|${episode}|${filename}|${videoSize}` });
  if (id) raw.push({ kind: 'catalog', raw: `catalog|${type}|${id}|${season}|${episode}` });
  const seen = new Set();
  return raw.filter(item => {
    if (seen.has(item.raw)) return false;
    seen.add(item.raw);
    return true;
  }).map(item => ({ ...item, key: `arabic-lkg:${digest(item.raw)}` }));
}

export function __availabilityKeySpecsForTests(search = {}) {
  return availabilityKeySpecs(search);
}

function usable(results) {
  return Array.isArray(results) && results.length > 0;
}

async function readAvailabilityLkg(search) {
  const specific = [];
  const catalog = [];
  let allStale = true;
  for (const spec of availabilityKeySpecs(search)) {
    const cached = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    if (!cached?.hit || !usable(cached.value)) continue;
    allStale = allStale && Boolean(cached.stale);
    if (spec.kind === 'catalog') catalog.push(cached.value);
    else specific.push(cached.value);
  }
  const groups = specific.length ? specific : catalog;
  if (!groups.length) return null;
  const value = core.preserveAccurateCandidates(search, ...groups);
  return usable(value) ? {
    hit: true,
    stale: allStale,
    kind: specific.length ? 'specific' : 'catalog',
    value,
  } : null;
}

async function writeAvailabilityLkg(search, results) {
  if (!usable(results)) return;
  const writes = availabilityKeySpecs(search).map(async spec => {
    const current = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    const preserved = current?.hit && usable(current.value)
      ? core.preserveAccurateCandidates(search, results, current.value)
      : core.preserveAccurateCandidates(search, results);
    if (!usable(preserved)) return;
    await cacheSet(
      spec.key,
      preserved,
      config.cache.availabilityTtlSeconds,
      config.cache.availabilityStaleSeconds,
    );
  });
  await Promise.allSettled(writes);
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
  return `cold-search:${digest(identity)}`;
}

async function searchCore(search) {
  return applyAccuracyPreflight(await core.searchSubtitles(search), search);
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
  if (!lock.acquired) return searchCore(search);
  try {
    return await searchCore(search);
  } finally {
    await releaseRefreshLock(lock);
  }
}

export async function searchSubtitles(search) {
  const lkg = await readAvailabilityLkg(search);
  // Final LKG exists to preserve Arabic availability when providers fail. It must not short-circuit
  // normal ranking, otherwise an older merely-acceptable list can hide a newly available exact or
  // timing-compatible subtitle. The version-scoped search cache remains the normal fast path.

  const key = singleflightKey(search);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const fresh = await runDistributed(search, key);
    if (usable(fresh)) {
      await writeAvailabilityLkg(search, fresh);
      return fresh;
    }
    if (lkg?.hit && usable(lkg.value)) return lkg.value;
    return fresh;
  })();
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
export const flushBackgroundRefreshes = core.flushBackgroundRefreshes;
