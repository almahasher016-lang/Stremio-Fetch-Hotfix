const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

// Private project defaults: all operational Stremio/add-on numbers and keys are locked here.
// Railway Variables are no longer required for these project settings.
const PRIVATE_DEFAULTS = Object.freeze({
  PROJECT_LOCKED_DEFAULTS: 'true',
  NODE_ENV: 'production',
  ADDON_ID: 'community.m7md-arabic-direct-v233-private',
  ADDON_NAME: 'm7md Arabic Resolver v3.1.2',
  ADDON_DESCRIPTION: 'Private Arabic-first Stremio subtitle resolver with exact-version matching, SSRF-safe bounded downloads, ZIP/GZIP/XZ extraction, SRT/VTT/ASS/SSA normalization, quality validation, and deterministic DTW timeline sync without ذكاء اصطناعي.',
  SUBTITLE_DISPLAY_NAME: 'm7md Arabic',
  PRIVATE_MODE: 'true',
  ENABLE_QUALITY_BADGES: 'true',
  ALLOWED_ORIGINS: '*',
  TRUST_PROXY: 'true',

  AUTO_SYNC_MIN_CONFIDENCE: '70',
  ENABLE_AUTO_SYNC_OPTION: 'true',
  ENABLE_REFERENCE_AUTO_SYNC: 'true',

  ENCODING_PROXY_ENABLED: 'true',
  ENCODING_PROXY_SECRET: 'm7md_arabic_proxy_secret_2026_8f92c7a4b6d14e9caa337b5d0f61e2ab',
  ENCODING_PROXY_CACHE_TTL: '86400',
  ENCODING_PROXY_LINK_TTL: '604800',
  ENCODING_PROXY_MAX_BYTES: '1500000',
  ENCODING_PROXY_MAX_DECOMPRESSED_BYTES: '5000000',
  ENCODING_PROXY_MAX_ARCHIVE_ENTRIES: '32',
  ENCODING_PROXY_MAX_REDIRECTS: '4',
  ENCODING_PROXY_STRIP_MUSIC: 'true',
  ENCODING_PROXY_STRIP_SDH: 'true',

  SUBTITLE_PROVIDERS: 'opensubtitles,subdl,subsource,yify',
  PROVIDER_SEARCH_LANGUAGES: 'ar,ara,arabic',
  PROVIDER_OUTPUT_ARABIC_ONLY: 'true',
  PROVIDER_EXCLUDE_HEARING_IMPAIRED: 'true',
  PROVIDER_EXCLUDE_MACHINE_TRANSLATED: 'false',
  PROVIDER_STRICT_QUALITY_FILTERS: 'true',
  PROVIDER_RETRIES: '3',
  PROVIDER_TIMEOUT_MS: '10000',
  PROVIDER_MAX_RESPONSE_BYTES: '2000000',
  PROVIDER_RETRY_BASE_MS: '250',
  CIRCUIT_BREAKER_LIMIT: '4',
  CIRCUIT_BREAKER_RESET_MS: '30000',
  MAX_PROVIDER_ITEMS: '60',
  TOP_N: '5',
  SEARCH_FULL_SEASON: 'true',

  PREFER_ORIGINAL_ARABIC: 'true',
  MAX_RETURNED_PER_RELEASE: '1',
  MIN_RANK_SCORE: '180',
  STRICT_RELEASE_MATCHING: 'true',
  STREMIO_MAX_SUBTITLES: '6',
  STREMIO_REFERENCE_TOP: '2',
  STREMIO_AUTOSYNC_TOP: '1',
  STREMIO_ORIGINAL_TOP: '5',

  OPENSUBTITLES_API_KEY: 'bXDudrsGCvwG76TwOynPjZMIhfLcoGKG',
  OPENSUBTITLES_TOKEN: '',
  OPENSUBTITLES_USERNAME: 'almahashir',
  OPENSUBTITLES_PASSWORD: 'Mm123456789',
  OPENSUBTITLES_BASE_URL: 'https://api.opensubtitles.com/api/v1',
  OPENSUBTITLES_ORDER_BY: 'download_count',
  OPENSUBTITLES_ORDER_DIRECTION: 'desc',
  OPENSUBTITLES_TRUSTED_ONLY: 'false',

  SUBDL_API_KEY: 'subdl_oeBZXFeP0XqgaywdnkpfkTHE5GXyayHYYYtgYoyHufY',
  SUBDL_BASE_URL: 'https://api.subdl.com/api/v1/subtitles',
  SUBDL_DOWNLOAD_BASE_URL: 'https://dl.subdl.com',

  SUBSOURCE_API_KEY: '',
  SUBSOURCE_BASE_URL: 'https://api.subsource.net',

  YIFY_ENABLED: 'true',
  YIFY_BASE_URL: 'https://yifysubtitles.ch',
  YIFY_MAX_ITEMS: '8',

  PERSONAL_VAULT_ENABLED: 'true',
  PERSONAL_VAULT_UPLOAD_ENABLED: 'true',
  PERSONAL_VAULT_PREFER: 'true',
  PERSONAL_VAULT_PATH: './data/personal-vault.json',
  PERSONAL_VAULT_MAX_ITEMS: '500',
  PERSONAL_VAULT_MAX_SUBTITLE_BYTES: '2000000',
  PERSONAL_VAULT_TOKEN: 'm7md_vault_2026_private_9c82f4a71b',

  REFERENCE_SYNC_LANGUAGE: 'en',
  REFERENCE_SYNC_MIN_CONFIDENCE: '72',
  REFERENCE_SYNC_MIN_CUES: '8',
  REFERENCE_SYNC_MIN_CUE_RATIO: '0.55',
  REFERENCE_SYNC_MAX_ANCHORS: '48',
  REFERENCE_SYNC_ATTACH_TOP: '1',
  REFERENCE_SYNC_AGGRESSIVE_STRETCH: 'false',
  REFERENCE_SYNC_PIECEWISE: 'true',
  REFERENCE_SYNC_MIN_REFERENCE_MATCH_SCORE: '420',
  REFERENCE_SYNC_MIN_ANCHOR_COVERAGE: '0.45',
  REFERENCE_SYNC_MIN_TEMPORAL_AGREEMENT: '0.68',
  REFERENCE_SYNC_DTW_ENABLED: 'true',
  REFERENCE_SYNC_DTW_BAND_RATIO: '0.18',
  REFERENCE_SYNC_DTW_MAX_CUES: '192',
  REFERENCE_SYNC_DTW_GAP_PENALTY: '0.42',
  REFERENCE_SYNC_DTW_MAX_MATCH_COST: '0.52',

  RESOLVER_ENABLED: 'true',
  RESOLVER_METADATA_ENABLED: 'true',
  RESOLVER_METADATA_BASE_URL: 'https://v3-cinemeta.strem.io/meta',
  RESOLVER_METADATA_TIMEOUT_MS: '1800',
  RESOLVER_METADATA_CACHE_TTL: '86400',
  RESOLVER_STAGE_DEADLINE_MS: '4500',
  RESOLVER_MAX_PROVIDERS_PER_STAGE: '3',
  RESOLVER_MAX_REFERENCE_PROVIDERS: '2',
  RESOLVER_UPGRADE_MIN_DELTA: '180',

  VERSION_REGISTRY_ENABLED: 'true',
  VERSION_REGISTRY_PATH: './data/version-registry.json',
  VERSION_REGISTRY_MAX_ITEMS: '5000',
  VERSION_REGISTRY_TOKEN: 'm7md_vault_2026_private_9c82f4a71b',

  QUALITY_GATE_ENABLED: 'true',
  QUALITY_MIN_CUES: '8',
  QUALITY_MIN_ARABIC_RATIO: '0.18',
  QUALITY_MIN_COVERAGE_RATIO: '0.55',

  ENABLE_CONFIGURE_UI: 'true',
  ENABLE_TEST_UI: 'true',
  PREVIEW_MAX_ITEMS: '5',

  ENABLE_PROVIDER_METRICS: 'true',
  METRICS_WINDOW_SIZE: '200',

  CACHE_TTL: '3600',
  CACHE_STALE_SECONDS: '21600',
  SEARCH_CACHE_TTL: '3600',
  SUBTITLE_CACHE_TTL: '86400',
  FAILURE_CACHE_TTL: '120',
  CACHE_KEY_PREFIX: 'subtitles',
  MEMORY_CACHE_MAX_ITEMS: '750',
  CACHE_REFRESH_LOCK_TTL: '60',
  CACHE_STALE_WHILE_REVALIDATE: 'true',
  REDIS_URL: '',

  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_MAX: '180',
});

