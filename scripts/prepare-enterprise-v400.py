from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'anchor mismatch in {path}: {old[:80]!r} count={text.count(old)}')
    p.write_text(text.replace(old, new, 1))


def write(path, content):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


# --- Accuracy preflight service -------------------------------------------------
write('src/services/accuracyPreflight.js', r'''import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';
import { preflightSubtitleCandidate } from '../utils/encodingProxy.js';
import { recordAccuracyPreflight } from '../utils/metrics.js';

const HARD_REJECT_REASONS = new Set(['low-arabic-ratio', 'too-few-cues', 'invalid-timed-cues']);

function candidateKey(item = {}, search = {}) {
  const payload = JSON.stringify({
    provider: item.originalProvider || item.provider || '',
    providerId: item.providerId || item.fileId || item.id || '',
    download: item.download || item.url || '',
    movieHash: item.movieHash || item.hash || '',
    release: item.releaseName || item.fileName || item.name || '',
    durationMs: search.durationMs || null,
    fps: search.fps || search.extra?.fps || null,
  });
  return `accuracy-preflight:${createHash('sha256').update(payload).digest('hex')}`;
}

function normalizeOutcome(raw = {}, elapsedMs = 0) {
  const quality = raw.quality || null;
  const reasons = Array.isArray(quality?.reasons) ? quality.reasons : [];
  const hardReject = reasons.some(reason => HARD_REJECT_REASONS.has(reason));
  return {
    state: hardReject ? 'rejected' : quality?.valid === true ? 'valid' : 'degraded',
    quality,
    encoding: raw.encoding || null,
    format: raw.format || null,
    archive: raw.archive || null,
    archiveEntry: raw.archiveEntry || null,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

function outcomeFromError(error, elapsedMs = 0) {
  const invalidTimedCues = Number(error?.status || error?.statusCode || 0) === 422
    && /timed cues/i.test(String(error?.message || ''));
  return {
    state: invalidTimedCues ? 'rejected' : 'unavailable',
    quality: invalidTimedCues
      ? { valid: false, score: 0, reasons: ['invalid-timed-cues'] }
      : null,
    error: String(error?.message || error || 'preflight unavailable').slice(0, 180),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
  };
}

async function inspectOne(item, search, {
  preflightImpl,
  cacheGetImpl,
  cacheSetImpl,
} = {}) {
  if (item?.quality?.valid === true) {
    return {
      state: 'valid',
      quality: item.quality,
      source: 'existing-quality',
      elapsedMs: 0,
    };
  }

  const key = candidateKey(item, search);
  const cached = await cacheGetImpl(key);
  if (cached?.state) return { ...cached, source: 'shared-cache' };

  const started = Date.now();
  const timeoutMs = config.accuracyPreflight.timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let outcome;
  try {
    const result = await preflightImpl(item, search, { signal });
    outcome = normalizeOutcome(result, Date.now() - started);
  } catch (error) {
    outcome = outcomeFromError(error, Date.now() - started);
  }

  recordAccuracyPreflight(outcome.state, outcome.elapsedMs);
  if (outcome.state !== 'unavailable') {
    await cacheSetImpl(
      key,
      outcome,
      config.accuracyPreflight.cacheTtlSeconds,
      config.cache.staleSeconds,
    );
  }
  return { ...outcome, source: 'live-preflight' };
}

export async function applyAccuracyPreflight(results = [], search = {}, {
  preflightImpl = preflightSubtitleCandidate,
  cacheGetImpl = cacheGet,
  cacheSetImpl = cacheSet,
} = {}) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  if (!config.accuracyPreflight.enabled || config.accuracyPreflight.topN <= 0 || ranked.length === 0) {
    return ranked;
  }

  const inspected = new Map();
  const targets = ranked.slice(0, config.accuracyPreflight.topN);
  await Promise.all(targets.map(async item => {
    const key = candidateKey(item, search);
    const outcome = await inspectOne(item, search, { preflightImpl, cacheGetImpl, cacheSetImpl });
    inspected.set(key, outcome);
  }));

  const decorated = ranked.map(item => {
    const outcome = inspected.get(candidateKey(item, search));
    return outcome ? { ...item, accuracyPreflight: outcome } : item;
  });

  // Only hard content failures are removed. Slow/unavailable preflight never hides a subtitle.
  const survivors = decorated.filter(item => item.accuracyPreflight?.state !== 'rejected');
  return prioritizeAccurateSubtitles(survivors, search);
}

export function __candidatePreflightKeyForTests(item, search) {
  return candidateKey(item, search);
}
''')

