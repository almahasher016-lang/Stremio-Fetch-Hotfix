import { config } from '../config.js';
import { providerDefinitions } from '../providers/registry.js';
import { applyPostAccuracyScoreFloor } from '../utils/accuracyFirst.js';
import { rankAndFilter } from '../utils/scoring.js';
import { withRetry } from '../utils/retry.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { createSearchPlan } from './searchPlanner.js';
import { resolveMetadata } from './metadataResolver.js';
import { versionRegistry } from './versionRegistryService.js';
import { hasHardIdentityConflict } from './subtitleServiceCore.js';

const RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition', 'fps']);

function dedupe(items = []) {
  const output = [];
  const seen = new Set();
  for (const item of items) {
    if (!item) continue;
    const key = item.download || item.url || `${item.provider}:${item.providerId || item.fileId || item.id || ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function runProvider(providerName, variant) {
  const provider = providerDefinitions[providerName];
  if (!provider?.search || !provider.configured()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Deep recovery deadline exceeded', 'AbortError')), config.resolver.stageDeadlineMs);
  timer.unref?.();
  try {
    const results = await withRetry(() => provider.search({ ...variant, language: 'ar', signal: controller.signal }), {
      retries: config.providers.retries,
      baseMs: config.providers.retryBaseMs,
      signal: controller.signal,
      shouldRetry: error => error?.name !== 'AbortError'
        && (!error?.statusCode || error.statusCode >= 500 || error.statusCode === 429),
    });
    return (Array.isArray(results) ? results : []).map(item => ({
      ...item,
      searchReason: variant.reason,
    }));
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn(`[deep-recovery:${providerName}]`, error?.message || error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function runStage(stage) {
  const tasks = [];
  for (const providerName of stage.providers || []) {
    for (const variant of stage.variants || []) tasks.push(runProvider(providerName, variant));
  }
  const groups = await Promise.all(tasks);
  return groups.flat();
}

export async function searchDeepRecoveryCandidates(input = {}) {
  if (!config.resolver.recoveryEnabled) return [];
  const initial = await versionRegistry.hydrateIdentity(buildVideoIdentity(input));
  const search = await resolveMetadata(initial);
  const plan = createSearchPlan(search, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    maxProvidersPerStage: config.resolver.maxProvidersPerStage,
    includeHash: false,
    relaxed: true,
    maxAliases: config.resolver.recoveryMaxAliases,
  });

  const raw = [];
  for (const stage of plan) raw.push(...await runStage(stage));
  const unique = dedupe(raw);
  if (!unique.length) return [];

  // Deep recovery runs only after the strict pool has failed live content verification. Do not let
  // one mislabeled upload monopolize a release family: keep several same-release alternatives until
  // the content preflight proves which file is actually Arabic and structurally valid.
  const ranked = rankAndFilter(unique, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: false,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: false,
    maxReturnedPerRelease: Math.max(3, config.ranking.maxReturnedPerRelease),
    minRankScore: config.resolver.recoveryMinRankScore,
    applyMinRankScore: false,
  });
  const identitySafe = ranked.filter(item => !hasHardIdentityConflict(item, search));
  const timingSafe = identitySafe.filter(item => !(item.releaseMatch?.mismatched || [])
    .some(field => RECOVERY_HARD_CONFLICTS.has(field)));
  return applyPostAccuracyScoreFloor(timingSafe, search, config.resolver.recoveryMinRankScore)
    .slice(0, config.providers.maxProviderItems)
    .map(item => ({ ...item, recoveryTier: 'post-preflight-deep' }));
}
