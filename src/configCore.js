import { RELEASE_ID, RELEASE_NAME, RELEASE_USER_AGENT, RELEASE_VERSION } from './release.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function setting(env, key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(env, key)) {
    const value = env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return fallback;
}

function toInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toNumber(value, fallback, min = -Infinity, max = Infinity) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function csv(value, fallback = []) {
  if (!value) return fallback;
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function cachePrefix(value) {
  const base = String(value || 'subtitles').trim().replace(/:+$/, '') || 'subtitles';
  return `${base}:release:${RELEASE_VERSION}`;
}

function railwayBaseUrl(env) {
  const explicit = cleanBaseUrl(setting(env, 'PUBLIC_BASE_URL'));
  const domain = String(env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/^https?:\/\//i, '');
  const candidate = explicit || (domain ? `https://${domain.replace(/\/+$/, '')}` : '');
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (
      !['https:', 'http:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      throw new Error('invalid public origin');
    }
    return parsed.origin;
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without credentials or a path');
  }
}

export function buildConfig(env = process.env) {
  const get = (key, fallback = '') => setting(env, key, fallback);
  const adminToken = get('ADMIN_TOKEN') || get('PERSONAL_VAULT_TOKEN') || get('VERSION_REGISTRY_TOKEN');
  const nodeEnv = get('NODE_ENV', 'development');

  return {
    app: {
      id: get('ADDON_ID', RELEASE_ID),
      name: get('ADDON_NAME', RELEASE_NAME),
      version: RELEASE_VERSION,
      description: get(
        'ADDON_DESCRIPTION',
        'Private Arabic-first Stremio subtitle resolver with exact-version matching, bounded downloads, Arabic quality validation, Personal Vault, and deterministic synchronization without AI.',
      ),
      userAgent: RELEASE_USER_AGENT,
      publicBaseUrl: railwayBaseUrl(env),
      subtitleDisplayName: get('SUBTITLE_DISPLAY_NAME', 'm7md Arabic'),
      privateMode: toBool(get('PRIVATE_MODE'), true),
      enableQualityBadges: toBool(get('ENABLE_QUALITY_BADGES'), true),
    },
    admin: {
      token: adminToken,
      allowedOrigins: csv(get('ADMIN_ALLOWED_ORIGINS')),
    },
    server: {
      port: toInt(env.PORT, 3000, 1, 65535),
      nodeEnv,
      isProd: nodeEnv === 'production',
      trustProxy: toBool(get('TRUST_PROXY'), true),
    },
    providers: {
      enabled: csv(get('SUBTITLE_PROVIDERS'), ['opensubtitles', 'subdl', 'subsource', 'yify'])
        .map(provider => provider.toLowerCase()),
      searchLanguages: csv(get('PROVIDER_SEARCH_LANGUAGES'), ['ar', 'ara', 'arabic']),
      outputArabicOnly: toBool(get('PROVIDER_OUTPUT_ARABIC_ONLY'), true),
      excludeHearingImpaired: toBool(get('PROVIDER_EXCLUDE_HEARING_IMPAIRED'), true),
      excludeMachineTranslated: toBool(get('PROVIDER_EXCLUDE_MACHINE_TRANSLATED'), true),
      strictQualityFilters: toBool(get('PROVIDER_STRICT_QUALITY_FILTERS'), true),
      timeoutMs: toInt(get('PROVIDER_TIMEOUT_MS'), 10000, 500, 20000),
      maxResponseBytes: toInt(get('PROVIDER_MAX_RESPONSE_BYTES'), 2_000_000, 50_000, 10_000_000),
      retries: toInt(get('PROVIDER_RETRIES'), 3, 0, 5),
      retryBaseMs: toInt(get('PROVIDER_RETRY_BASE_MS'), 250, 0, 3000),
      breakerLimit: toInt(get('CIRCUIT_BREAKER_LIMIT'), 4, 1, 20),
      breakerResetMs: toInt(get('CIRCUIT_BREAKER_RESET_MS'), 30000, 1000, 300000),
      breakerMaxResetMs: toInt(get('CIRCUIT_BREAKER_MAX_RESET_MS'), 240000, 1000, 1800000),
      maxConcurrentPerProvider: toInt(get('PROVIDER_MAX_CONCURRENT'), 2, 1, 10),
      minIntervalMsPerProvider: toInt(get('PROVIDER_MIN_INTERVAL_MS'), 100, 0, 5000),
      topN: toInt(get('TOP_N'), 5, 1, 20),
      maxProviderItems: toInt(get('MAX_PROVIDER_ITEMS'), 60, 5, 250),
      searchFullSeason: toBool(get('SEARCH_FULL_SEASON'), true),
    },
    ranking: {
      preferOriginalArabic: toBool(get('PREFER_ORIGINAL_ARABIC'), true),
      maxReturnedPerRelease: toInt(get('MAX_RETURNED_PER_RELEASE'), 1, 1, 5),
      enableAutoSyncOption: toBool(get('ENABLE_AUTO_SYNC_OPTION'), true),
      autoSyncMinConfidence: toInt(get('AUTO_SYNC_MIN_CONFIDENCE'), 70, 0, 100),
      enableReferenceAutoSync: toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), true),
      referenceLanguage: get('REFERENCE_SYNC_LANGUAGE', 'en'),
      strictReleaseMatching: toBool(get('STRICT_RELEASE_MATCHING'), true),
      minRankScore: toInt(get('MIN_RANK_SCORE'), 180, -1000, 3000),
      maxStremioSubtitles: toInt(get('STREMIO_MAX_SUBTITLES'), 6, 1, 20),
      maxReferenceOptions: toInt(get('STREMIO_REFERENCE_TOP'), 2, 0, 10),
      maxAutoSyncOptions: toInt(get('STREMIO_AUTOSYNC_TOP'), 1, 0, 10),
      maxOriginalOptions: toInt(get('STREMIO_ORIGINAL_TOP'), 5, 0, 20),
    },
    resolver: {
      enabled: toBool(get('RESOLVER_ENABLED'), true),
      stageDeadlineMs: toInt(get('RESOLVER_STAGE_DEADLINE_MS'), 4500, 500, 20000),
      maxProvidersPerStage: toInt(get('RESOLVER_MAX_PROVIDERS_PER_STAGE'), 3, 1, 10),
      maxReferenceProviders: toInt(get('RESOLVER_MAX_REFERENCE_PROVIDERS'), 2, 1, 10),
      upgradeMinDelta: toInt(get('RESOLVER_UPGRADE_MIN_DELTA'), 180, 1, 5000),
      metadata: {
        enabled: toBool(get('RESOLVER_METADATA_ENABLED'), true),
        baseUrl: cleanBaseUrl(get('RESOLVER_METADATA_BASE_URL', 'https://v3-cinemeta.strem.io/meta')),
        timeoutMs: toInt(get('RESOLVER_METADATA_TIMEOUT_MS'), 1800, 300, 10000),
        cacheTtlSeconds: toInt(get('RESOLVER_METADATA_CACHE_TTL'), 86400, 60, 604800),
      },
    },
    ui: {
      configureEnabled: toBool(get('ENABLE_CONFIGURE_UI'), true),
      testUiEnabled: toBool(get('ENABLE_TEST_UI'), true),
      previewMaxItems: toInt(get('PREVIEW_MAX_ITEMS'), 5, 1, 20),
    },
    metrics: {
      enabled: toBool(get('ENABLE_PROVIDER_METRICS'), true),
      windowSize: toInt(get('METRICS_WINDOW_SIZE'), 200, 20, 5000),
    },
    referenceSync: {
      enabled: toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), true),
      minConfidence: toInt(get('REFERENCE_SYNC_MIN_CONFIDENCE'), 72, 0, 100),
      minCues: toInt(get('REFERENCE_SYNC_MIN_CUES'), 8, 2, 100),
      minCueRatio: toNumber(get('REFERENCE_SYNC_MIN_CUE_RATIO'), 0.55, 0, 1),
      maxAnchors: toInt(get('REFERENCE_SYNC_MAX_ANCHORS'), 48, 4, 200),
      attachTopReferences: toInt(get('REFERENCE_SYNC_ATTACH_TOP'), 1, 0, 3),
      allowAggressiveStretch: toBool(get('REFERENCE_SYNC_AGGRESSIVE_STRETCH'), false),
      piecewise: toBool(get('REFERENCE_SYNC_PIECEWISE'), true),
      minReferenceMatchScore: toInt(get('REFERENCE_SYNC_MIN_REFERENCE_MATCH_SCORE'), 420, 0, 5000),
      minAnchorCoverage: toNumber(get('REFERENCE_SYNC_MIN_ANCHOR_COVERAGE'), 0.45, 0, 1),
      minTemporalAgreement: toNumber(get('REFERENCE_SYNC_MIN_TEMPORAL_AGREEMENT'), 0.68, 0, 1),
      dtwEnabled: toBool(get('REFERENCE_SYNC_DTW_ENABLED'), true),
      dtwBandRatio: toNumber(get('REFERENCE_SYNC_DTW_BAND_RATIO'), 0.18, 0.01, 1),
      dtwMaxCues: toInt(get('REFERENCE_SYNC_DTW_MAX_CUES'), 192, 16, 500),
      dtwGapPenalty: toNumber(get('REFERENCE_SYNC_DTW_GAP_PENALTY'), 0.42, 0, 10),
      dtwMaxMatchCost: toNumber(get('REFERENCE_SYNC_DTW_MAX_MATCH_COST'), 0.52, 0, 10),
    },
    versionRegistry: {
      enabled: toBool(get('VERSION_REGISTRY_ENABLED'), true),
      storagePath: get('VERSION_REGISTRY_PATH', './data/version-registry.json'),
      maxItems: toInt(get('VERSION_REGISTRY_MAX_ITEMS'), 5000, 100, 50000),
      authToken: adminToken,
    },
    qualityGate: {
      enabled: toBool(get('QUALITY_GATE_ENABLED'), true),
      minCues: toInt(get('QUALITY_MIN_CUES'), 8, 2, 100),
      minArabicRatio: toNumber(get('QUALITY_MIN_ARABIC_RATIO'), 0.18, 0, 1),
      minCoverageRatio: toNumber(get('QUALITY_MIN_COVERAGE_RATIO'), 0.55, 0, 1),
    },
    encodingProxy: {
      enabled: toBool(get('ENCODING_PROXY_ENABLED'), true),
      cacheTtlSeconds: toInt(get('ENCODING_PROXY_CACHE_TTL'), 86400, 300, 2592000),
      linkTtlSeconds: toInt(get('ENCODING_PROXY_LINK_TTL'), 604800, 300, 2592000),
      maxBytes: toInt(get('ENCODING_PROXY_MAX_BYTES'), 1_500_000, 50_000, 10_000_000),
      maxDecompressedBytes: toInt(get('ENCODING_PROXY_MAX_DECOMPRESSED_BYTES'), 5_000_000, 50_000, 20_000_000),
      maxArchiveEntries: toInt(get('ENCODING_PROXY_MAX_ARCHIVE_ENTRIES'), 32, 1, 200),
      maxFallbacks: toInt(get('ENCODING_PROXY_MAX_FALLBACKS'), 2, 0, 4),
      maxRedirects: toInt(get('ENCODING_PROXY_MAX_REDIRECTS'), 4, 0, 10),
      stripSdhDefault: toBool(get('ENCODING_PROXY_STRIP_SDH'), true),
      stripMusicNotes: toBool(get('ENCODING_PROXY_STRIP_MUSIC'), true),
      secret: get('ENCODING_PROXY_SECRET') || get('ADDON_SECRET'),
    },
    openSubtitles: {
      apiKey: get('OPENSUBTITLES_API_KEY'),
      token: get('OPENSUBTITLES_TOKEN'),
      baseUrl: cleanBaseUrl(get('OPENSUBTITLES_BASE_URL', 'https://api.opensubtitles.com/api/v1')),
      orderBy: get('OPENSUBTITLES_ORDER_BY', 'download_count'),
      orderDirection: get('OPENSUBTITLES_ORDER_DIRECTION', 'desc'),
      trustedOnly: toBool(get('OPENSUBTITLES_TRUSTED_ONLY'), false),
    },
    subdl: {
      apiKey: get('SUBDL_API_KEY'),
      baseUrl: cleanBaseUrl(get('SUBDL_BASE_URL', 'https://api.subdl.com/api/v1/subtitles')),
      downloadBaseUrl: cleanBaseUrl(get('SUBDL_DOWNLOAD_BASE_URL', 'https://dl.subdl.com')),
    },
    subsource: {
      apiKey: get('SUBSOURCE_API_KEY'),
      baseUrl: cleanBaseUrl(get('SUBSOURCE_BASE_URL', 'https://api.subsource.net')),
    },
    yify: {
      enabled: toBool(get('YIFY_ENABLED'), true),
      baseUrl: cleanBaseUrl(get('YIFY_BASE_URL', 'https://yifysubtitles.ch')),
      maxItems: toInt(get('YIFY_MAX_ITEMS'), 8, 1, 80),
    },
    vault: {
      enabled: toBool(get('PERSONAL_VAULT_ENABLED'), true),
      uploadEnabled: toBool(get('PERSONAL_VAULT_UPLOAD_ENABLED'), true),
      preferVault: toBool(get('PERSONAL_VAULT_PREFER'), true),
      storagePath: get('PERSONAL_VAULT_PATH', './data/personal-vault.json'),
      maxItems: toInt(get('PERSONAL_VAULT_MAX_ITEMS'), 500, 1, 10000),
      maxSubtitleBytes: toInt(get('PERSONAL_VAULT_MAX_SUBTITLE_BYTES'), 2_000_000, 1000, 10_000_000),
      authToken: adminToken,
    },
    cache: {
      ttlSeconds: toInt(get('CACHE_TTL'), 3600, 30, 86400),
      staleSeconds: toInt(get('CACHE_STALE_SECONDS'), 21600, 60, 604800),
      searchTtlSeconds: toInt(get('SEARCH_CACHE_TTL'), 3600, 30, 86400),
      subtitleTtlSeconds: toInt(get('SUBTITLE_CACHE_TTL'), 86400, 300, 2592000),
      failureTtlSeconds: toInt(get('FAILURE_CACHE_TTL'), 120, 0, 3600),
      refreshLockTtlSeconds: toInt(get('CACHE_REFRESH_LOCK_TTL'), 60, 5, 300),
      redisUrl: get('REDIS_URL'),
      memoryMaxItems: toInt(get('MEMORY_CACHE_MAX_ITEMS'), 750, 50, 10000),
      keyPrefix: cachePrefix(get('CACHE_KEY_PREFIX', 'subtitles')),
      staleWhileRevalidate: toBool(get('CACHE_STALE_WHILE_REVALIDATE'), true),
    },
    rateLimit: {
      windowMs: toInt(get('RATE_LIMIT_WINDOW_MS'), 60000, 1000, 3600000),
      max: toInt(get('RATE_LIMIT_MAX'), 180, 1, 10000),
      adminWindowMs: toInt(get('ADMIN_RATE_LIMIT_WINDOW_MS'), 60000, 1000, 3600000),
      adminMax: toInt(get('ADMIN_RATE_LIMIT_MAX'), 60, 1, 1000),
    },
  };
}

export const config = Object.freeze(buildConfig());

export function validateRuntimeConfig(runtime = config) {
  if (!runtime.server.isProd) return;
  const invalid = [];
  if (runtime.encodingProxy.enabled && Buffer.byteLength(runtime.encodingProxy.secret || '', 'utf8') < 32) {
    invalid.push('ENCODING_PROXY_SECRET (minimum 32 bytes)');
  }
  const adminRequired = runtime.app.privateMode
    || runtime.vault.enabled
    || runtime.versionRegistry.enabled
    || runtime.ui.testUiEnabled;
  if (adminRequired && Buffer.byteLength(runtime.admin.token || '', 'utf8') < 32) {
    invalid.push('ADMIN_TOKEN (minimum 32 bytes)');
  }
  if (runtime.admin.token && runtime.admin.token === runtime.encodingProxy.secret) {
    invalid.push('ADMIN_TOKEN must differ from ENCODING_PROXY_SECRET');
  }
  if (invalid.length) {
    throw new Error(`Invalid production configuration: ${invalid.join(', ')}`);
  }
}