# --- Explainability -------------------------------------------------------------
write('src/utils/explainRanking.js', r'''function reasonLabels(item = {}) {
  const labels = [];
  const scoreReasons = Array.isArray(item.scoreReasons) ? item.scoreReasons : [];
  if (item.sourceType === 'version-registry-exact-hash') labels.push('verified-version-exact-hash');
  if (item.sourceType === 'personal-vault-exact-hash') labels.push('personal-vault-exact-hash');
  if (scoreReasons.some(reason => reason.reason === 'exact-video-hash-match')) labels.push('exact-video-hash');
  if (scoreReasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) labels.push('provider-confirmed-hash');
  if (item.releaseMatch?.tier) labels.push(`release-tier-${item.releaseMatch.tier}`);
  if (item.releaseMatch?.criticalMismatches === 0) labels.push('no-critical-release-conflicts');
  if (item.accuracyPreflight?.state === 'valid') labels.push('content-preflight-valid');
  if (item.accuracyPreflight?.state === 'degraded') labels.push('content-preflight-degraded');
  if (item.trusted) labels.push('trusted-provider-result');
  return labels;
}

function compactScoreReasons(item = {}) {
  const reasons = Array.isArray(item.scoreReasons) ? item.scoreReasons : [];
  return reasons
    .map(reason => ({ reason: reason.reason, points: Number(reason.points || 0) }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 12);
}

export function explainSubtitleRanking(results = [], search = {}) {
  return results.map((item, index) => {
    const next = results[index + 1] || null;
    const labels = reasonLabels(item);
    const quality = item.accuracyPreflight?.quality || item.quality || null;
    const releaseMatch = item.releaseMatch || null;
    const hardConflicts = Array.isArray(releaseMatch?.mismatched)
      ? releaseMatch.mismatched.filter(field => ['season', 'episode', 'edition', 'year', 'fps'].includes(field))
      : [];
    return {
      rank: index + 1,
      id: item.id || item.providerId || null,
      provider: item.provider || null,
      release: item.releaseName || item.fileName || item.name || null,
      summary: labels.slice(0, 5).join(' · ') || 'deterministic-score-order',
      evidence: {
        labels,
        score: Number(item.score || 0),
        releaseTier: Number(releaseMatch?.tier || item.releaseMatchTier || 0),
        releasePriority: Number(releaseMatch?.priority || 0),
        criticalMismatches: Number(releaseMatch?.criticalMismatches || 0),
        hardConflicts,
        trusted: Boolean(item.trusted),
        contentPreflight: item.accuracyPreflight || null,
        quality,
      },
      scoreReasons: compactScoreReasons(item),
      aheadOf: next ? {
        id: next.id || next.providerId || null,
        provider: next.provider || null,
        scoreDelta: Number(item.score || 0) - Number(next.score || 0),
        releaseTierDelta: Number(releaseMatch?.tier || 0) - Number(next.releaseMatch?.tier || 0),
      } : null,
      search: index === 0 ? {
        filename: search.filename || null,
        videoHashPresent: Boolean(search.videoHash || search.hash),
        season: search.season || null,
        episode: search.episode || null,
      } : undefined,
    };
  });
}
''')

# --- SLO evaluator --------------------------------------------------------------
write('src/utils/slo.js', r'''import { config } from '../config.js';
import {
  getAccuracyPreflightMetrics,
  getCacheMetrics,
  getProviderMetrics,
  getRuntimeMetrics,
} from './metrics.js';

function check(name, value, threshold, comparison, ready = true) {
  if (!ready) return { name, status: 'warming', value, threshold };
  const ok = comparison(value, threshold);
  return { name, status: ok ? 'ok' : 'violation', value, threshold };
}

export function evaluateSloSnapshot(snapshot, thresholds = config.slo) {
  const runtime = snapshot.runtime || {};
  const providers = snapshot.providers || {};
  const preflight = snapshot.preflight || {};
  const checks = [];
  const httpSamples = Number(runtime.http?.sampleCount || 0);
  checks.push(check(
    'http-p95-ms',
    Number(runtime.http?.p95Ms || 0),
    thresholds.httpP95Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'http-p99-ms',
    Number(runtime.http?.p99Ms || 0),
    thresholds.httpP99Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'http-5xx-rate',
    Number(runtime.http?.error5xxRate || 0),
    thresholds.http5xxRate,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'event-loop-p99-ms',
    Number(runtime.eventLoop?.p99Ms || 0),
    thresholds.eventLoopP99Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));

  for (const [provider, metrics] of Object.entries(providers)) {
    const calls = Number(metrics.success || 0) + Number(metrics.fail || 0);
    const ready = calls >= thresholds.minProviderSamples;
    checks.push(check(
      `provider-${provider}-success-rate`,
      metrics.successRate ?? 1,
      thresholds.providerSuccessRate,
      (value, minimum) => value >= minimum,
      ready,
    ));
    checks.push(check(
      `provider-${provider}-p95-ms`,
      Number(metrics.p95Ms || 0),
      thresholds.providerP95Ms,
      (value, limit) => value <= limit,
      ready,
    ));
  }

  const preflightTotal = Number(preflight.total || 0);
  const unavailableRate = preflightTotal
    ? Number((Number(preflight.unavailable || 0) / preflightTotal).toFixed(4))
    : 0;
  checks.push(check(
    'accuracy-preflight-unavailable-rate',
    unavailableRate,
    thresholds.preflightUnavailableRate,
    (value, limit) => value <= limit,
    preflightTotal >= thresholds.minPreflightSamples,
  ));

  const violations = checks.filter(item => item.status === 'violation');
  const warming = checks.filter(item => item.status === 'warming');
  return {
    status: violations.length ? 'degraded' : warming.length ? 'warming' : 'ok',
    violations,
    checks,
    thresholds,
  };
}

export function getSloStatus() {
  return evaluateSloSnapshot({
    runtime: getRuntimeMetrics(),
    providers: getProviderMetrics(),
    cache: getCacheMetrics(),
    preflight: getAccuracyPreflightMetrics(),
  });
}
''')

