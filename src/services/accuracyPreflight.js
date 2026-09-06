import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';
import { preflightSubtitleCandidate } from '../utils/encodingProxy.js';
import { recordAccuracyPreflight } from '../utils/metrics.js';

const HARD_REJECT_REASONS = new Set(['low-arabic-ratio', 'too-few-cues', 'invalid-timed-cues']);

function candidateKey(item = {}, search = {}) {
  const payload = JSON.stringify({
    provider: item.originalProvider || item.provider || '',
    providerId: item.providerId || item.fileId || item.id || '',
    download: item.download || item.url || '',
    movieHash: item.movieHash || item.hash || '',
    release: item.releaseName || item.fileName || item.name || '',
    durationMs: search.durationMs || null,
    fps: search.fps || search.extra?.fps || null,
    policyVersion: config.app.version,
  });
  return `accuracy-preflight:${createHash('sha256').update(payload).digest('hex')}`;
}

function normalizeOutcome(raw = {}, elapsedMs = 0) {
  const quality = raw.quality || null;
  const reasons = Array.isArray(quality?.reasons) ? quality.reasons : [];
  const hardReject = reasons.some(reason => HARD_REJECT_REASONS.has(reason));
  return {
    state: hardReject ? 'rejected' : quality?.valid === true ? 'valid' : 'degraded',
    quality,
    encoding: raw.encoding || null,
    format: raw.format || null,
    archive: raw.archive || null,
    archiveEntry: raw.archiveEntry || null,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

function outcomeFromError(error, elapsedMs = 0) {
  const invalidTimedCues = Number(error?.status || error?.statusCode || 0) === 422
    && /timed cues/i.test(String(error?.message || ''));
  return {
    state: invalidTimedCues ? 'rejected' : 'unavailable',
    quality: invalidTimedCues
      ? { valid: false, score: 0, reasons: ['invalid-timed-cues'] }
      : null,
    error: String(error?.message || error || 'preflight unavailable').slice(0, 180),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

async function inspectOne(item, search, {
  preflightImpl,
  cacheGetImpl,
  cacheSetImpl,
} = {}) {
  if (item?.quality?.valid === true) {
    return {
      state: 'valid',
      quality: item.quality,
      source: 'existing-quality',
      elapsedMs: 0,
    };
  }

  const key = candidateKey(item, search);
  const cached = await cacheGetImpl(key);
  if (cached?.state) return { ...cached, source: 'shared-cache' };

  const started = Date.now();
  const timeoutMs = config.accuracyPreflight.timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let outcome;
  try {
    const result = await preflightImpl(item, search, { signal });
    outcome = normalizeOutcome(result, Date.now() - started);
  } catch (error) {
    outcome = outcomeFromError(error, Date.now() - started);
  }

  recordAccuracyPreflight(outcome.state, outcome.elapsedMs);
  if (outcome.state !== 'unavailable') {
    const hardRejected = outcome.state === 'rejected';
    await cacheSetImpl(
      key,
      outcome,
      hardRejected ? config.accuracyPreflight.rejectCacheTtlSeconds : config.accuracyPreflight.cacheTtlSeconds,
      hardRejected ? 0 : config.cache.staleSeconds,
    );
  }
  return { ...outcome, source: 'live-preflight' };
}

export async function applyAccuracyPreflight(results = [], search = {}, {
  preflightImpl = preflightSubtitleCandidate,
  cacheGetImpl = cacheGet,
  cacheSetImpl = cacheSet,
} = {}) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  if (!config.accuracyPreflight.enabled || config.accuracyPreflight.topN <= 0 || ranked.length === 0) {
    return ranked;
  }

  const inspected = new Map();
  const targets = ranked.slice(0, config.accuracyPreflight.topN);
  await Promise.all(targets.map(async item => {
    const key = candidateKey(item, search);
    const outcome = await inspectOne(item, search, { preflightImpl, cacheGetImpl, cacheSetImpl });
    inspected.set(key, outcome);
  }));

  const decorated = ranked.map(item => {
    const outcome = inspected.get(candidateKey(item, search));
    if (!outcome) return item;
    const measuredQuality = outcome.quality
      ? { ...(item.quality || {}), ...outcome.quality }
      : item.quality;
    return {
      ...item,
      ...(measuredQuality ? { quality: measuredQuality, qualityScore: measuredQuality.score } : {}),
      accuracyPreflight: outcome,
    };
  });

  // Only hard content failures are removed. Slow/unavailable preflight never hides a subtitle.
  const survivors = decorated.filter(item => item.accuracyPreflight?.state !== 'rejected');
  if (survivors.length > 0) return prioritizeAccurateSubtitles(survivors, search);

  // Availability invariant: content preflight may demote the last candidates, but it may
  // not erase an otherwise non-empty Arabic provider result. Delivery-time quality gates
  // still validate the selected source and can fall through to its fallback chain.
  const failOpen = (decorated.length ? decorated : ranked).map(item => ({
    ...item,
    accuracyPreflightFallback: 'all-candidates-rejected',
  }));
  return failOpen;
}
