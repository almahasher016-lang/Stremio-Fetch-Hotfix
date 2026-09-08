import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';
import { preflightSubtitleCandidate, preflightTimingReferenceCandidate } from '../utils/encodingProxy.js';
import { deriveReferenceSyncPlanFromProfiles } from '../utils/referenceSync.js';
import { recordAccuracyPreflight } from '../utils/metrics.js';

const HARD_REJECT_REASONS = new Set(['low-arabic-ratio', 'too-few-cues', 'invalid-timed-cues']);
const TERMINAL_DELIVERY_STATUSES = new Set([403, 404, 410]);

function candidateKey(item = {}, search = {}) {
  const payload = JSON.stringify({
    provider: item.originalProvider || item.provider || '',
    providerId: item.providerId || item.fileId || item.id || '',
    download: item.download || item.url || '',
    movieHash: item.movieHash || item.hash || '',
    release: item.releaseName || item.fileName || item.name || '',
    durationMs: search.durationMs || null,
    fps: search.fps || search.extra?.fps || null,
    filename: search.filename || search.extra?.filename || '',
    season: search.season ?? null,
    episode: search.episode ?? null,
    type: search.type || null,
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
    timingProfile: raw.timingProfile || null,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

function outcomeFromError(error, elapsedMs = 0) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || 'preflight unavailable');
  const messageUpstreamStatus = Number(message.match(/Subtitle upstream failed with (\d{3})/i)?.[1] || 0);
  const upstreamStatus = Number(error?.upstreamStatus || messageUpstreamStatus || 0);
  const terminalStatus = upstreamStatus || status;
  const invalidTimedCues = status === 422
    && /timed cues/i.test(message);
  const deliveryFailure = TERMINAL_DELIVERY_STATUSES.has(terminalStatus);
  return {
    state: invalidTimedCues || deliveryFailure ? 'rejected' : 'unavailable',
    quality: invalidTimedCues
      ? { valid: false, score: 0, reasons: ['invalid-timed-cues'] }
      : null,
    deliveryFailure,
    status: status || null,
    upstreamStatus: upstreamStatus || null,
    error: message.slice(0, 180),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

function exactTimingReference(item = {}) {
  const reference = item?.referenceSubtitle;
  if (!reference || item?.timingReferenceEvidence?.exactVideoHash !== true) return null;
  return { ...reference, exactVideoHash: true };
}

function stableLocalSource(item = {}) {
  const provider = String(item.originalProvider || item.provider || '').toLowerCase();
  return provider === 'vault'
    || item.sourceType === 'personal-vault-exact-hash'
    || String(item.download || item.url || '').startsWith('/vault/subtitles/');
}

function cachedOutcomeIsFresh(cached, item, now = Date.now()) {
  if (!cached?.state) return false;
  if (stableLocalSource(item)) return true;
  const checkedAt = Number(cached.checkedAt || 0);
  const maxAgeMs = Number(config.accuracyPreflight.remoteFreshMs || 0);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  const ageMs = now - checkedAt;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

async function inspectOne(item, search, {
  preflightImpl,
  cacheGetImpl,
  cacheSetImpl,
} = {}) {
  // Stored quality proves subtitle content, not that a remote provider URL is still alive.
  // Only the local personal vault may bypass a fresh delivery check on that basis.
  if (item?.quality?.valid === true && !exactTimingReference(item) && stableLocalSource(item)) {
    return {
      state: 'valid',
      quality: item.quality,
      source: 'existing-quality-local',
      elapsedMs: 0,
    };
  }

  const key = candidateKey(item, search);
  const cached = await cacheGetImpl(key);
  if (cachedOutcomeIsFresh(cached, item)) return { ...cached, source: 'shared-cache' };

  const started = Date.now();
  const timeoutMs = exactTimingReference(item) ? config.timingEvidence.timeoutMs : config.accuracyPreflight.timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let outcome;
  try {
    const result = await preflightImpl(item, search, { signal });
    outcome = normalizeOutcome(result, Date.now() - started);
  } catch (error) {
    outcome = outcomeFromError(error, Date.now() - started);
  }
  outcome = { ...outcome, checkedAt: Date.now() };

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

function timingReferenceKey(reference = {}) {
  const payload = JSON.stringify({
    provider: reference.provider || '',
    providerId: reference.providerId || reference.fileId || reference.id || '',
    release: reference.releaseName || reference.fileName || reference.name || '',
    policyVersion: config.app.version,
  });
  return `timing-reference:${createHash('sha256').update(payload).digest('hex')}`;
}

async function inspectTimingReference(reference, { referencePreflightImpl, cacheGetImpl, cacheSetImpl } = {}) {
  if (!reference?.exactVideoHash) return null;
  const key = timingReferenceKey(reference);
  const cached = await cacheGetImpl(key);
  if (cached?.timingProfile) return { ...cached, source: 'shared-cache' };
  const started = Date.now();
  try {
    const signal = AbortSignal.timeout(config.timingEvidence.timeoutMs);
    const result = await referencePreflightImpl(reference, { signal });
    if (!result?.timingProfile) return null;
    const outcome = { timingProfile: result.timingProfile, elapsedMs: Date.now() - started };
    await cacheSetImpl(key, outcome, config.timingEvidence.cacheTtlSeconds, config.cache.staleSeconds);
    return { ...outcome, source: 'live-reference' };
  } catch {
    return null;
  }
}

function measuredTimingEvidence(plan = {}) {
  const agreement = Number(plan.temporalAgreement || 0);
  const coverage = Number(plan.anchorCoverage || 0);
  const cueRatio = Number(plan.cueRatio || 0);
  const confidence = Number(plan.confidence || 0);
  const residualMedianMs = Number(plan.residualMedianMs ?? Number.POSITIVE_INFINITY);
  const residualP90Ms = Number(plan.residualP90Ms ?? Number.POSITIVE_INFINITY);
  const offsetMs = Number(plan.offsetMs || 0);
  const ratio = Number(plan.ratio || 1);
  const ratioDelta = Math.abs(ratio - 1);
  const cfg = config.timingEvidence;
  const structurallyCompatible = Number(plan.sourceCueCount || 0) >= cfg.minCues
    && Number(plan.referenceCueCount || 0) >= cfg.minCues
    && cueRatio >= cfg.minCueRatio
    && agreement >= cfg.minTemporalAgreement
    && coverage >= cfg.minAnchorCoverage
    && residualMedianMs <= cfg.maxResidualMedianMs
    && residualP90Ms <= cfg.maxResidualP90Ms;
  const aligned = structurallyCompatible
    && Math.abs(offsetMs) <= cfg.alignedMaxOffsetMs
    && ratioDelta <= cfg.alignedMaxRatioDelta;
  const verdict = aligned ? 'aligned' : (structurallyCompatible ? 'repairable' : 'incompatible');
  const structuralScore = Math.round(
    agreement * 3500 + coverage * 2500 + cueRatio * 1500 + confidence * 15
    - Math.min(1200, Math.abs(offsetMs) / 50)
    - Math.min(1200, ratioDelta * 30000),
  );
  const classBase = verdict === 'aligned' ? 30000 : verdict === 'repairable' ? 15000 : 0;
  return {
    measured: true,
    exactVideoHash: true,
    verdict,
    rankScore: Math.max(0, classBase + structuralScore),
    confidence,
    temporalAgreement: agreement,
    anchorCoverage: coverage,
    cueRatio,
    residualMedianMs: Number.isFinite(residualMedianMs) ? residualMedianMs : null,
    residualP90Ms: Number.isFinite(residualP90Ms) ? residualP90Ms : null,
    offsetMs,
    ratio,
    strategy: plan.strategy || null,
  };
}

export async function applyAccuracyPreflight(results = [], search = {}, {
  preflightImpl = preflightSubtitleCandidate,
  referencePreflightImpl = preflightTimingReferenceCandidate,
  cacheGetImpl = cacheGet,
  cacheSetImpl = cacheSet,
} = {}) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  if (!config.accuracyPreflight.enabled || config.accuracyPreflight.topN <= 0 || ranked.length === 0) {
    return ranked;
  }

  const inspected = new Map();
  const exactHashTimingAvailable = config.timingEvidence.enabled
    && ranked.some(item => exactTimingReference(item));
  const timingTargetCount = exactHashTimingAvailable
    ? Math.min(config.timingEvidence.topN, ranked.length)
    : 0;
  const targetCount = Math.max(config.accuracyPreflight.topN, timingTargetCount);
  const targets = ranked.slice(0, Math.min(targetCount, ranked.length));
  await Promise.all(targets.map(async item => {
    const key = candidateKey(item, search);
    const outcome = await inspectOne(item, search, { preflightImpl, cacheGetImpl, cacheSetImpl });
    inspected.set(key, outcome);
  }));

  const exactReference = config.timingEvidence.enabled
    ? targets.map(item => exactTimingReference(item)).find(Boolean)
    : null;
  const referenceOutcome = exactReference
    ? await inspectTimingReference(exactReference, { referencePreflightImpl, cacheGetImpl, cacheSetImpl })
    : null;

  const decorated = ranked.map(item => {
    const outcome = inspected.get(candidateKey(item, search));
    if (!outcome) return item;
    const measuredQuality = outcome.quality
      ? { ...(item.quality || {}), ...outcome.quality }
      : item.quality;
    let timing = null;
    if (
      config.timingEvidence.enabled
      && exactTimingReference(item)
      && outcome?.timingProfile
      && referenceOutcome?.timingProfile
    ) {
      const plan = deriveReferenceSyncPlanFromProfiles(outcome.timingProfile, referenceOutcome.timingProfile, {
        minCues: 4,
        minCueRatio: 0,
        minConfidence: 0,
        minTemporalAgreement: 0,
        minAnchorCoverage: 0,
        maxAnchors: 48,
        piecewise: true,
        dtwEnabled: true,
        dtwMaxCues: config.timingEvidence.maxCues,
      });
      timing = measuredTimingEvidence(plan);
    }
    return {
      ...item,
      ...(measuredQuality ? { quality: measuredQuality, qualityScore: measuredQuality.score } : {}),
      ...(timing ? { actualTimingEvidence: timing } : {}),
      accuracyPreflight: outcome,
    };
  });

  // A 403/404/410 observed while resolving the real provider source is a delivery failure, not
  // merely missing quality evidence. Never return that source to Stremio or resurrect it via fail-open.
  const deliverable = decorated.filter(item => item.accuracyPreflight?.deliveryFailure !== true);
  const survivors = deliverable.filter(item => item.accuracyPreflight?.state !== 'rejected');
  if (survivors.length > 0) return prioritizeAccurateSubtitles(survivors, search);
  if (deliverable.length === 0 && decorated.length > 0) return [];

  // Content-quality rejection still fails open to preserve Arabic availability, but terminally
  // unreachable sources have already been removed above. Delivery-time quality gates remain active.
  const failOpen = (deliverable.length ? deliverable : ranked).map(item => ({
    ...item,
    accuracyPreflightFallback: 'all-candidates-rejected',
  }));
  return failOpen;
}