# --- Encoding proxy preflight ---------------------------------------------------
replace_once(
    'src/utils/encodingProxy.js',
    "async function defaultProviderLinkResolver(source) {\n",
    r'''function preflightSourceForItem(item = {}) {
  const provider = item.originalProvider || item.provider || 'unknown';
  const providerId = item.providerId || item.fileId || item.id;
  if (provider === 'vault') {
    return {
      kind: 'vault',
      vaultId: validVaultId(providerId),
      provider: 'vault',
      name: item.name || item.releaseName || item.fileName,
      candidate: item,
    };
  }
  if (provider === 'opensubtitles' || provider === 'subsource') {
    const id = tokenText(providerId, 128);
    const valid = provider === 'opensubtitles'
      ? /^[1-9]\d{0,19}$/.test(id)
      : /^[A-Za-z0-9_-]{1,128}$/.test(id);
    if (!valid) throw httpError(400, 'Invalid provider candidate for preflight');
    return {
      kind: 'provider',
      provider,
      providerId: id,
      name: item.name || item.releaseName || item.fileName,
      candidate: item,
    };
  }
  const url = item.download || item.url;
  if (!url || String(url).startsWith('/')) throw httpError(400, 'Candidate has no directly resolvable subtitle source');
  return {
    kind: 'remote',
    url: assertSafeUrl(url),
    provider,
    name: item.name || item.releaseName || item.fileName,
    candidate: item,
  };
}

async function defaultProviderLinkResolver(source) {
'''
)
replace_once(
    'src/utils/encodingProxy.js',
    "async function loadProcessedSource(source, payload, fetcher, providerLinkResolver) {\n",
    r'''export async function preflightSubtitleCandidate(item, context = {}, {
  fetcher = fetchRemoteSubtitleBuffer,
  providerLinkResolver = defaultProviderLinkResolver,
  signal,
} = {}) {
  const source = preflightSourceForItem(item);
  const boundFetcher = (url, options = {}) => fetcher(url, { ...options, signal });
  const buffer = await fetchSourceBuffer(source, boundFetcher, providerLinkResolver);
  const extracted = await extractSubtitlePayload(buffer, {
    maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
    maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
    sourceName: source.name,
  });
  const processed = processSubtitleBuffer(extracted.buffer, {
    stripSdh: config.encodingProxy.stripSdhDefault,
    stripMusicNotes: config.encodingProxy.stripMusicNotes,
    frameRate: context?.fps || context?.extra?.fps,
    sourceName: extracted.entryName || source.name,
  });
  assertValidProcessedSubtitle(processed.text);
  const quality = analyzeProcessedSubtitle(processed.text, context);
  return {
    quality,
    encoding: processed.encoding,
    format: processed.format,
    archive: extracted.archive || null,
    archiveEntry: extracted.entryName || null,
  };
}

async function loadProcessedSource(source, payload, fetcher, providerLinkResolver) {
'''
)

# --- Search service integration -------------------------------------------------
replace_once(
    'src/services/subtitleService.js',
    "import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';\n",
    "import { applyAccuracyPreflight } from './accuracyPreflight.js';\n",
)
replace_once(
    'src/services/subtitleService.js',
    "async function searchCore(search) {\n  return prioritizeAccurateSubtitles(await core.searchSubtitles(search), search);\n}\n",
    "async function searchCore(search) {\n  return applyAccuracyPreflight(await core.searchSubtitles(search), search);\n}\n",
)

# Use verified preflight quality late in deterministic ordering; release/hash evidence remains earlier.
replace_once(
    'src/utils/accuracyFirst.js',
    "function verifiedQualityRank(item) {\n  const validBonus = item?.quality?.valid === true ? 1000 : 0;\n  const score = Number(item?.quality?.score ?? item?.qualityScore ?? 0);\n",
    "function verifiedQualityRank(item) {\n  const quality = item?.accuracyPreflight?.quality || item?.quality || null;\n  const validBonus = quality?.valid === true ? 1000 : 0;\n  const score = Number(quality?.score ?? item?.qualityScore ?? 0);\n",
)

