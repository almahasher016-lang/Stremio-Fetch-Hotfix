import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { ProviderLimiter } from '../utils/providerLimiter.js';
import { parseRetryAfter, withRetry } from '../utils/retry.js';
import { parseRelease, tokenOverlapScore } from '../utils/releaseParser.js';
import { applyPostAccuracyScoreFloor, hasStrongTimingEvidence, prioritizeAndLimitAccurateSubtitles } from '../utils/accuracyFirst.js';
import { sourceFamily } from '../utils/timingCompatibility.js';
import { rankAndFilter, scoreSubtitle } from '../utils/scoring.js';
import { isArabicLanguage, isEnglishLanguage } from '../utils/language.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { providerDefinitions, getProviderDefinition } from '../providers/registry.js';
import { searchVault, getVaultStatus } from './vaultService.js';
import { resolveMetadata } from './metadataResolver.js';
import { createSearchPlan } from './searchPlanner.js';
import { versionRegistry } from './versionRegistryService.js';
import { recordProviderCall, recordRefreshLock, getProviderMetrics } from '../utils/metrics.js';

const providerHandlers = Object.fromEntries(Object.entries(providerDefinitions).map(([name, provider]) => [name, provider.search]));
const breakers = new Map(Object.keys(providerHandlers).map(name => [
  name,
  new CircuitBreaker(name, {
    limit: config.providers.breakerLimit,
    resetMs: config.providers.breakerResetMs,
    maxResetMs: config.providers.breakerMaxResetMs,
  }),
]));
const providerLimiters = new Map(Object.keys(providerHandlers).map(name => [
  name,
  new ProviderLimiter(name, {
    maxConcurrent: config.providers.maxConcurrentPerProvider,
    minIntervalMs: config.providers.minIntervalMsPerProvider,
    latencyThresholdMs: Math.max(750, Math.floor(config.providers.timeoutMs * 0.6)),
  }),
]));
const refreshingKeys = new Set();
const backgroundRefreshTasks = new Set();
const providerCycleStorage = new AsyncLocalStorage();

function createProviderCycle() {
  return { attempted: 0, succeeded: 0, failed: 0, providersAttempted: new Set(), providersFailed: new Set() };
}

function cycleFor(variant) {
  return isArabicLanguage(variant?.language || 'ar') ? providerCycleStorage.getStore() : null;
}

function recordCycleAttempt(providerName, variant) {
  const cycle = cycleFor(variant);
  if (!cycle) return;
  cycle.attempted += 1;
  cycle.providersAttempted.add(providerName);
}

function recordCycleSuccess(providerName, variant) {
  const cycle = cycleFor(variant);
  if (!cycle) return;
  cycle.succeeded += 1;
}

function recordCycleFailure(providerName, variant) {
  const cycle = cycleFor(variant);
  if (!cycle) return;
  cycle.failed += 1;
  cycle.providersFailed.add(providerName);
}

export function classifyProviderCycle(cycle = {}) {
  const attempted = Number(cycle.attempted || 0);
  const succeeded = Number(cycle.succeeded || 0);
  const failed = Number(cycle.failed || 0);
  if (!attempted) return 'complete';
  if (!failed) return 'complete';
  if (!succeeded) return 'failed';
  return 'degraded';
}


function lower(value) {
  return String(value || '').toLowerCase();
}

function cacheKey(search) {
  const identity = buildVideoIdentity(search);
  return `search:${JSON.stringify({
    type: identity.type,
    catalogId: identity.catalogId,
    hash: identity.videoHash,
    size: identity.videoSize,
    release: identity.releaseFingerprint,
    season: identity.season,
    episode: identity.episode,
    providers: config.providers.enabled,
    resolver: config.app.version,
  })}`;
}

function exactHashMatch(item, search) {
  return Boolean(search.videoHash && (item.matchedByHash || lower(item.movieHash || item.hash) === lower(search.videoHash)));
}

