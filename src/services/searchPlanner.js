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
  relaxed = false,
  maxAliases = 2,
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
        variants: [variant('exact-hash', identity, {
          query: '',
          title: '',
          filename: '',
          imdbId: null,
          tmdbId: null,
          year: null,
        })],
      });
    }
  }

  if (identity.imdbId || identity.tmdbId) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);
    if (providers.length) {
      stages.push({
        name: 'exact-metadata',
        providers,
        variants: [variant('exact-metadata', identity, {
          query: '',
          filename: '',
          videoHash: null,
          videoSize: null,
          relaxedFallback: relaxed,
        })],
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
          imdbId: null,
          tmdbId: null,
          videoHash: null,
          videoSize: null,
          relaxedFallback: relaxed,
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
          imdbId: null,
          tmdbId: null,
          videoHash: null,
          videoSize: null,
          relaxedFallback: relaxed,
        })],
      });
    }
  }

  const canonical = String(identity.title || identity.query || '').trim().toLowerCase();
  const aliases = [...new Set((identity.aliases || [])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
    .filter(value => value.toLowerCase() !== canonical)
    .slice(0, Math.max(0, maxAliases));
  if (aliases.length) {
    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);
    if (providers.length) {
      stages.push({
        name: 'alias-fallback',
        providers,
        variants: aliases.map(alias => variant('alias-fallback', identity, {
          query: alias,
          title: alias,
          filename: '',
          imdbId: null,
          tmdbId: null,
          videoHash: null,
          videoSize: null,
          relaxedFallback: relaxed,
        })),
      });
    }
  }

  return stages;
}