# --- Metrics: preflight + runtime snapshot -------------------------------------
replace_once(
    'src/utils/metrics.js',
    "const refreshLockStats = {\n  localSkipped: 0,\n  redisAcquired: 0,\n  redisSkipped: 0,\n  redisReleased: 0,\n  redisReleaseSkipped: 0,\n  redisErrors: 0,\n  fallbackLocal: 0,\n};\n",
    r'''const refreshLockStats = {
  localSkipped: 0,
  redisAcquired: 0,
  redisSkipped: 0,
  redisReleased: 0,
  redisReleaseSkipped: 0,
  redisErrors: 0,
  fallbackLocal: 0,
};

const accuracyPreflightStats = {
  valid: 0,
  degraded: 0,
  rejected: 0,
  unavailable: 0,
  recentMs: [],
};
'''
)
replace_once(
    'src/utils/metrics.js',
    "  httpStats.recent.push(duration);\n",
    "  httpStats.recent.push({ ms: duration, statusCode: Number(statusCode || 0), route: safeRoute });\n",
)
replace_once(
    'src/utils/metrics.js',
    "export function prometheusMetrics() {\n",
    r'''export function recordAccuracyPreflight(state, ms = 0) {
  const normalized = ['valid', 'degraded', 'rejected', 'unavailable'].includes(state) ? state : 'unavailable';
  accuracyPreflightStats[normalized] += 1;
  accuracyPreflightStats.recentMs.push(Math.max(0, Number(ms) || 0));
  while (accuracyPreflightStats.recentMs.length > config.metrics.windowSize) accuracyPreflightStats.recentMs.shift();
}

export function getAccuracyPreflightMetrics() {
  const total = accuracyPreflightStats.valid
    + accuracyPreflightStats.degraded
    + accuracyPreflightStats.rejected
    + accuracyPreflightStats.unavailable;
  return {
    valid: accuracyPreflightStats.valid,
    degraded: accuracyPreflightStats.degraded,
    rejected: accuracyPreflightStats.rejected,
    unavailable: accuracyPreflightStats.unavailable,
    total,
    p95Ms: percentile(accuracyPreflightStats.recentMs, 0.95),
  };
}

export function getRuntimeMetrics() {
  const recent = httpStats.recent;
  const durations = recent.map(item => item.ms);
  const errors5xx = recent.filter(item => item.statusCode >= 500 && item.statusCode < 600).length;
  const eventLoopMeanMs = Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0;
  const p95 = eventLoopDelay.percentile(95);
  const p99 = eventLoopDelay.percentile(99);
  return {
    http: {
      sampleCount: recent.length,
      p50Ms: percentile(durations, 0.50),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      error5xxRate: recent.length ? Number((errors5xx / recent.length).toFixed(4)) : 0,
    },
    eventLoop: {
      meanMs: Number(eventLoopMeanMs.toFixed(3)),
      p95Ms: Number.isFinite(p95) ? Number((p95 / 1e6).toFixed(3)) : 0,
      p99Ms: Number.isFinite(p99) ? Number((p99 / 1e6).toFixed(3)) : 0,
    },
  };
}

export function prometheusMetrics() {
'''
)
replace_once(
    'src/utils/metrics.js',
    "  lines.push(`m7md_http_request_duration_ms_p50 ${percentile(httpStats.recent, 0.50)}`);\n  lines.push(`m7md_http_request_duration_ms_p95 ${percentile(httpStats.recent, 0.95)}`);\n  lines.push(`m7md_http_request_duration_ms_p99 ${percentile(httpStats.recent, 0.99)}`);\n  const eventLoopMeanMs = Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0;\n  const p95 = eventLoopDelay.percentile(95);\n  const p99 = eventLoopDelay.percentile(99);\n  lines.push(`m7md_event_loop_delay_ms_mean ${eventLoopMeanMs}`);\n  lines.push(`m7md_event_loop_delay_ms_p95 ${Number.isFinite(p95) ? p95 / 1e6 : 0}`);\n  lines.push(`m7md_event_loop_delay_ms_p99 ${Number.isFinite(p99) ? p99 / 1e6 : 0}`);\n",
    r'''  const runtime = getRuntimeMetrics();
  lines.push(`m7md_http_request_duration_ms_p50 ${runtime.http.p50Ms}`);
  lines.push(`m7md_http_request_duration_ms_p95 ${runtime.http.p95Ms}`);
  lines.push(`m7md_http_request_duration_ms_p99 ${runtime.http.p99Ms}`);
  lines.push(`m7md_http_5xx_ratio ${runtime.http.error5xxRate}`);
  lines.push(`m7md_event_loop_delay_ms_mean ${runtime.eventLoop.meanMs}`);
  lines.push(`m7md_event_loop_delay_ms_p95 ${runtime.eventLoop.p95Ms}`);
  lines.push(`m7md_event_loop_delay_ms_p99 ${runtime.eventLoop.p99Ms}`);
  const preflight = getAccuracyPreflightMetrics();
  lines.push(`m7md_accuracy_preflight_total{state="valid"} ${preflight.valid}`);
  lines.push(`m7md_accuracy_preflight_total{state="degraded"} ${preflight.degraded}`);
  lines.push(`m7md_accuracy_preflight_total{state="rejected"} ${preflight.rejected}`);
  lines.push(`m7md_accuracy_preflight_total{state="unavailable"} ${preflight.unavailable}`);
  lines.push(`m7md_accuracy_preflight_duration_ms_p95 ${preflight.p95Ms}`);
'''
)

