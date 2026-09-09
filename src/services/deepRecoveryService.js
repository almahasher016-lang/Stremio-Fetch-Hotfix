import { config } from '../config.js';
import { providerDefinitions } from '../providers/registry.js';
import { applyPostAccuracyScoreFloor } from '../utils/accuracyFirst.js';
import { hasSubtitleIdentityConflict, rankAndFilter } from '../utils/scoring.js';
import { withRetry } from '../utils/retry.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import {
  createCoverageLedger,
  createExhaustiveCoveragePlan,
  eligibleProviderNames,
  finalizeCoverageLedger,
  recordCoverageAttempt,
  recordCoverageFailure,
  recordCoverageStage,
  recordCoverageSuccess,
} from './coverageEngine.js';
import { resolveMetadata } from './metadataResolver.js';
import { versionRegistry } from './versionRegistryService.js';

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

function attachCoverage(items, coverage) {
  const output = Array.isArray(items) ? items : [];
  Object.defineProperty(output, 'coverage', {
    value: coverage,
    enumerable: false,
    configurable: true,
  });
  return output;
}

async function runProvider(providerName, variant, ledger) {
  const provider = providerDefinitions[providerName];
  if (!provider?.search || !provider.configured()) return [];
  recordCoverageAttempt(ledger, providerName);
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
    const normalized = (Array.isArray(results) ? results : []).map(item => ({
      ...item,
      searchReason: variant.reason,
      coveragePass: true,
    }));
    recordCoverageSuccess(ledger, providerName, normalized.length);
    return normalized;
  } catch (error) {
    recordCoverageFailure(ledger, providerName);
    if (error?.name !== 'AbortError') console.warn(`[deep-recovery:${providerName}]`, error?.message || error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function runStage(stage, ledger) {
  recordCoverageStage(ledger, stage.name);
  const tasks = [];
  for (const providerName of stage.providers || []) {
    for (const variant of stage.variants || []) tasks.push(runProvider(providerName, variant, ledger));
  }
  const groups = await Promise.all(tasks);
  return groups.flat();
}

export function rankCoverageCandidates(items = [], search = {}, { rescueMode = false } = {}) {
  const ranked = rankAndFilter(items, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: false,
    // Machine-translated Arabic remains a last-resort availability option only. The normal
    // exhaustive pass keeps the existing preference to exclude it; the rescue pass lets V5 and
    // live content preflight judge it rather than silently returning zero.
    excludeMachineTranslated: rescueMode ? false : config.providers.excludeMachineTranslated,
    strictQualityFilters: false,
    maxReturnedPerRelease: Math.max(3, config.ranking.maxReturnedPerRelease),
    minRankScore: config.resolver.recoveryMinRankScore,
    applyMinRankScore: false,
  }).filter(item => !hasSubtitleIdentityConflict(item, search));

  // Release year, edition, source family, FPS, quality and release-group differences describe
  // compatibility, not work identity. Keep them as scoring/proof evidence. Only an explicit work,
  // media-type, season or episode conflict is a hard rejection (handled above).
  const ordered = rescueMode
    ? ranked
    : applyPostAccuracyScoreFloor(ranked, search, config.resolver.recoveryMinRankScore);
  return ordered.slice(0, config.providers.maxProviderItems);
}

export async function searchDeepRecoveryCandidates(input = {}) {
  if (!config.resolver.recoveryEnabled) return attachCoverage([], null);
  const initial = await versionRegistry.hydrateIdentity(buildVideoIdentity(input));
  const search = await resolveMetadata(initial);
  const eligibleProviders = eligibleProviderNames(providerDefinitions, config.providers.enabled, {
    language: 'ar',
    mediaType: search.type,
  });
  const ledger = createCoverageLedger(search, eligibleProviders);
  const plan = createExhaustiveCoveragePlan(search, providerDefinitions, config.providers.enabled, {
    language: 'ar',
    includeHash: true,
    maxAliases: Math.max(5, config.resolver.recoveryMaxAliases),
  });

  const raw = [];
  for (const stage of plan) raw.push(...await runStage(stage, ledger));
  const unique = dedupe(raw);

  let ranked = rankCoverageCandidates(unique, search);
  let rescueMode = false;
  if (!ranked.length && unique.length) {
    rescueMode = true;
    ranked = rankCoverageCandidates(unique, search, { rescueMode: true });
  }

  const results = ranked.map(item => ({
    ...item,
    recoveryTier: rescueMode ? 'post-preflight-rescue' : 'post-preflight-exhaustive',
    ...(rescueMode ? { coverageRescue: true } : {}),
  }));
  const coverage = finalizeCoverageLedger(ledger, {
    rawCandidateCount: raw.length,
    uniqueCandidateCount: unique.length,
    rankedCandidateCount: results.length,
    rescueMode,
  });
  return attachCoverage(results, coverage);
}