function providerAvailable(providerName, language, mediaType = 'movie') {
  const definition = getProviderDefinition(providerName);
  if (!definition || !providerHandlers[providerName] || !definition.configured()) return false;
  if (definition.supports[mediaType] === false) return false;
  if (language === 'en' && !definition.supports.reference) return false;
  return true;
}

async function runProvider(providerName, variant) {
  const handler = providerHandlers[providerName];
  if (!handler) return [];
  recordCycleAttempt(providerName, variant);
  const breaker = breakers.get(providerName);
  const limiter = providerLimiters.get(providerName);
  try {
    return await limiter.run(async () => {
      if (breaker && !breaker.tryAcquire()) {
        recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'circuit-breaker-open' });
        recordCycleFailure(providerName, variant);
        return [];
      }
      const started = Date.now();
      try {
        const results = await withRetry(() => handler(variant), {
          retries: config.providers.retries,
          baseMs: config.providers.retryBaseMs,
          signal: variant.signal,
          shouldRetry: error => !variant.signal?.aborted
            && error?.name !== 'AbortError'
            && (!error.statusCode || error.statusCode >= 500 || error.statusCode === 429),
        });
        variant.signal?.throwIfAborted();
        const elapsedMs = Date.now() - started;
        limiter?.recordOutcome({ ok: true, ms: elapsedMs });
        breaker?.recordSuccess();
        recordCycleSuccess(providerName, variant);
        recordProviderCall(providerName, { ok: true, count: results.length, ms: elapsedMs });
        return results.map(item => ({
          ...item,
          searchReason: variant.reason,
          matchedByHash: Boolean(item.matchedByHash || exactHashMatch(item, variant)),
        }));
      } catch (error) {
        if (variant.signal?.aborted || error?.name === 'AbortError') {
          breaker?.recordCancellation();
          recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: 'stage-deadline' });
          recordCycleFailure(providerName, variant);
          return [];
        }
        const elapsedMs = Date.now() - started;
        limiter?.recordOutcome({
          ok: false,
          ms: elapsedMs,
          statusCode: error?.statusCode || error?.status || 0,
          retryAfterMs: parseRetryAfter(error?.retryAfter) || 0,
        });
        breaker?.recordFailure();
        recordCycleFailure(providerName, variant);
        recordProviderCall(providerName, { ok: false, count: 0, ms: elapsedMs, error: error.message });
        console.warn(`[provider:${providerName}]`, error.message);
        return [];
      }
    }, {
      signal: variant.signal,
    });
  } catch (error) {
    if (variant.signal?.aborted || error?.name === 'AbortError') {
      breaker?.recordCancellation();
      recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'stage-deadline-queued' });
      recordCycleFailure(providerName, variant);
      return [];
    }
    recordCycleFailure(providerName, variant);
    recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: error.message });
    console.warn(`[provider:${providerName}]`, error.message);
    return [];
  }
}