# --- Configuration --------------------------------------------------------------
replace_once(
    'src/config.js',
    "    metrics: {\n      enabled: toBool(get('ENABLE_PROVIDER_METRICS'), true),\n      windowSize: toInt(get('METRICS_WINDOW_SIZE'), 200, 20, 5000),\n    },\n    referenceSync: {\n",
    r'''    metrics: {
      enabled: toBool(get('ENABLE_PROVIDER_METRICS'), true),
      windowSize: toInt(get('METRICS_WINDOW_SIZE'), 200, 20, 5000),
    },
    accuracyPreflight: {
      enabled: toBool(get('ACCURACY_PREFLIGHT_ENABLED'), true),
      topN: toInt(get('ACCURACY_PREFLIGHT_TOP_N'), 3, 0, 5),
      timeoutMs: toInt(get('ACCURACY_PREFLIGHT_TIMEOUT_MS'), 1800, 300, 8000),
      cacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_CACHE_TTL'), 21600, 300, 604800),
    },
    slo: {
      minHttpSamples: toInt(get('SLO_MIN_HTTP_SAMPLES'), 20, 1, 10000),
      minProviderSamples: toInt(get('SLO_MIN_PROVIDER_SAMPLES'), 5, 1, 10000),
      minPreflightSamples: toInt(get('SLO_MIN_PREFLIGHT_SAMPLES'), 5, 1, 10000),
      httpP95Ms: toInt(get('SLO_HTTP_P95_MS'), 5000, 100, 60000),
      httpP99Ms: toInt(get('SLO_HTTP_P99_MS'), 8000, 100, 60000),
      http5xxRate: toNumber(get('SLO_HTTP_5XX_RATE'), 0.02, 0, 1),
      eventLoopP99Ms: toInt(get('SLO_EVENT_LOOP_P99_MS'), 150, 1, 10000),
      providerP95Ms: toInt(get('SLO_PROVIDER_P95_MS'), 10000, 100, 60000),
      providerSuccessRate: toNumber(get('SLO_PROVIDER_SUCCESS_RATE'), 0.70, 0, 1),
      preflightUnavailableRate: toNumber(get('SLO_PREFLIGHT_UNAVAILABLE_RATE'), 0.50, 0, 1),
    },
    referenceSync: {
'''
)

# --- Server SRE endpoints -------------------------------------------------------
replace_once(
    'src/serverCore.js',
    "import { prometheusMetrics, recordHttpRequest } from './utils/metrics.js';\n",
    "import { getAccuracyPreflightMetrics, getRuntimeMetrics, prometheusMetrics, recordHttpRequest } from './utils/metrics.js';\nimport { getSloStatus } from './utils/slo.js';\n",
)
replace_once(
    'src/serverCore.js',
    "      telemetry: getTelemetryStatus(),\n",
    "      telemetry: getTelemetryStatus(),\n      slo: getSloStatus(),\n",
)
replace_once(
    'src/serverCore.js',
    "app.post('/api/admin/cache/clear', async (req, res, next) => {\n",
    r'''app.get('/api/admin/slo', (req, res, next) => {
  try {
    assertAdminAuth(req);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(getSloStatus());
  } catch (error) {
    return next(error);
  }
});

app.post('/api/admin/cache/clear', async (req, res, next) => {
'''
)
replace_once(
    'src/serverCore.js',
    "      limiters: getProviderLimitersStatus(),\n    });\n",
    "      limiters: getProviderLimitersStatus(),\n      runtime: getRuntimeMetrics(),\n      accuracyPreflight: getAccuracyPreflightMetrics(),\n      slo: getSloStatus(),\n    });\n",
)

# --- Explainability in admin APIs ----------------------------------------------
replace_once(
    'src/api/routes/subtitles.js',
    "import { normalizeStremioSubtitleResponse } from '../../utils/stremioResponseCompat.js';\n",
    "import { normalizeStremioSubtitleResponse } from '../../utils/stremioResponseCompat.js';\nimport { explainSubtitleRanking } from '../../utils/explainRanking.js';\n",
)
replace_once(
    'src/api/routes/subtitles.js',
    "export function toPublicPreview(results, baseUrl, search = {}) {\n  return results.slice(0, config.ui.previewMaxItems).map((item, index) => {\n",
    "export function toPublicPreview(results, baseUrl, search = {}) {\n  const explanations = explainSubtitleRanking(results, search);\n  return results.slice(0, config.ui.previewMaxItems).map((item, index) => {\n",
)
replace_once(
    'src/api/routes/subtitles.js',
    "      quality: item.quality || null,\n      asset: {\n",
    "      quality: item.accuracyPreflight?.quality || item.quality || null,\n      accuracyPreflight: item.accuracyPreflight || null,\n      explanation: explanations[index] || null,\n      asset: {\n",
)
replace_once(
    'src/api/routes/subtitles.js',
    "async function stremioHandler(req, res, next) {\n",
    r'''router.get('/api/explain', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const query = String(req.query.q || '').trim();
    validateQuery(query);
    const extra = mergeExtras({}, req.query);
    const search = {
      query,
      type: req.query.type || 'movie',
      id: req.query.id || query,
      imdbId: req.query.imdbId || req.query.imdb_id || null,
      tmdbId: req.query.tmdbId || req.query.tmdb_id || null,
      season: Number(req.query.season || 0) || null,
      episode: Number(req.query.episode || 0) || null,
      filename: req.query.filename || '',
      videoHash: req.query.videoHash || req.query.hash || null,
      videoSize: req.query.videoSize || req.query.size || null,
      durationMs: req.query.durationMs || req.query.duration || null,
      extra,
    };
    const results = await searchSubtitles(search);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, count: results.length, explanations: explainSubtitleRanking(results, search) });
  } catch (err) {
    return next(err);
  }
});

async function stremioHandler(req, res, next) {
'''
)

