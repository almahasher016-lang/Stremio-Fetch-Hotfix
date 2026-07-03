import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { withRetry } from '../utils/retry.js';
import { buildSearchVariants, stableFingerprint } from '../utils/releaseParser.js';
import { rankAndFilter, scoreSubtitle } from '../utils/scoring.js';
import { isEnglishLanguage } from '../utils/language.js';
import { providerDefinitions, getProviderDefinition } from '../providers/registry.js';
import { searchVault, getVaultStatus } from './vaultService.js';
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

function cacheKey(search) {
  const season = search.season || 0;
  const episode = search.episode || 0;
  const fingerprint = search.videoHash || stableFingerprint(search.filename || search.query || search.id || '');
  return `search:${JSON.stringify({
    type: search.type,
    id: search.id,
    imdbId: search.imdbId,
    tmdbId: search.tmdbId,
    season,
    episode,
    fingerprint,
    videoSize: search.videoSize || null,
    providers: config.providers.enabled,
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    referenceAutoSync: config.ranking.enableReferenceAutoSync,
    referenceLanguage: config.ranking.referenceLanguage,
  })}`;
}

async function runProvider(providerName, variant) {
  const handler = providerHandlers[providerName];
  if (!handler) return [];
  const breaker = breakers.get(providerName);
  if (breaker?.open) {
    recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'circuit-breaker-open' });
    return [];
  }

  const start = Date.now();
  try {
    const results = await withRetry(() => handler(variant), {
      retries: config.providers.retries,
      baseMs: config.providers.retryBaseMs,
      shouldRetry: err => !err.statusCode || err.statusCode >= 500 || err.statusCode === 429,
    });
    breaker?.recordSuccess();
    const ms = Date.now() - start;
    recordProviderCall(providerName, { ok: true, count: results.length, ms });
    return results.map(item => ({ ...item, searchReason: variant.reason }));
  } catch (err) {
    breaker?.recordFailure();
    const ms = Date.now() - start;
    recordProviderCall(providerName, { ok: false, count: 0, ms, error: err.message });
    console.warn(`[provider:${providerName}]`, err.message);
    return [];
  }
}

async function fetchAllVariants(search, language = 'ar') {
  const variants = buildSearchVariants(search).map(variant => ({ ...variant, language }));
  const enabled = config.providers.enabled.filter(name => {
    const definition = getProviderDefinition(name);
    if (!definition || !providerHandlers[name]) return false;
    if (search.type === 'series' && !definition.supports.series) return false;
    if (language !== 'ar' && language !== 'ara' && !definition.supports.reference) return false;
    return definition.configured();
  });
  const tasks = [];
  for (const variant of variants) {
    for (const provider of enabled) {
      tasks.push(runProvider(provider, {
        ...variant,
        videoHash: search.videoHash,
        videoSize: search.videoSize,
      }));
    }
  }
  const settled = await Promise.all(tasks);
  return settled.flat();
}

function rankReferenceResults(results, search) {
  return results
    .filter(item => item && isEnglishLanguage(item.lang || item.language || item.name || item.releaseName) && (item.download || item.url))
    .map(item => {
      const scoring = scoreSubtitle(item, search);
      return { ...item, score: scoring.score, scoreReasons: scoring.reasons, parsedRelease: scoring.release };
    })
    .sort((a, b) => b.score - a.score);
}

function attachReferenceCandidates(arabicResults, referenceResults) {
  if (!config.ranking.enableReferenceAutoSync || !config.referenceSync.enabled || !referenceResults.length) return arabicResults;
  const references = referenceResults.slice(0, config.referenceSync.attachTopReferences);
  return arabicResults.map((item, index) => ({
    ...item,
    referenceSubtitle: references[index % references.length] || references[0] || null,
  }));
}

async function buildFreshSubtitles(search) {
  const shouldFetchReference = config.ranking.enableReferenceAutoSync && config.referenceSync.enabled;
  const [vaultResults, rawResults, referenceRaw] = await Promise.all([
    searchVault(search),
    fetchAllVariants(search, 'ar'),
    shouldFetchReference ? fetchAllVariants(search, config.ranking.referenceLanguage || 'en') : Promise.resolve([]),
  ]);

  const rankedArabic = rankAndFilter(rawResults, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore: config.ranking.minRankScore,
  }).slice(0, config.providers.topN);

  let ranked = rankedArabic;
  if (shouldFetchReference && rankedArabic.length && referenceRaw.length) {
    const referenceRanked = rankReferenceResults(referenceRaw, search);
    ranked = attachReferenceCandidates(rankedArabic, referenceRanked);
  }
  if (config.vault.enabled && config.vault.preferVault && vaultResults.length) {
    const seen = new Set(vaultResults.map(item => item.download || item.id));
    return [...vaultResults, ...ranked.filter(item => !seen.has(item.download || item.id))].slice(0, config.providers.topN + vaultResults.length);
  }
  return ranked;
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
      // The in-memory Set prevents duplicate refreshes inside one Railway replica.
      // Redis SET NX prevents duplicate refreshes across multiple replicas when REDIS_URL is configured.
      lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
      if (!lock.acquired) return;

      const fresh = await buildFreshSubtitles(search);
      await cacheSet(key, fresh, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    } catch (err) {
      console.warn('[cache:refresh]', err.message);
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
  const key = cacheKey(search);
  const cached = await cacheGetEntry(key, { allowStale: config.cache.staleWhileRevalidate });
  if (cached?.hit && !cached.stale) return cached.value;
  if (cached?.hit && cached.stale) {
    refreshInBackground(key, search);
    return cached.value;
  }

  const ranked = await buildFreshSubtitles(search);
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
  return providers;
}

export function getProviderMetricsStatus() {
  return getProviderMetrics();
}

export function getBreakersStatus() {
  return Object.fromEntries([...breakers].map(([name, breaker]) => [name, breaker.status()]));
}
