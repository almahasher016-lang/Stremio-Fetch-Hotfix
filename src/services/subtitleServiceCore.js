import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { ProviderLimiter } from '../utils/providerLimiter.js';
import { parseRetryAfter, withRetry } from '../utils/retry.js';
import { parseRelease, tokenOverlapScore } from '../utils/releaseParser.js';
import { prioritizeAndLimitAccurateSubtitles } from '../utils/accuracyFirst.js';
import { sourceFamily } from '../utils/timingCompatibility.js';
import { rankAndFilter, scoreSubtitle } from '../utils/scoring.js';
import { isEnglishLanguage } from '../utils/language.js';
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
  const breaker = breakers.get(providerName);
  const limiter = providerLimiters.get(providerName);
  try {
    return await limiter.run(async () => {
      if (breaker && !breaker.tryAcquire()) {
        recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'circuit-breaker-open' });
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
      return [];
    }
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

const RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition', 'fps']);

async function rankArabic(items, search, { relaxed = false, limit = true } = {}) {
  const allowed = await filterRejected(search, items);
  const ranked = rankAndFilter(allowed, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore: relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore,
  });
  const safe = relaxed
    ? ranked.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))
    : ranked;

  // Accuracy-first must see the entire plausible pool before TOP_N is applied. Cutting on
  // raw score first can permanently discard the subtitle whose timing family is correct.
  const prioritized = prioritizeAndLimitAccurateSubtitles(
    safe,
    search,
    limit ? config.providers.topN : Infinity,
  );
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
      };
    }

    if (autoSyncEnabled && best.matchScore >= config.referenceSync.minReferenceMatchScore) {
      output = {
        ...output,
        referenceSubtitle: best.reference,
        referenceMatchScore: best.matchScore,
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
      const fresh = await buildFreshSubtitles(search);
      if (Array.isArray(fresh) && fresh.length > 0) {
        const existing = await cacheGetEntry(key, { allowStale: true, preferShared: true });
        const preserved = existing?.hit && hasUsableSubtitleResults(existing.value)
          ? preserveAccurateCandidates(search, fresh, existing.value)
          : preserveAccurateCandidates(search, fresh);
        await cacheSet(key, preserved, config.cache.searchTtlSeconds, config.cache.staleSeconds);
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

export async function searchSubtitles(search) {
  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));
  const key = cacheKey(identity);

  // Search availability is shared-state critical. Prefer Redis over replica-local memory
  // and always retain a stale non-empty result as Last-Known-Good fallback.
  const cached = await cacheGetEntry(key, { allowStale: true, preferShared: true });
  const cachedGood = cached?.hit && hasUsableSubtitleResults(cached.value) ? cached.value : null;

  if (cachedGood && !cached.stale) return cachedGood;
  if (cachedGood && cached.stale && config.cache.staleWhileRevalidate) {
    refreshInBackground(key, identity);
    return cachedGood;
  }

  const ranked = await buildFreshSubtitles(identity);
  if (hasUsableSubtitleResults(ranked)) {
    // A degraded provider cycle can return one usable candidate while several better candidates
    // temporarily disappear. Preserve the prior non-empty pool, then re-rank with current rules.
    const preserved = cachedGood
      ? preserveAccurateCandidates(identity, ranked, cachedGood)
      : preserveAccurateCandidates(identity, ranked);
    await cacheSet(key, preserved, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    return preserved;
  }

  // Never poison Redis or replica memory with an empty search result. Provider 403/429,
  // timeouts, circuit-breaker opens and transient metadata failures are intentionally
  // indistinguishable from a legitimate empty provider response at this layer.
  // Keeping empties uncached makes the next Stremio probe retry immediately.
  if (cachedGood) return cachedGood;
  return [];
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
