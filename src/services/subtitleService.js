import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { withRetry } from '../utils/retry.js';
import { parseRelease, tokenOverlapScore } from '../utils/releaseParser.js';
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
  }),
]));
const refreshingKeys = new Set();

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
  if (breaker?.open) {
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
    breaker?.recordSuccess();
    recordProviderCall(providerName, { ok: true, count: results.length, ms: Date.now() - started });
    return results.map(item => ({
      ...item,
      searchReason: variant.reason,
      matchedByHash: Boolean(item.matchedByHash || exactHashMatch(item, variant)),
    }));
  } catch (error) {
    if (variant.signal?.aborted || error?.name === 'AbortError') {
      recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: 'stage-deadline' });
      return [];
    }
    breaker?.recordFailure();
    recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: error.message });
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

async function rankArabic(items, search) {
  const allowed = await filterRejected(search, items);
  return rankAndFilter(allowed, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: config.providers.strictQualityFilters,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore: config.ranking.minRankScore,
  }).slice(0, config.providers.topN);
}

function referenceCompatibility(arabic, reference, search) {
  const arabicRelease = arabic.parsedRelease || parseRelease(arabic.releaseName || arabic.fileName || arabic.name || '');
  const referenceRelease = reference.parsedRelease || parseRelease(reference.releaseName || reference.fileName || reference.name || '');
  let score = 0;
  if (search.videoHash && lower(arabic.movieHash) === lower(search.videoHash) && lower(reference.movieHash) === lower(search.videoHash)) score += 1600;
  if (arabic.imdbId && reference.imdbId && lower(arabic.imdbId) === lower(reference.imdbId)) score += 280;
  if (arabic.tmdbId && reference.tmdbId && String(arabic.tmdbId) === String(reference.tmdbId)) score += 180;
  if (arabic.season && reference.season && Number(arabic.season) === Number(reference.season)) score += 180;
  if (arabic.episode && reference.episode && Number(arabic.episode) === Number(reference.episode)) score += 220;
  const overlap = tokenOverlapScore(arabicRelease.tokens, referenceRelease.tokens);
  score += Math.round(overlap * 360);
  if (arabicRelease.quality && referenceRelease.quality && arabicRelease.quality === referenceRelease.quality) score += 150;
  if (arabicRelease.source && referenceRelease.source && arabicRelease.source === referenceRelease.source) score += 180;
  if (arabicRelease.releaseGroup && referenceRelease.releaseGroup && arabicRelease.releaseGroup === referenceRelease.releaseGroup) score += 220;
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
  if (!config.ranking.enableReferenceAutoSync || !config.referenceSync.enabled || !arabicResults.length) return arabicResults;
  const seed = arabicResults.find(item => item.provider !== 'registry' && item.provider !== 'vault');
  if (!seed) return arabicResults;
  const referenceSearch = buildVideoIdentity({
    ...search,
    filename: seed.releaseName || seed.fileName || search.filename,
    query: search.title || search.query,
  });
  const plan = createSearchPlan(referenceSearch, providerDefinitions, config.providers.enabled, {
    language: config.ranking.referenceLanguage || 'en',
    maxProvidersPerStage: config.resolver.maxReferenceProviders,
    references: true,
  });
  const raw = [];
  for (const stage of plan.slice(0, 2)) {
    raw.push(...await runStage(stage, referenceSearch, config.ranking.referenceLanguage || 'en'));
    if (raw.length) break;
  }
  const references = rankReferenceResults(raw, referenceSearch);
  if (!references.length) return arabicResults;
  return arabicResults.map(item => {
    if (item.provider === 'registry' || item.provider === 'vault') return item;
    const candidates = references
      .map(reference => ({ reference, matchScore: referenceCompatibility(item, reference, search) }))
      .filter(candidate => candidate.matchScore >= config.referenceSync.minReferenceMatchScore)
      .sort((left, right) => right.matchScore - left.matchScore);
    const best = candidates[0];
    return best ? { ...item, referenceSubtitle: best.reference, referenceMatchScore: best.matchScore } : item;
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

async function buildFreshSubtitles(input) {
  const initial = await versionRegistry.hydrateIdentity(buildVideoIdentity(input));
  const [registryResults, vaultResults] = await Promise.all([
    versionRegistry.findMatches(initial),
    searchVault(initial),
  ]);
  const verifiedHash = registryResults.filter(item => item.sourceType === 'version-registry-exact-hash' && item.trusted);
  if (verifiedHash.length) return mergeResults(verifiedHash, vaultResults).slice(0, config.providers.topN);

  const hashPlan = createSearchPlan(initial, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    maxProvidersPerStage: config.resolver.maxProvidersPerStage,
  }).filter(stage => stage.name === 'exact-hash');
  const hashRaw = [];
  for (const stage of hashPlan) hashRaw.push(...await runStage(stage, initial, 'ar'));
  const hashRanked = await rankArabic(hashRaw, initial);
  const verifiedProviderHash = hashRanked.filter(item => exactHashMatch(item, initial));
  if (verifiedProviderHash.length) {
    return mergeResults(verifiedHash, vaultResults, verifiedProviderHash, registryResults).slice(0, config.providers.topN);
  }

  const search = await resolveMetadata(initial);
  const plan = createSearchPlan(search, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    maxProvidersPerStage: config.resolver.maxProvidersPerStage,
    includeHash: false,
  });
  const raw = [...hashRaw];
  let ranked = hashRanked;
  for (const stage of plan) {
    raw.push(...await runStage(stage, search, 'ar'));
    ranked = await rankArabic(raw, search);
    if (ranked.length >= config.providers.topN) break;
  }
  const withReferences = await attachReferenceCandidates(ranked, search);
  const suggestedCurrent = registryResults.some(item => item.searchReason === 'suggested-version');
  if (suggestedCurrent) await versionRegistry.suggestUpgrade(search, withReferences);
  return mergeResults(registryResults, vaultResults, withReferences).slice(0, config.providers.topN + registryResults.length);
}

function refreshInBackground(key, search) {
  if (refreshingKeys.has(key)) {
    recordRefreshLock('local-skipped');
    return;
  }
  refreshingKeys.add(key);
  setImmediate(async () => {
    let lock = null;
    try {
      lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
      if (!lock.acquired) return;
      const fresh = await buildFreshSubtitles(search);
      await cacheSet(key, fresh, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    } catch (error) {
      console.warn('[cache:refresh]', error.message);
    } finally {
      try {
        await releaseRefreshLock(lock);
      } finally {
        refreshingKeys.delete(key);
      }
    }
  });
}

export async function searchSubtitles(search) {
  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));
  const key = cacheKey(identity);
  const cached = await cacheGetEntry(key, { allowStale: config.cache.staleWhileRevalidate });
  if (cached?.hit && !cached.stale) return cached.value;
  if (cached?.hit && cached.stale) {
    refreshInBackground(key, identity);
    return cached.value;
  }
  const ranked = await buildFreshSubtitles(identity);
  await cacheSet(key, ranked, config.cache.searchTtlSeconds, config.cache.staleSeconds);
  return ranked;
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
