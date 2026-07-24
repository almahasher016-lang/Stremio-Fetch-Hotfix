import { buildVideoIdentity } from '../utils/videoIdentity.js';

function configuredProviders(providerDefinitions, enabledNames, language, mediaType, { hashOnly = false, referenceOnly = false, max = Infinity } = {}) {
  return enabledNames
    .map(name => providerDefinitions[name])
    .filter(Boolean)
    .filter(provider => provider.configured())
    .filter(provider => provider.supports[mediaType] !== false)
    .filter(provider => !hashOnly || provider.supports.hash)
    .filter(provider => !referenceOnly || provider.supports.reference)
    .filter(provider => language !== 'en' || provider.supports.reference)
    .slice(0, max)
    .map(provider => provider.name);
}

function variant(reason, search, overrides = {}) {
  return {
    reason,
    type: search.type,
    query: search.title || search.query || search.filename || search.catalogId,
    title: search.title || search.query || '',
    aliases: search.aliases || [],
    imdbId: search.imdbId,
    tmdbId: search.tmdbId,
    season: search.season,
    episode: search.episode,
    filename: search.filename,
    year: search.year,
    videoHash: search.videoHash,
    videoSize: search.videoSize,
    durationMs: search.durationMs,
    ...overrides,
  };
}

export function createSearchPlan(search = {}, providerDefinitions = {}, enabledNames = [], {
  language = 'ar',
  maxProvidersPerStage = 3,
  includeHash = true,
  references = false,
} = {}) {
  const identity = buildVideoIdentity(search);
  const providerOptions = {
    referenceOnly: references,
    max: references ? Math.min(maxProvidersPerStage, 2) : maxProvidersPerStage,
  };
  const stages = [];

  if (includeHash && identity.videoHash) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, { ...providerOptions, hashOnly: true });
    if (providers.length) {
      stages.push({
        name: 'exact-hash',
        providers,
        stopOnExactHash: true,
        variants: [variant('exact-hash', identity, { query: identity.filename || identity.title || identity.query })],
      });
    }
  }

  if (identity.imdbId || identity.tmdbId) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);
    if (providers.length) {
      stages.push({
        name: 'exact-metadata',
        providers,
        variants: [variant('exact-metadata', identity, { videoHash: null, videoSize: null })],
      });
    }
  }

  if (identity.filename) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);
    if (providers.length) {
      stages.push({
        name: 'release-fallback',
        providers,
        variants: [variant('release-fallback', identity, {
          query: identity.filename,
          imdbId: identity.imdbId,
          tmdbId: identity.tmdbId,
          videoHash: null,
          videoSize: null,
        })],
      });
    }
  }

  if (identity.title || identity.query) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);
    if (providers.length) {
      stages.push({
        name: 'title-fallback',
        providers,
        variants: [variant('title-fallback', identity, {
          query: identity.title || identity.query,
          filename: '',
          videoHash: null,
          videoSize: null,
        })],
      });
    }
  }

  return stages;
}