function deadline(ms) {
  let timer;
  const promise = new Promise(resolve => {
    timer = setTimeout(() => resolve('deadline'), ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function runStage(stage, search, language = 'ar') {
  const controller = new AbortController();
  const collected = [];
  const tasks = [];
  for (const providerName of stage.providers) {
    if (!providerAvailable(providerName, language, search.type)) continue;
    for (const item of stage.variants) {
      tasks.push(runProvider(providerName, { ...item, language, signal: controller.signal }).then(results => {
        collected.push(...results);
      }));
    }
  }
  if (!tasks.length) return collected;
  const limit = deadline(config.resolver.stageDeadlineMs);
  try {
    const outcome = await Promise.race([
      Promise.all(tasks).then(() => 'complete'),
      limit.promise,
    ]);
    if (outcome === 'deadline') {
      controller.abort(new DOMException('Provider stage deadline exceeded', 'AbortError'));
      await Promise.allSettled(tasks);
    }
  } finally {
    limit.cancel();
  }
  return collected;
}

async function filterRejected(search, items) {
  const allowed = await Promise.all(items.map(async item => ((await versionRegistry.isRejected(search, item)) ? null : item)));
  return allowed.filter(Boolean);
}

const IDENTITY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition']);
const RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition', 'fps']);

export function hasHardIdentityConflict(item, search = {}) {
  const exactSource = item?.sourceType === 'personal-vault-exact-hash'
    || item?.sourceType === 'version-registry-exact-hash'
    || exactHashMatch(item, search);
  if (exactSource) return false;
  const mismatched = Array.isArray(item?.releaseMatch?.mismatched) ? item.releaseMatch.mismatched : [];
  return mismatched.some(field => IDENTITY_HARD_CONFLICTS.has(field));
}

async function rankArabic(items, search, { relaxed = false, limit = true } = {}) {
  const allowed = await filterRejected(search, items);
  const minRankScore = relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore;
  const ranked = rankAndFilter(allowed, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore,
    applyMinRankScore: false,
  });
  const identitySafe = ranked.filter(item => !hasHardIdentityConflict(item, search));
  const safe = relaxed
    ? identitySafe.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))
    : identitySafe;

  // Accuracy-first must see the entire plausible pool before TOP_N is applied. Cutting on
  // raw score first can permanently discard the subtitle whose timing family is correct.
  const ordered = applyPostAccuracyScoreFloor(safe, search, minRankScore);
  const prioritized = limit ? ordered.slice(0, config.providers.topN) : ordered;
  return prioritized.map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));
}

async function finalizeArabic(search, ...groups) {
  return rankArabic(mergeResults(...groups), search);
}

async function finalizeArabicRelaxed(search, ...groups) {
  return rankArabic(mergeResults(...groups), search, { relaxed: true });
}

function referenceCompatibility(arabic, reference, search) {
  const arabicRelease = arabic.parsedRelease || parseRelease(arabic.releaseName || arabic.fileName || arabic.name || '');
  const referenceRelease = reference.parsedRelease || parseRelease(reference.releaseName || reference.fileName || reference.name || '');
  let score = 0;

  if (search.videoHash && exactHashMatch(reference, search)) score += 900;
  if (arabic.imdbId && reference.imdbId && lower(arabic.imdbId) === lower(reference.imdbId)) score += 220;
  if (arabic.tmdbId && reference.tmdbId && String(arabic.tmdbId) === String(reference.tmdbId)) score += 140;
  if (arabic.season && reference.season && Number(arabic.season) === Number(reference.season)) score += 220;
  if (arabic.episode && reference.episode && Number(arabic.episode) === Number(reference.episode)) score += 280;

  const overlap = tokenOverlapScore(arabicRelease.tokens, referenceRelease.tokens);
  score += Math.round(overlap * 260);

  const arabicFamily = sourceFamily(arabicRelease.raw);
  const referenceFamily = sourceFamily(referenceRelease.raw);
  if (arabicFamily && referenceFamily) score += arabicFamily === referenceFamily ? 420 : -360;

  if (arabicRelease.source && referenceRelease.source && arabicRelease.source === referenceRelease.source) score += 80;
  if (arabicRelease.releaseGroup && referenceRelease.releaseGroup) {
    score += arabicRelease.releaseGroup === referenceRelease.releaseGroup ? 180 : 0;
  }
  if (arabicRelease.quality && referenceRelease.quality && arabicRelease.quality === referenceRelease.quality) score += 45;

  if (arabicRelease.service && referenceRelease.service) {
    score += arabicRelease.service === referenceRelease.service ? 140 : -90;
  }
  if (arabicRelease.edition && referenceRelease.edition) {
    score += arabicRelease.edition === referenceRelease.edition ? 220 : -480;
  }
  if (arabicRelease.fps && referenceRelease.fps) {
    score += Math.abs(arabicRelease.fps - referenceRelease.fps) <= 0.02 ? 220 : -480;
  }
  return score;
}