# --- Environment defaults ------------------------------------------------------
p = Path('.env.example')
text = p.read_text().rstrip() + r'''

# Enterprise v4 accuracy preflight (shared Redis cache across replicas)
ACCURACY_PREFLIGHT_ENABLED=true
ACCURACY_PREFLIGHT_TOP_N=3
ACCURACY_PREFLIGHT_TIMEOUT_MS=1800
ACCURACY_PREFLIGHT_CACHE_TTL=21600

# Runtime SLO thresholds used by authenticated /api/admin/slo
SLO_MIN_HTTP_SAMPLES=20
SLO_MIN_PROVIDER_SAMPLES=5
SLO_MIN_PREFLIGHT_SAMPLES=5
SLO_HTTP_P95_MS=5000
SLO_HTTP_P99_MS=8000
SLO_HTTP_5XX_RATE=0.02
SLO_EVENT_LOOP_P99_MS=150
SLO_PROVIDER_P95_MS=10000
SLO_PROVIDER_SUCCESS_RATE=0.70
SLO_PREFLIGHT_UNAVAILABLE_RATE=0.50
'''
p.write_text(text + '\n')

# --- Tests ---------------------------------------------------------------------
write('src/tests/accuracyPreflight.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

function candidate(id, extra = {}) {
  return {
    id,
    provider: 'yify',
    download: `https://example.com/${id}.srt`,
    score: 500,
    releaseMatch: { targetFields: 3, criticalMismatches: 0, tier: 4, priority: 100, mismatched: [] },
    ...extra,
  };
}

const noCache = {
  cacheGetImpl: async () => null,
  cacheSetImpl: async () => {},
};

test('accuracy preflight removes a definitely non-Arabic top candidate', async () => {
  const results = [candidate('bad'), candidate('good', { score: 490 })];
  const inspected = await applyAccuracyPreflight(results, { filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async item => ({
      quality: item.id === 'bad'
        ? { valid: false, score: 40, reasons: ['low-arabic-ratio'] }
        : { valid: true, score: 90, reasons: [] },
    }),
  });
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].id, 'good');
  assert.equal(inspected[0].accuracyPreflight.state, 'valid');
});

test('accuracy preflight never removes a candidate merely because coverage is degraded', async () => {
  const exact = candidate('exact', {
    score: 400,
    scoreReasons: [{ reason: 'exact-video-hash-match', points: 900 }],
  });
  const other = candidate('other', { score: 900 });
  const inspected = await applyAccuracyPreflight([exact, other], { videoHash: 'abc', filename: 'Movie.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async item => ({
      quality: item.id === 'exact'
        ? { valid: false, score: 55, reasons: ['coverage-outlier'] }
        : { valid: true, score: 95, reasons: [] },
    }),
  });
  assert.equal(inspected[0].id, 'exact');
  assert.equal(inspected[0].accuracyPreflight.state, 'degraded');
});

test('unavailable preflight preserves deterministic ranking', async () => {
  const first = candidate('first', { score: 600 });
  const second = candidate('second', { score: 500 });
  const inspected = await applyAccuracyPreflight([first, second], {}, {
    ...noCache,
    preflightImpl: async () => { throw new Error('network unavailable'); },
  });
  assert.deepEqual(inspected.map(item => item.id), ['first', 'second']);
  assert.equal(inspected[0].accuracyPreflight.state, 'unavailable');
});
''')

write('src/tests/encodingPreflight.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightSubtitleCandidate } from '../utils/encodingProxy.js';

const ARABIC_SRT = `1\n00:00:01,000 --> 00:00:03,000\nمرحبا بكم في هذا الاختبار\n\n2\n00:00:04,000 --> 00:00:06,000\nهذه ترجمة عربية سليمة\n\n3\n00:00:07,000 --> 00:00:09,000\nنختبر جودة الملف هنا\n\n4\n00:00:10,000 --> 00:00:12,000\nالسطر الرابع للاختبار\n\n5\n00:00:13,000 --> 00:00:15,000\nالسطر الخامس للاختبار\n\n6\n00:00:16,000 --> 00:00:18,000\nالسطر السادس للاختبار\n\n7\n00:00:19,000 --> 00:00:21,000\nالسطر السابع للاختبار\n\n8\n00:00:22,000 --> 00:00:24,000\nالسطر الثامن للاختبار\n`;

test('preflight processes a candidate and returns content quality without serving it', async () => {
  const result = await preflightSubtitleCandidate({
    id: 'remote-1',
    provider: 'yify',
    download: 'https://example.com/subtitle.srt',
  }, {}, {
    fetcher: async () => Buffer.from(ARABIC_SRT, 'utf8'),
  });
  assert.equal(result.quality.valid, true);
  assert.ok(result.quality.arabicRatio > 0.5);
});
''')

