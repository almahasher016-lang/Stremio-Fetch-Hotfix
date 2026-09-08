import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { applyAccuracyPreflight } from './accuracyPreflight.js';
import * as core from './subtitleServiceCore.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { runV5Shadow } from '../v5/shadowResolver.js';
import { selectV5Output, v5ModeFromEnvironment } from '../v5/outputPolicy.js';

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
  const identity = search.videoProfile ? search : buildVideoIdentity(search);
  const type = String(identity.type || 'movie').toLowerCase();
  const id = String(identity.catalogId || identity.id || identity.imdbId || identity.tmdbId || identity.query || identity.title || '').trim().toLowerCase();
  const season = identity.season ?? '';
  const episode = identity.episode ?? '';
  const videoHash = String(identity.videoHash || identity.hash || '').trim().toLowerCase();
  const videoSize = String(identity.videoSize || identity.size || '').trim();
  const filename = normalizedFilename(identity.filename);
  const timingFingerprint = String(identity.timingFingerprint || '').trim();
  const raw = [];
  if (videoHash) raw.push({ kind: 'exact', raw: `hash|${type}|${videoHash}|${videoSize}` });
  if (id && timingFingerprint) raw.push({ kind: 'timeline', raw: `timeline|${type}|${id}|${season}|${episode}|${timingFingerprint}` });
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

async function writeAvailabilityLkg(search, results, mode = 'merge') {
  if (!usable(results)) return;
  const writes = availabilityKeySpecs(search).map(async spec => {
    const current = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    const preserved = mode === 'replace'
      ? core.preserveAccurateCandidates(search, results)
      : (current?.hit && usable(current.value)
        ? core.preserveAccurateCandidates(search, results, current.value)
        : core.preserveAccurateCandidates(search, results));
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

export async function revalidateAvailabilityLkg(search, lkg, { preflight = applyAccuracyPreflight } = {}) {
  if (!lkg?.hit || !usable(lkg.value)) return [];
  // LKG preserves candidate identity, not delivery/integrity truth. Remote links and archives can
  // change after caching, so every fallback must be freshly preflighted before V5 can judge it.
  // This prevents a provider outage from turning previously valid cached candidates into false
  // integrity:invalid-subtitle / delivery:unverified rejects merely because proof metadata is stale.
  const checked = await preflight(lkg.value, search);
  return Array.isArray(checked) ? checked : [];
}

function singleflightKey(search) {
  const identity = JSON.stringify({
    type: search?.type || 'movie',
    id: search?.id || '',
    imdbId: search?.imdbId || '',
    tmdbId: search?.tmdbId || '',
    season: search?.season ?? null,
    episode: search?.episode || null,
    videoHash: search?.videoHash || search?.hash || '',
    videoSize: search?.videoSize || search?.size || '',
    filename: search?.filename || '',
    query: search?.query || search?.title || '',
    hints: search?.extra || {},
    fps: search?.fps || null,
    durationMs: search?.durationMs || null,
    timingFingerprint: search?.timingFingerprint || '',
    release: config.app.version,
  });
  return `cold-search:${digest(identity)}`;
}

function v5ShadowEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.RESOLVER_V5_SHADOW || '').toLowerCase());
}

function v5Log(mode, summary, search) {
  console.info(`[V5 ${mode}]`, JSON.stringify({
    mediaType: search.type || 'movie',
    catalogId: search.imdbId || search.tmdbId || search.id || null,
    total: summary.total,
    counts: summary.counts,
    topDecision: summary.topDecision,
    topProofFloor: summary.topProofFloor,
    topConfidence: summary.topConfidence,
    topHardFailures: summary.topHardFailures,
    topReasons: summary.topReasons,
    topTimingEvidence: summary.topTimingEvidence,
    legacyTopDecision: summary.legacyTopDecision,
    topDisagreesWithLegacy: summary.topDisagreesWithLegacy,
    legacyTopWouldBeWithheld: summary.legacyTopWouldBeWithheld,
    legacyTopNotCertified: summary.legacyTopNotCertified,
    topCandidates: summary.topCandidates,
  }));
}

function applyV5Policy(results, search) {
  const mode = v5ModeFromEnvironment();
  if (!mode && !v5ShadowEnabled()) return results;
  try {
    const evaluation = runV5Shadow(results, search);
    v5Log(mode || 'shadow', evaluation.summary, search);
    if (!mode) return results;
    return selectV5Output(evaluation.evaluated, {
      mode,
      maxResults: config.providers.topN,
    });
  } catch (error) {
    console.warn('[V5] evaluation failed:', error?.message || error);
    return mode ? [] : results;
  }
}

async function searchCore(search) {
  const outcome = await core.searchSubtitlesWithStatus(search);
  return { ...outcome, results: await applyAccuracyPreflight(outcome.results, search) };
}

export async function reconcileDegradedAvailability(search, outcome, lkg) {
  const fresh = Array.isArray(outcome?.results) ? outcome.results : [];
  if (outcome?.cycleStatus !== 'degraded' || !usable(fresh) || !lkg?.hit || !usable(lkg.value)) {
    return fresh;
  }
  const merged = core.preserveAccurateCandidates(search, fresh, lkg.value);
  return applyAccuracyPreflight(merged, search);
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
  search = buildVideoIdentity(search);
  const lkg = await readAvailabilityLkg(search);
  // Final LKG exists to preserve Arabic availability when providers fail. It must not short-circuit
  // normal ranking, otherwise an older merely-acceptable list can hide a newly available exact or
  // timing-compatible subtitle. The version-scoped search cache remains the normal fast path.

  const key = singleflightKey(search);
  const existing = inFlight.get(key);
  if (existing) return applyV5Policy(await existing, search);
  const pending = (async () => {
    const outcome = await runDistributed(search, key);
    const fresh = outcome.results;
    if (usable(fresh)) {
      if (outcome.cycleStatus === 'complete') {
        await writeAvailabilityLkg(search, fresh, 'replace');
        return fresh;
      }
      if (outcome.cycleStatus === 'degraded') {
        if (lkg?.hit && usable(lkg.value)) {
          const reconciled = await reconcileDegradedAvailability(search, outcome, lkg);
          await writeAvailabilityLkg(search, reconciled, 'merge');
          return reconciled;
        }
        // A degraded first-ever search is useful for the current request, but it is not
        // authoritative enough to become the Final Last-Known-Good pool.
        return fresh;
      }
      return fresh;
    }
    if (lkg?.hit && usable(lkg.value)) {
      const revalidated = await revalidateAvailabilityLkg(search, lkg);
      if (usable(revalidated)) {
        await writeAvailabilityLkg(search, revalidated, 'replace');
        return revalidated;
      }
    }
    return fresh;
  })();
  inFlight.set(key, pending);
  try {
    return applyV5Policy(await pending, search);
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