function rankReferenceResults(results, search) {
  return results
    .filter(item => item && isEnglishLanguage(item.lang || item.language || item.name || item.releaseName) && (item.download || item.url))
    .map(item => {
      const scoring = scoreSubtitle(item, search);
      return { ...item, score: scoring.score, scoreReasons: scoring.reasons, parsedRelease: scoring.release };
    })
    .sort((left, right) => right.score - left.score);
}

async function attachReferenceCandidates(arabicResults, search) {
  const autoSyncEnabled = Boolean(config.ranking.enableReferenceAutoSync && config.referenceSync.enabled);
  const exactHashEvidenceEnabled = Boolean(
    search.videoHash && providerAvailable('opensubtitles', 'en', search.type),
  );
  if ((!autoSyncEnabled && !exactHashEvidenceEnabled) || !arabicResults.length) return arabicResults;

  // Reference lookup must always be anchored to the actual video identity. Using an Arabic
  // candidate's release name here creates circular confirmation bias when that candidate is wrong.
  const referenceSearch = buildVideoIdentity({
    ...search,
    filename: search.filename || '',
    query: search.title || search.query,
  });
  const plan = createSearchPlan(referenceSearch, providerDefinitions, config.providers.enabled, {
    language: config.ranking.referenceLanguage || 'en',
    maxProvidersPerStage: config.resolver.maxReferenceProviders,
    references: true,
  });

  const raw = [];
  const exactHashStage = plan.find(stage => stage.name === 'exact-hash');
  if (exactHashEvidenceEnabled && exactHashStage) {
    raw.push(...await runStage(exactHashStage, referenceSearch, config.ranking.referenceLanguage || 'en'));
  }

  let references = rankReferenceResults(raw, referenceSearch);
  const exactReferences = references.filter(reference => exactHashMatch(reference, referenceSearch));

  // Generic reference auto-sync remains opt-in. If enabled and hash lookup did not produce a
  // reference, fall back to metadata/release searches based on the actual video filename.
  if (autoSyncEnabled && !references.length) {
    for (const stage of plan.filter(stage => stage.name !== 'exact-hash').slice(0, 2)) {
      raw.push(...await runStage(stage, referenceSearch, config.ranking.referenceLanguage || 'en'));
      if (raw.length) break;
    }
    references = rankReferenceResults(raw, referenceSearch);
  }

  const timingReferences = exactReferences.length ? exactReferences : (autoSyncEnabled ? references : []);
  if (!timingReferences.length) return arabicResults;

  return arabicResults.map(item => {
    if (item.provider === 'registry' || item.provider === 'vault') return item;
    const candidates = timingReferences
      .map(reference => ({ reference, matchScore: referenceCompatibility(item, reference, search) }))
      .sort((left, right) => right.matchScore - left.matchScore);
    const best = candidates[0];
    if (!best) return item;

    let output = item;
    if (exactHashMatch(best.reference, referenceSearch)) {
      output = {
        ...output,
        timingReferenceEvidence: {
          provider: best.reference.provider,
          providerId: best.reference.providerId || best.reference.id || null,
          releaseName: best.reference.releaseName || best.reference.fileName || best.reference.name || '',
          matchScore: best.matchScore,
          exactVideoHash: true,
        },
        // Exact-hash references describe the actual playback timeline. They are safe to attach
        // even when generic experimental Reference Sync is disabled; delivery still applies a
        // strict structural confidence gate before changing a single timestamp.
        referenceSubtitle: best.reference,
        referenceMatchScore: best.matchScore,
        referenceSyncMode: 'exact-hash-stable',
      };
    }

    if (!output.referenceSubtitle && autoSyncEnabled && best.matchScore >= config.referenceSync.minReferenceMatchScore) {
      output = {
        ...output,
        referenceSubtitle: best.reference,
        referenceMatchScore: best.matchScore,
        referenceSyncMode: 'generic-experimental',
      };
    }
    return output;
  });
}