write('src/tests/explainRanking.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { explainSubtitleRanking } from '../utils/explainRanking.js';

test('ranking explanation exposes deterministic evidence for the first subtitle', () => {
  const rows = explainSubtitleRanking([{
    id: 'one',
    provider: 'opensubtitles',
    score: 900,
    scoreReasons: [{ reason: 'exact-video-hash-match', points: 900 }],
    releaseMatch: { tier: 5, priority: 120, criticalMismatches: 0, mismatched: [] },
    accuracyPreflight: { state: 'valid', quality: { valid: true, score: 95, reasons: [] } },
    trusted: true,
  }, {
    id: 'two',
    provider: 'yify',
    score: 700,
    releaseMatch: { tier: 4, priority: 90, criticalMismatches: 0, mismatched: [] },
  }], { filename: 'Movie.2026.BluRay.mkv', videoHash: 'abc' });

  assert.equal(rows[0].rank, 1);
  assert.ok(rows[0].evidence.labels.includes('exact-video-hash'));
  assert.ok(rows[0].evidence.labels.includes('content-preflight-valid'));
  assert.equal(rows[0].aheadOf.id, 'two');
  assert.equal(rows[0].search.videoHashPresent, true);
});
''')

write('src/tests/slo.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSloSnapshot } from '../utils/slo.js';

const thresholds = {
  minHttpSamples: 5,
  minProviderSamples: 3,
  minPreflightSamples: 3,
  httpP95Ms: 1000,
  httpP99Ms: 2000,
  http5xxRate: 0.02,
  eventLoopP99Ms: 100,
  providerP95Ms: 1500,
  providerSuccessRate: 0.7,
  preflightUnavailableRate: 0.5,
};

test('SLO evaluator reports warming before enough samples exist', () => {
  const result = evaluateSloSnapshot({
    runtime: { http: { sampleCount: 1 }, eventLoop: {} },
    providers: {},
    preflight: { total: 0 },
  }, thresholds);
  assert.equal(result.status, 'warming');
});

test('SLO evaluator reports degraded on latency or error budget violations', () => {
  const result = evaluateSloSnapshot({
    runtime: {
      http: { sampleCount: 20, p95Ms: 2500, p99Ms: 3000, error5xxRate: 0.1 },
      eventLoop: { p99Ms: 20 },
    },
    providers: {
      yify: { success: 8, fail: 2, successRate: 0.8, p95Ms: 900 },
    },
    preflight: { total: 10, unavailable: 1 },
  }, thresholds);
  assert.equal(result.status, 'degraded');
  assert.ok(result.violations.some(item => item.name === 'http-p95-ms'));
  assert.ok(result.violations.some(item => item.name === 'http-5xx-rate'));
});

test('SLO evaluator reports ok for healthy mature samples', () => {
  const result = evaluateSloSnapshot({
    runtime: {
      http: { sampleCount: 20, p95Ms: 500, p99Ms: 900, error5xxRate: 0 },
      eventLoop: { p99Ms: 20 },
    },
    providers: {
      yify: { success: 9, fail: 1, successRate: 0.9, p95Ms: 700 },
    },
    preflight: { total: 10, unavailable: 1 },
  }, thresholds);
  assert.equal(result.status, 'ok');
});
''')

# --- Deployable observability configs ------------------------------------------
write('ops/prometheus/alerts.yml', r'''groups:
  - name: m7md-enterprise-slo
    rules:
      - alert: M7mdHttpP95High
        expr: m7md_http_request_duration_ms_p95 > 5000
        for: 5m
        labels: { severity: warning }
        annotations: { summary: "HTTP p95 exceeds 5s" }
      - alert: M7mdHttpErrorBudgetBurn
        expr: m7md_http_5xx_ratio > 0.02
        for: 5m
        labels: { severity: critical }
        annotations: { summary: "HTTP 5xx ratio exceeds 2%" }
      - alert: M7mdEventLoopDelayHigh
        expr: m7md_event_loop_delay_ms_p99 > 150
        for: 5m
        labels: { severity: warning }
        annotations: { summary: "Node.js event-loop p99 exceeds 150ms" }
      - alert: M7mdProviderFailureRateHigh
        expr: rate(m7md_provider_fail_total[5m]) / clamp_min(rate(m7md_provider_success_total[5m]) + rate(m7md_provider_fail_total[5m]), 0.001) > 0.30
        for: 10m
        labels: { severity: warning }
        annotations: { summary: "Provider failure rate exceeds 30%" }
      - alert: M7mdAccuracyPreflightUnavailable
        expr: rate(m7md_accuracy_preflight_total{state="unavailable"}[10m]) / clamp_min(sum(rate(m7md_accuracy_preflight_total[10m])), 0.001) > 0.50
        for: 10m
        labels: { severity: warning }
        annotations: { summary: "Accuracy preflight unavailable for more than half of inspected candidates" }
''')

