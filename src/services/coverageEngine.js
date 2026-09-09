import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { createSearchPlan } from './searchPlanner.js';

function clean(value) {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== ''))];
}

function mediaSupported(provider, type) {
  return provider?.supports?.[type] !== false;
}

export function eligibleProviderNames(providerDefinitions = {}, enabledNames = [], {
  language = 'ar',
  mediaType = 'movie',
  references = false,
} = {}) {
  return unique(enabledNames)
    .map(name => String(name).toLowerCase())
    .filter(name => {
      const provider = providerDefinitions[name];
      if (!provider?.configured?.() || !mediaSupported(provider, mediaType)) return false;
      if (references && !provider.supports?.reference) return false;
      if (language === 'en' && !provider.supports?.reference) return false;
      return true;
    });
}

function coverageVariant(reason, identity, overrides = {}) {
  return {
    reason,
    type: identity.type,
    query: identity.title || identity.query || identity.filename || identity.catalogId,
    title: identity.title || identity.query || '',
    aliases: identity.aliases || [],
    imdbId: identity.imdbId,
    tmdbId: identity.tmdbId,
    season: identity.season,
    episode: identity.episode,
    filename: identity.filename,
    year: identity.year,
    videoHash: identity.videoHash,
    videoSize: identity.videoSize,
    durationMs: identity.durationMs,
    relaxedFallback: true,
    coveragePass: true,
    ...overrides,
  };
}