export function mergeResults(...groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of group || []) {
      if (
        config.providers.excludeMachineTranslated
        && (item.machineTranslated || item.automatedTranslated || item.autoTranslated)
      ) {
        continue;
      }
      const key = item.download || `${item.provider}:${item.providerId || item.id}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
  }
  return output;
}


export function preserveAccurateCandidates(search, ...groups) {
  return prioritizeAndLimitAccurateSubtitles(
    mergeResults(...groups),
    search,
    config.providers.topN,
  );
}

async function buildFreshSubtitles(input) {
  const initial = await versionRegistry.hydrateIdentity(buildVideoIdentity(input));
  const [registryResults, vaultResults] = await Promise.all([
    versionRegistry.findMatches(initial),
    searchVault(initial),
  ]);
  const verifiedHash = registryResults.filter(item => item.sourceType === 'version-registry-exact-hash' && item.trusted);
  if (verifiedHash.length) return finalizeArabic(initial, verifiedHash, vaultResults);

  const hashPlan = createSearchPlan(initial, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    maxProvidersPerStage: config.resolver.maxProvidersPerStage,
    maxAliases: config.resolver.recoveryMaxAliases,
  }).filter(stage => stage.name === 'exact-hash');
  const hashRaw = [];
  for (const stage of hashPlan) hashRaw.push(...await runStage(stage, initial, 'ar'));
  const hashRanked = await rankArabic(hashRaw, initial);
  const verifiedProviderHash = hashRanked.filter(item => exactHashMatch(item, initial));
  if (verifiedProviderHash.length) {
    return finalizeArabic(initial, verifiedHash, vaultResults, verifiedProviderHash, registryResults);
  }

  const search = await resolveMetadata(initial);
  const plan = createSearchPlan(search, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    maxProvidersPerStage: config.resolver.maxProvidersPerStage,
    includeHash: false,
    maxAliases: config.resolver.recoveryMaxAliases,
  });
  const raw = [...hashRaw];
  for (const stage of plan) {
    raw.push(...await runStage(stage, search, 'ar'));
  }
  let ranked = await rankArabic(raw, search, { limit: false });
  let recoveryRaw = [];
  if (!ranked.length && config.resolver.recoveryEnabled) {
    ranked = await rankArabic(raw, search, { relaxed: true, limit: false });
    if (!ranked.length && config.providers.enabled.includes('opensubtitles')) {
      const recoveryPlan = createSearchPlan(search, providerDefinitions, ['opensubtitles'], {
        language: 'ar',
        maxProvidersPerStage: 1,
        includeHash: false,
        relaxed: true,
        maxAliases: config.resolver.recoveryMaxAliases,
      });
      for (const stage of recoveryPlan) {
        recoveryRaw.push(...await runStage(stage, search, 'ar'));
      }
      ranked = await rankArabic(mergeResults(raw, recoveryRaw), search, { relaxed: true, limit: false });
    }
  }
  const withReferences = await attachReferenceCandidates(ranked, search);
  const suggestedCurrent = registryResults.some(item => item.searchReason === 'suggested-version');
  if (suggestedCurrent) await versionRegistry.suggestUpgrade(search, withReferences);
  if (ranked.some(item => item.recoveryTier === 'relaxed-arabic')) {
    return finalizeArabicRelaxed(search, registryResults, vaultResults, withReferences, recoveryRaw);
  }
  return finalizeArabic(search, registryResults, vaultResults, withReferences);
}

async function buildFreshSubtitlesWithStatus(input) {
  const cycle = createProviderCycle();
  const results = await providerCycleStorage.run(cycle, () => buildFreshSubtitles(input));
  return { results, cycleStatus: classifyProviderCycle(cycle) };
}

function refreshInBackground(key, search) {
  if (refreshingKeys.has(key)) {
    recordRefreshLock('local-skipped');
    return;
  }
  refreshingKeys.add(key);
  const task = new Promise(resolve => {
    setImmediate(resolve);
  }).then(async () => {
    let lock = null;
    try {
      lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
      if (!lock.acquired) return;
      const { results: fresh, cycleStatus } = await buildFreshSubtitlesWithStatus(search);
      if (Array.isArray(fresh) && fresh.length > 0) {
        const existing = await cacheGetEntry(key, { allowStale: true, preferShared: true });
        const existingGood = existing?.hit && hasUsableSubtitleResults(existing.value) ? existing.value : null;
        const next = cycleStatus === 'complete'
          ? preserveAccurateCandidates(search, fresh)
          : (existingGood ? preserveAccurateCandidates(search, fresh, existingGood) : preserveAccurateCandidates(search, fresh));
        if (cycleStatus === 'complete' || existingGood) {
          await cacheSet(key, next, config.cache.searchTtlSeconds, config.cache.staleSeconds);
        }
      }
    } catch (error) {
      console.warn('[cache:refresh]', error.message);
    } finally {
      try {
        await releaseRefreshLock(lock);
      } catch (error) {
        console.warn('[cache:refresh:unlock]', error.message);
      } finally {
        refreshingKeys.delete(key);
      }
    }
  });
  backgroundRefreshTasks.add(task);
  void task.then(
    () => backgroundRefreshTasks.delete(task),
    () => backgroundRefreshTasks.delete(task),
  );
}

export async function flushBackgroundRefreshes() {
  await Promise.allSettled([...backgroundRefreshTasks]);
}

export function hasUsableSubtitleResults(value) {
  return Array.isArray(value) && value.length > 0;
}

export async function searchSubtitlesWithStatus(search) {
  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));
  const key = cacheKey(identity);
  const cached = await cacheGetEntry(key, { allowStale: true, preferShared: true });
  const cachedGood = cached?.hit && hasUsableSubtitleResults(cached.value) ? cached.value : null;

  if (cachedGood && !cached.stale) return { results: cachedGood, cycleStatus: 'cached' };
  if (cachedGood && cached.stale && config.cache.staleWhileRevalidate) {
    refreshInBackground(key, identity);
    return { results: cachedGood, cycleStatus: 'cached' };
  }

  const { results: ranked, cycleStatus } = await buildFreshSubtitlesWithStatus(identity);
  if (hasUsableSubtitleResults(ranked)) {
    const next = cycleStatus === 'complete'
      ? preserveAccurateCandidates(identity, ranked)
      : (cachedGood ? preserveAccurateCandidates(identity, ranked, cachedGood) : preserveAccurateCandidates(identity, ranked));
    if (cycleStatus === 'complete' || cachedGood) {
      await cacheSet(key, next, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    }
    return { results: next, cycleStatus };
  }

  if (cachedGood) return { results: cachedGood, cycleStatus };
  return { results: [], cycleStatus };
}

export async function searchSubtitles(search) {
  return (await searchSubtitlesWithStatus(search)).results;
}

export async function getProvidersStatus() {
  const providers = Object.fromEntries(config.providers.enabled.map(provider => {
    const definition = getProviderDefinition(provider);
    return [provider, {
      enabled: Boolean(definition?.search),
      configured: Boolean(definition?.configured?.()),
      label: definition?.label || provider,
      supports: definition?.supports || {},
    }];
  }));
  providers.vault = await getVaultStatus();
  providers.registry = await versionRegistry.status();
  return providers;
}

export function getProviderMetricsStatus() {
  return getProviderMetrics();
}

export function getBreakersStatus() {
  return Object.fromEntries([...breakers].map(([name, breaker]) => [name, breaker.status()]));
}

export function resetProviderBreaker(providerName) {
  const normalized = lower(providerName);
  const breaker = breakers.get(normalized);
  if (!breaker) return false;
  breaker.reset();
  return true;
}

export function getProviderLimitersStatus() {
  return Object.fromEntries([...providerLimiters].map(([name, limiter]) => [name, limiter.status()]));
}