dashboard = {
  "title": "m7md Arabic Resolver Enterprise",
  "uid": "m7md-enterprise",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {"from": "now-6h", "to": "now"},
  "panels": [
    {"id": 1, "title": "HTTP p95", "type": "timeseries", "targets": [{"expr": "m7md_http_request_duration_ms_p95", "legendFormat": "p95 ms"}]},
    {"id": 2, "title": "HTTP p99", "type": "timeseries", "targets": [{"expr": "m7md_http_request_duration_ms_p99", "legendFormat": "p99 ms"}]},
    {"id": 3, "title": "HTTP 5xx ratio", "type": "timeseries", "targets": [{"expr": "m7md_http_5xx_ratio", "legendFormat": "5xx ratio"}]},
    {"id": 4, "title": "Event loop p99", "type": "timeseries", "targets": [{"expr": "m7md_event_loop_delay_ms_p99", "legendFormat": "event loop p99"}]},
    {"id": 5, "title": "Cache hit ratio", "type": "timeseries", "targets": [{"expr": "m7md_cache_hit_ratio", "legendFormat": "cache hit ratio"}]},
    {"id": 6, "title": "Provider failures", "type": "timeseries", "targets": [{"expr": "rate(m7md_provider_fail_total[5m])", "legendFormat": "{{provider}}"}]},
    {"id": 7, "title": "Accuracy preflight", "type": "timeseries", "targets": [{"expr": "rate(m7md_accuracy_preflight_total[5m])", "legendFormat": "{{state}}"}]},
    {"id": 8, "title": "Accuracy preflight p95", "type": "timeseries", "targets": [{"expr": "m7md_accuracy_preflight_duration_ms_p95", "legendFormat": "p95 ms"}]}
  ]
}
write('ops/grafana/m7md-enterprise-dashboard.json', json.dumps(dashboard, ensure_ascii=False, indent=2) + '\n')

write('src/tests/observabilityConfig.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Grafana dashboard and Prometheus alert rules are deployable configuration', async () => {
  const dashboardText = await readFile(new URL('../../ops/grafana/m7md-enterprise-dashboard.json', import.meta.url), 'utf8');
  const alerts = await readFile(new URL('../../ops/prometheus/alerts.yml', import.meta.url), 'utf8');
  const dashboard = JSON.parse(dashboardText);
  assert.equal(dashboard.uid, 'm7md-enterprise');
  assert.ok(dashboard.panels.length >= 6);
  assert.match(alerts, /M7mdHttpErrorBudgetBurn/);
  assert.match(alerts, /M7mdAccuracyPreflightUnavailable/);
});
''')

# --- Release metadata -----------------------------------------------------------
replace_once('src/release.js', "RELEASE_VERSION = '3.9.0'", "RELEASE_VERSION = '4.0.0'")

p = Path('README.md')
text = p.read_text()
if '# m7md Arabic Resolver v3.9.0' not in text:
    raise SystemExit('README v3.9 heading missing')
text = text.replace('# m7md Arabic Resolver v3.9.0', '# m7md Arabic Resolver v4.0.0', 1)
marker = '## ما الجديد في 3.9.0\n'
section = '''## ما الجديد في 4.0.0\n\n- Accuracy Preflight يفحص محتوى أفضل 3 مرشحين فعليًا قبل العرض، مع مهلة قصيرة وكاش Redis مشترك.\n- الإقصاء الصلب مقتصر على فشل محتوى مؤكد مثل ملف غير عربي أو بلا cues صالحة؛ Hash/Release evidence لا يُهزم بمجرد درجة جودة أقل.\n- Explainability منظّم يوضح لماذا جاءت كل ترجمة في ترتيبها عبر `/api/explain` وواجهة preview.\n- SLO runtime evaluator عبر `/api/admin/slo` مع HTTP p95/p99، 5xx ratio، Event Loop، provider health، وpreflight availability.\n- Prometheus alert rules وGrafana dashboard جاهزان تحت `ops/`، مع metrics جديدة للـAccuracy Preflight.\n- يستمر التشغيل على PostgreSQL + Redis و2 Railway replicas مع نفس Addon ID.\n\n'''
if marker not in text:
    raise SystemExit('README v3.9 marker missing')
p.write_text(text.replace(marker, section + marker, 1))

p = Path('CHANGELOG.md')
text = p.read_text()
marker = '# Changelog\n\n'
if not text.startswith(marker):
    raise SystemExit('CHANGELOG header mismatch')
section = '''## 4.0.0 - Enterprise Accuracy & SRE\n\n- Add bounded, Redis-cached content preflight for top-ranked subtitle candidates.\n- Reject only definitive content failures before Stremio ordering; preserve deterministic hash/release precedence for soft quality issues.\n- Add structured ranking explainability to admin preview and `/api/explain`.\n- Add runtime SLO evaluation plus preflight/runtime Prometheus metrics.\n- Add deployable Prometheus alert rules and Grafana dashboard definitions.\n- Preserve shared PostgreSQL/Redis state and horizontal Railway scaling.\n\n'''
p.write_text(marker + section + text[len(marker):])