function setting(key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(PRIVATE_DEFAULTS, key)) return PRIVATE_DEFAULTS[key];
  return fallback;
}

const RELEASE_VERSION = '3.1.2';
const RELEASE_ID = PRIVATE_DEFAULTS.ADDON_ID;
const RELEASE_NAME = PRIVATE_DEFAULTS.ADDON_NAME;
const RELEASE_USER_AGENT = `m7mdArabicDirect/${RELEASE_VERSION}`;

function toInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
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

export const config = Object.freeze({
  app: {
    id: setting('ADDON_ID', RELEASE_ID),
    name: setting('ADDON_NAME', RELEASE_NAME),
    version: RELEASE_VERSION,
    description: setting('ADDON_DESCRIPTION', 'Arabic-first private Stremio subtitle add-on with Personal Vault, hash-first fetching, optional YIFY fallback, and deterministic reference auto-sync. بدون ذكاء اصطناعي, no local proxy dependency.'),
    userAgent: RELEASE_USER_AGENT,
    publicBaseUrl: cleanBaseUrl(process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''),
    subtitleDisplayName: setting('SUBTITLE_DISPLAY_NAME', 'm7md Arabic'),
    privateMode: toBool(setting('PRIVATE_MODE'), true),
    enableQualityBadges: toBool(setting('ENABLE_QUALITY_BADGES'), true),
  },
  server: {
    port: toInt(process.env.PORT, 3000, 1, 65535),
    nodeEnv: setting('NODE_ENV', 'development'),
    isProd: setting('NODE_ENV') === 'production',
    allowedOrigins: setting('ALLOWED_ORIGINS') === '*' ? '*' : (setting('ALLOWED_ORIGINS') ? csv(setting('ALLOWED_ORIGINS')) : '*'),
    trustProxy: toBool(setting('TRUST_PROXY'), true),
  },
  providers: {
    enabled: csv(setting('SUBTITLE_PROVIDERS'), ['opensubtitles', 'subdl', 'subsource', 'yify']).map(p => p.toLowerCase()),
    searchLanguages: csv(setting('PROVIDER_SEARCH_LANGUAGES'), ['ar', 'ara', 'arabic']),
    outputArabicOnly: toBool(setting('PROVIDER_OUTPUT_ARABIC_ONLY'), true),
    excludeHearingImpaired: toBool(setting('PROVIDER_EXCLUDE_HEARING_IMPAIRED'), false),
    excludeMachineTranslated: toBool(setting('PROVIDER_EXCLUDE_MACHINE_TRANSLATED'), true),
    strictQualityFilters: toBool(setting('PROVIDER_STRICT_QUALITY_FILTERS'), false),
    timeoutMs: toInt(setting('PROVIDER_TIMEOUT_MS'), 5000, 500, 20000),
    maxResponseBytes: toInt(setting('PROVIDER_MAX_RESPONSE_BYTES'), 2000000, 50000, 10000000),
    retries: toInt(setting('PROVIDER_RETRIES'), 2, 0, 5),
    retryBaseMs: toInt(setting('PROVIDER_RETRY_BASE_MS'), 250, 0, 3000),
    breakerLimit: toInt(setting('CIRCUIT_BREAKER_LIMIT'), 4, 1, 20),
    breakerResetMs: toInt(setting('CIRCUIT_BREAKER_RESET_MS'), 30000, 1000, 300000),
    topN: toInt(setting('TOP_N'), 5, 1, 20),
    maxProviderItems: toInt(setting('MAX_PROVIDER_ITEMS'), 80, 5, 250),
    searchFullSeason: toBool(setting('SEARCH_FULL_SEASON'), true),
  },
  ranking: {
    preferOriginalArabic: toBool(setting('PREFER_ORIGINAL_ARABIC'), true),
    maxReturnedPerRelease: toInt(setting('MAX_RETURNED_PER_RELEASE'), 1, 1, 5),
    enableAutoSyncOption: toBool(setting('ENABLE_AUTO_SYNC_OPTION'), true),
    autoSyncMinConfidence: toInt(setting('AUTO_SYNC_MIN_CONFIDENCE'), 70, 0, 100),
    enableReferenceAutoSync: toBool(setting('ENABLE_REFERENCE_AUTO_SYNC'), true),
    referenceLanguage: setting('REFERENCE_SYNC_LANGUAGE') || 'en',
    strictReleaseMatching: toBool(setting('STRICT_RELEASE_MATCHING'), true),
    minRankScore: toInt(setting('MIN_RANK_SCORE'), 180, -1000, 3000),
    maxStremioSubtitles: toInt(setting('STREMIO_MAX_SUBTITLES'), 6, 1, 20),
    maxReferenceOptions: toInt(setting('STREMIO_REFERENCE_TOP'), 2, 0, 10),
    maxAutoSyncOptions: toInt(setting('STREMIO_AUTOSYNC_TOP'), 1, 0, 10),
    maxOriginalOptions: toInt(setting('STREMIO_ORIGINAL_TOP'), 5, 0, 20),
  },
  resolver: {
    enabled: toBool(setting('RESOLVER_ENABLED'), true),
    stageDeadlineMs: toInt(setting('RESOLVER_STAGE_DEADLINE_MS'), 4500, 500, 20000),
    maxProvidersPerStage: toInt(setting('RESOLVER_MAX_PROVIDERS_PER_STAGE'), 3, 1, 10),
    maxReferenceProviders: toInt(setting('RESOLVER_MAX_REFERENCE_PROVIDERS'), 2, 1, 10),
    upgradeMinDelta: toInt(setting('RESOLVER_UPGRADE_MIN_DELTA'), 180, 1, 5000),
    metadata: {
      enabled: toBool(setting('RESOLVER_METADATA_ENABLED'), true),
      baseUrl: cleanBaseUrl(setting('RESOLVER_METADATA_BASE_URL', 'https://v3-cinemeta.strem.io/meta')),
      timeoutMs: toInt(setting('RESOLVER_METADATA_TIMEOUT_MS'), 1800, 300, 10000),
      cacheTtlSeconds: toInt(setting('RESOLVER_METADATA_CACHE_TTL'), 86400, 60, 604800),
    },
  },
  ui: {
    configureEnabled: toBool(setting('ENABLE_CONFIGURE_UI'), true),
    testUiEnabled: toBool(setting('ENABLE_TEST_UI'), true),
    previewMaxItems: toInt(setting('PREVIEW_MAX_ITEMS'), 5, 1, 20),
  },
  metrics: {
    enabled: toBool(setting('ENABLE_PROVIDER_METRICS'), true),
    windowSize: toInt(setting('METRICS_WINDOW_SIZE'), 200, 20, 5000),
  },
  referenceSync: {
    enabled: toBool(setting('ENABLE_REFERENCE_AUTO_SYNC'), true),
    minConfidence: toInt(setting('REFERENCE_SYNC_MIN_CONFIDENCE'), 72, 0, 100),
    minCues: toInt(setting('REFERENCE_SYNC_MIN_CUES'), 8, 2, 100),
    minCueRatio: Number(setting('REFERENCE_SYNC_MIN_CUE_RATIO') || 0.55),
    maxAnchors: toInt(setting('REFERENCE_SYNC_MAX_ANCHORS'), 48, 4, 200),
    attachTopReferences: toInt(setting('REFERENCE_SYNC_ATTACH_TOP'), 1, 0, 3),
    allowAggressiveStretch: toBool(setting('REFERENCE_SYNC_AGGRESSIVE_STRETCH'), false),
    piecewise: toBool(setting('REFERENCE_SYNC_PIECEWISE'), true),
    minReferenceMatchScore: toInt(setting('REFERENCE_SYNC_MIN_REFERENCE_MATCH_SCORE'), 420, 0, 5000),
    minAnchorCoverage: Number(setting('REFERENCE_SYNC_MIN_ANCHOR_COVERAGE') || 0.45),
    minTemporalAgreement: Number(setting('REFERENCE_SYNC_MIN_TEMPORAL_AGREEMENT') || 0.68),
    dtwEnabled: toBool(setting('REFERENCE_SYNC_DTW_ENABLED'), true),
    dtwBandRatio: Number(setting('REFERENCE_SYNC_DTW_BAND_RATIO') || 0.18),
    dtwMaxCues: toInt(setting('REFERENCE_SYNC_DTW_MAX_CUES'), 192, 16, 500),
    dtwGapPenalty: Number(setting('REFERENCE_SYNC_DTW_GAP_PENALTY') || 0.42),
    dtwMaxMatchCost: Number(setting('REFERENCE_SYNC_DTW_MAX_MATCH_COST') || 0.52),
  },
  versionRegistry: {
    enabled: toBool(setting('VERSION_REGISTRY_ENABLED'), true),
    storagePath: setting('VERSION_REGISTRY_PATH', './data/version-registry.json'),
    maxItems: toInt(setting('VERSION_REGISTRY_MAX_ITEMS'), 5000, 100, 50000),
    authToken: setting('VERSION_REGISTRY_TOKEN') || setting('PERSONAL_VAULT_TOKEN') || '',
  },
  qualityGate: {
    enabled: toBool(setting('QUALITY_GATE_ENABLED'), true),
    minCues: toInt(setting('QUALITY_MIN_CUES'), 8, 2, 100),
    minArabicRatio: Number(setting('QUALITY_MIN_ARABIC_RATIO') || 0.18),
    minCoverageRatio: Number(setting('QUALITY_MIN_COVERAGE_RATIO') || 0.55),
  },
  encodingProxy: {
    enabled: toBool(setting('ENCODING_PROXY_ENABLED'), true),
    cacheTtlSeconds: toInt(setting('ENCODING_PROXY_CACHE_TTL'), 86400, 300, 2592000),
    linkTtlSeconds: toInt(setting('ENCODING_PROXY_LINK_TTL'), 86400 * 7, 300, 2592000),
    maxBytes: toInt(setting('ENCODING_PROXY_MAX_BYTES'), 1500000, 50000, 10000000),
    maxDecompressedBytes: toInt(setting('ENCODING_PROXY_MAX_DECOMPRESSED_BYTES'), 5000000, 50000, 20000000),
    maxArchiveEntries: toInt(setting('ENCODING_PROXY_MAX_ARCHIVE_ENTRIES'), 32, 1, 200),
    maxRedirects: toInt(setting('ENCODING_PROXY_MAX_REDIRECTS'), 4, 0, 10),
    stripSdhDefault: toBool(setting('ENCODING_PROXY_STRIP_SDH'), false),
    stripMusicNotes: toBool(setting('ENCODING_PROXY_STRIP_MUSIC'), true),
    secret: setting('ENCODING_PROXY_SECRET') || setting('ADDON_SECRET') || '',
  },
  openSubtitles: {
    apiKey: setting('OPENSUBTITLES_API_KEY') || '',
    token: setting('OPENSUBTITLES_TOKEN') || '',
    username: setting('OPENSUBTITLES_USERNAME') || '',
    password: setting('OPENSUBTITLES_PASSWORD') || '',
    baseUrl: cleanBaseUrl(setting('OPENSUBTITLES_BASE_URL', 'https://api.opensubtitles.com/api/v1')),
    orderBy: setting('OPENSUBTITLES_ORDER_BY', 'download_count'),
    orderDirection: setting('OPENSUBTITLES_ORDER_DIRECTION', 'desc'),
    trustedOnly: toBool(setting('OPENSUBTITLES_TRUSTED_ONLY'), false),
  },
  subdl: {
    apiKey: setting('SUBDL_API_KEY') || '',
    baseUrl: cleanBaseUrl(setting('SUBDL_BASE_URL', 'https://api.subdl.com/api/v1/subtitles')),
    downloadBaseUrl: cleanBaseUrl(setting('SUBDL_DOWNLOAD_BASE_URL', 'https://dl.subdl.com')),
  },
  subsource: {
    apiKey: setting('SUBSOURCE_API_KEY') || '',
    baseUrl: cleanBaseUrl(setting('SUBSOURCE_BASE_URL', 'https://api.subsource.net')),
  },
  yify: {
    enabled: toBool(setting('YIFY_ENABLED'), true),
    baseUrl: cleanBaseUrl(setting('YIFY_BASE_URL', 'https://yifysubtitles.ch')),
    maxItems: toInt(setting('YIFY_MAX_ITEMS'), 20, 1, 80),
  },
  vault: {
    enabled: toBool(setting('PERSONAL_VAULT_ENABLED'), true),
    uploadEnabled: toBool(setting('PERSONAL_VAULT_UPLOAD_ENABLED'), true),
    preferVault: toBool(setting('PERSONAL_VAULT_PREFER'), true),
    storagePath: setting('PERSONAL_VAULT_PATH', './data/personal-vault.json'),
    maxItems: toInt(setting('PERSONAL_VAULT_MAX_ITEMS'), 500, 1, 10000),
    maxSubtitleBytes: toInt(setting('PERSONAL_VAULT_MAX_SUBTITLE_BYTES'), 2000000, 1000, 10000000),
    authToken: setting('PERSONAL_VAULT_TOKEN') || '',
  },
  cache: {
    ttlSeconds: toInt(setting('CACHE_TTL'), 3600, 30, 86400),
    staleSeconds: toInt(setting('CACHE_STALE_SECONDS'), 21600, 60, 604800),
    searchTtlSeconds: toInt(setting('SEARCH_CACHE_TTL'), 3600, 30, 86400),
    subtitleTtlSeconds: toInt(setting('SUBTITLE_CACHE_TTL'), 86400, 300, 2592000),
    failureTtlSeconds: toInt(setting('FAILURE_CACHE_TTL'), 120, 0, 3600),
    refreshLockTtlSeconds: toInt(setting('CACHE_REFRESH_LOCK_TTL'), 60, 5, 300),
    redisUrl: setting('REDIS_URL') || '',
    memoryMaxItems: toInt(setting('MEMORY_CACHE_MAX_ITEMS'), 750, 50, 10000),
    keyPrefix: cachePrefix(setting('CACHE_KEY_PREFIX', 'subtitles')),
    staleWhileRevalidate: toBool(setting('CACHE_STALE_WHILE_REVALIDATE'), true),
  },
  rateLimit: {
    windowMs: toInt(setting('RATE_LIMIT_WINDOW_MS'), 60000, 1000, 3600000),
    max: toInt(setting('RATE_LIMIT_MAX'), 180, 1, 10000),
  },
});