function dedupeVariants(variants = []) {
  const seen = new Set();
  return variants.filter(variant => {
    const key = JSON.stringify({
      q: variant.query || '',
      t: variant.title || '',
      imdb: variant.imdbId || '',
      tmdb: variant.tmdbId || '',
      s: variant.season ?? '',
      e: variant.episode ?? '',
      f: variant.filename || '',
      y: variant.year ?? '',
      h: variant.videoHash || '',
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function yearWindow(identity) {
  const releaseYear = Number(identity.year) || null;
  const catalogYear = Number(identity.catalogYear) || null;
  const values = [releaseYear, catalogYear];
  if (releaseYear) values.push(releaseYear - 1, releaseYear + 1);
  if (catalogYear && catalogYear !== releaseYear) values.push(catalogYear - 1, catalogYear + 1);
  return unique(values.filter(year => Number.isInteger(year) && year >= 1880 && year <= 2200));
}

function seriesEpisodeQueries(identity) {
  if (identity.type !== 'series' || identity.season === null || identity.season === undefined || !identity.episode) return [];
  const title = clean(identity.title || identity.query);
  if (!title) return [];
  const season = Number(identity.season);
  const episode = Number(identity.episode);
  const sxe = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  const oneX = `${season}x${String(episode).padStart(2, '0')}`;
  const queries = [
    `${title} ${sxe}`,
    `${title} ${oneX}`,
  ];
  if (identity.episodeTitle) queries.push(`${title} ${identity.episodeTitle}`);
  return unique(queries);
}

export function createExhaustiveCoveragePlan(search = {}, providerDefinitions = {}, enabledNames = [], {
  language = 'ar',
  maxAliases = 5,
  includeHash = true,
} = {}) {
  const identity = buildVideoIdentity(search);
  const providers = eligibleProviderNames(providerDefinitions, enabledNames, {
    language,
    mediaType: identity.type,
  });
  if (!providers.length) return [];

  const plan = createSearchPlan(identity, providerDefinitions, providers, {
    language,
    maxProvidersPerStage: providers.length,
    includeHash,
    relaxed: true,
    maxAliases,
  });

  const extraStages = [];
  if (identity.imdbId || identity.tmdbId) {
    extraStages.push({
      name: 'coverage-metadata-yearless',
      providers,
      variants: [coverageVariant('coverage-metadata-yearless', identity, {
        query: '',
        filename: '',
        year: null,
        videoHash: null,
        videoSize: null,
      })],
    });
  }

  const title = clean(identity.title || identity.query);
  if (title) {
    extraStages.push({
      name: 'coverage-title-yearless',
      providers,
      variants: [coverageVariant('coverage-title-yearless', identity, {
        query: title,
        filename: '',
        imdbId: null,
        tmdbId: null,
        year: null,
        videoHash: null,
        videoSize: null,
      })],
    });
  }

  if (identity.type === 'movie' && title) {
    const variants = yearWindow(identity).map(year => coverageVariant('coverage-title-year-window', identity, {
      query: `${title} ${year}`,
      filename: '',
      imdbId: null,
      tmdbId: null,
      year,
      videoHash: null,
      videoSize: null,
    }));
    if (variants.length) {
      extraStages.push({
        name: 'coverage-title-year-window',
        providers,
        variants,
      });
    }
  }

  if (identity.type === 'series') {
    const variants = seriesEpisodeQueries(identity).map(query => coverageVariant('coverage-episode-pattern', identity, {
      query,
      filename: '',
      imdbId: null,
      tmdbId: null,
      year: null,
      videoHash: null,
      videoSize: null,
    }));
    if (variants.length) {
      extraStages.push({
        name: 'coverage-episode-pattern',
        providers,
        variants,
      });
    }
  }

  return [...plan, ...extraStages]
    .map(stage => ({ ...stage, variants: dedupeVariants(stage.variants) }))
    .filter(stage => stage.providers.length && stage.variants.length);
}

export function createCoverageLedger(search = {}, eligibleProviders = []) {
  const identity = buildVideoIdentity(search);
  const providers = Object.fromEntries(unique(eligibleProviders).map(name => [name, {
    attemptedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    candidates: 0,
  }]));
  return {
    mediaType: identity.type,
    catalogId: identity.catalogId || null,
    season: identity.season ?? null,
    episode: identity.episode ?? null,
    eligibleProviders: Object.keys(providers),
    providers,
    stagesAttempted: [],
    rawCandidateCount: 0,
    uniqueCandidateCount: 0,
    rankedCandidateCount: 0,
    rescueMode: false,
  };
}

function providerRow(ledger, providerName) {
  ledger.providers[providerName] ??= {
    attemptedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    candidates: 0,
  };
  return ledger.providers[providerName];
}

export function recordCoverageStage(ledger, stageName) {
  if (!ledger || !stageName) return;
  if (!ledger.stagesAttempted.includes(stageName)) ledger.stagesAttempted.push(stageName);
}

export function recordCoverageAttempt(ledger, providerName) {
  if (!ledger) return;
  providerRow(ledger, providerName).attemptedCalls += 1;
}

export function recordCoverageSuccess(ledger, providerName, candidateCount = 0) {
  if (!ledger) return;
  const row = providerRow(ledger, providerName);
  row.successfulCalls += 1;
  row.candidates += Math.max(0, Number(candidateCount) || 0);
}

export function recordCoverageFailure(ledger, providerName) {
  if (!ledger) return;
  providerRow(ledger, providerName).failedCalls += 1;
}

export function finalizeCoverageLedger(ledger, {
  rawCandidateCount = 0,
  uniqueCandidateCount = 0,
  rankedCandidateCount = 0,
  rescueMode = false,
} = {}) {
  if (!ledger) return null;
  ledger.rawCandidateCount = Math.max(0, Number(rawCandidateCount) || 0);
  ledger.uniqueCandidateCount = Math.max(0, Number(uniqueCandidateCount) || 0);
  ledger.rankedCandidateCount = Math.max(0, Number(rankedCandidateCount) || 0);
  ledger.rescueMode = Boolean(rescueMode);

  const eligible = ledger.eligibleProviders || [];
  const attempted = eligible.filter(name => (ledger.providers[name]?.attemptedCalls || 0) > 0);
  const failed = eligible.filter(name => (ledger.providers[name]?.failedCalls || 0) > 0);
  const completed = eligible.filter(name => {
    const row = ledger.providers[name];
    return row && row.attemptedCalls > 0 && row.failedCalls === 0;
  });
  const coverageRatio = eligible.length ? attempted.length / eligible.length : 1;
  const complete = attempted.length === eligible.length && failed.length === 0;
  const status = complete ? 'complete' : (attempted.length ? 'degraded' : 'failed');
  const zeroResultState = ledger.rankedCandidateCount > 0
    ? 'candidates-found'
    : (complete ? 'confirmed-empty' : 'search-incomplete');

  return {
    mediaType: ledger.mediaType,
    catalogId: ledger.catalogId,
    season: ledger.season,
    episode: ledger.episode,
    eligibleProviders: eligible,
    attemptedProviders: attempted,
    completedProviders: completed,
    failedProviders: failed,
    providerCalls: ledger.providers,
    stagesAttempted: ledger.stagesAttempted,
    coverageRatio: Number(coverageRatio.toFixed(4)),
    status,
    zeroResultState,
    rawCandidateCount: ledger.rawCandidateCount,
    uniqueCandidateCount: ledger.uniqueCandidateCount,
    rankedCandidateCount: ledger.rankedCandidateCount,
    rescueMode: ledger.rescueMode,
  };
}

export function availabilityTier(item = {}, proofDecision = '') {
  const exactHash = Boolean(
    item.matchedByHash
    || item.sourceType === 'personal-vault-exact-hash'
    || item.sourceType === 'version-registry-exact-hash'
    || (item.scoreReasons || []).some(reason => reason?.reason === 'exact-video-hash-match'),
  );
  if (exactHash) return 'EXACT';
  const decision = String(proofDecision || '').toLowerCase();
  if (decision === 'certified') return 'CERTIFIED';
  if (decision === 'safe') return 'SAFE';
  if (decision === 'recovery') return 'RECOVERY';
  return 'UNKNOWN';
}
