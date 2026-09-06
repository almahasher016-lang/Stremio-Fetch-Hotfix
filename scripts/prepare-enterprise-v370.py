from pathlib import Path


def patch(path, old, new, expected=1):
    p = Path(path)
    text = p.read_text()
    found = text.count(old)
    if found != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {found}")
    p.write_text(text.replace(old, new))


# 1) Stable version-bound signed asset tokens and version-separated processing cache.
encoding = Path("src/utils/encodingProxy.js")
text = encoding.read_text()
marker = "export function verifyEncodingToken(token) {"
if text.count(marker) != 1:
    raise SystemExit("encodingProxy verify marker mismatch")
stable = r'''
export function createStableEncodingToken(payload) {
  const primarySource = compactTokenSource(payload.source || payload);
  const safePayload = {
    assetVersion: config.app.version,
    source: primarySource,
    options: {
      stripSdh: config.encodingProxy.stripSdhDefault,
      stripMusicNotes: config.encodingProxy.stripMusicNotes,
      ...(payload.options || {}),
    },
    syncPlan: payload.syncPlan || null,
    reference: payload.reference ? compactTokenSource(payload.reference) : null,
    candidate: primarySource.candidate,
    fallbacks: Array.isArray(payload.fallbacks)
      ? payload.fallbacks.slice(0, config.encodingProxy.maxFallbacks).map(compactTokenFallback)
      : [],
    context: payload.context ? {
      type: tokenText(payload.context.type || 'movie', 16),
      id: tokenText(payload.context.id, 128),
      videoId: tokenText(payload.context.videoId, 128),
      videoHash: tokenText(payload.context.videoHash, 128),
      videoSize: payload.context.videoSize || null,
      filename: tokenText(payload.context.filename, 320),
      title: tokenText(payload.context.title),
      imdbId: tokenText(payload.context.imdbId, 32),
      tmdbId: tokenText(payload.context.tmdbId, 32),
      season: payload.context.season || null,
      episode: payload.context.episode || null,
      durationMs: payload.context.durationMs || null,
      fps: payload.context.fps || null,
    } : null,
  };

  function encode() {
    const raw = Buffer.from(JSON.stringify(safePayload));
    const compressed = deflateRawSync(raw, { level: 9 });
    const encoded = b64url(compressed);
    const signed = `z1.${encoded}`;
    return { token: `${signed}.${sign(signed)}`, rawBytes: raw.byteLength };
  }

  let encodedToken = encode();
  while (
    (encodedToken.token.length > TARGET_TOKEN_LENGTH || encodedToken.rawBytes > MAX_TOKEN_PAYLOAD_BYTES)
    && safePayload.fallbacks.length
  ) {
    safePayload.fallbacks.pop();
    encodedToken = encode();
  }
  if (encodedToken.rawBytes > MAX_TOKEN_PAYLOAD_BYTES || encodedToken.token.length > MAX_TOKEN_LENGTH) {
    throw httpError(413, 'Subtitle asset token payload is too large');
  }
  return encodedToken.token;
}

'''
text = text.replace(marker, stable + marker)
old = "  const token = createEncodingToken({\n    source: tokenSourceForItem(baseUrl, item),"
if text.count(old) != 1:
    raise SystemExit("proxied token creation marker mismatch")
text = text.replace(old, "  const token = createStableEncodingToken({\n    source: tokenSourceForItem(baseUrl, item),")
old = "  return `${baseUrl}/proxy/encoding/${token}.srt`;"
if text.count(old) != 1:
    raise SystemExit("proxy URL marker mismatch")
text = text.replace(old, "  return `${baseUrl}/assets/encoding/${token}.srt`;")
old = "  const normalized = JSON.stringify({\n    source: payload.source,"
if text.count(old) != 1:
    raise SystemExit("encoding cache marker mismatch")
text = text.replace(old, "  const normalized = JSON.stringify({\n    assetVersion: payload.assetVersion || null,\n    source: payload.source,")
text = text.replace("return `encoding:v12:${sign(normalized)}`;", "return `encoding:v13:${sign(normalized)}`;")
encoding.write_text(text)


# 2) Preview compatibility and a CDN-aware immutable asset handler.
patch(
    "src/api/routes/subtitles.js",
    "    const previewUrl = url?.includes('/proxy/encoding/') && url.endsWith('.srt')\n      ? url.replace('/proxy/encoding/', '/preview/encoding/').replace(/\\.srt$/, '.json')\n      : null;",
    "    const previewUrl = url?.includes('/assets/encoding/') && url.endsWith('.srt')\n      ? url.replace('/assets/encoding/', '/preview/encoding/').replace(/\\.srt$/, '.json')\n      : url?.includes('/proxy/encoding/') && url.endsWith('.srt')\n        ? url.replace('/proxy/encoding/', '/preview/encoding/').replace(/\\.srt$/, '.json')\n        : null;",
)

asset_handler = r'''
export async function encodingAssetHandler(req, res, next) {
  try {
    const result = await resolveProxiedSubtitle(req.params.token);
    res.setHeader('X-Source-Encoding', result.encoding || 'utf-8');
    res.setHeader('X-Source-Format', result.format || 'srt');
    if (result.archive) res.setHeader('X-Source-Archive', result.archive);
    if (result.sync) res.setHeader('X-Sync-Confidence', String(result.sync.confidence));
    if (result.fallbackIndex > 0) res.setHeader('X-Subtitle-Fallback', String(result.fallbackIndex));

    const primaryResolved = Number(result.fallbackIndex || 0) == 0;
    const cacheControl = primaryResolved
      ? 'public, max-age=31536000, s-maxage=31536000, immutable'
      : 'public, max-age=300, s-maxage=300, stale-while-revalidate=60';
    res.setHeader('CDN-Cache-Control', cacheControl);
    res.setHeader('Cloudflare-CDN-Cache-Control', cacheControl);
    res.setHeader('Surrogate-Control', primaryResolved
      ? 'max-age=31536000, stale-while-revalidate=86400'
      : 'max-age=300, stale-while-revalidate=60');
    res.setHeader('Vary', 'Accept-Encoding');
    return sendSrtResponse(res, result.text, { cacheControl });
  } catch (err) {
    return next(err);
  }
}

'''
p = Path("src/api/routes/subtitles.js")
text = p.read_text()
marker = "router.get('/proxy/encoding/:token.srt', async (req, res, next) => {"
if text.count(marker) != 1:
    raise SystemExit("subtitle asset route marker mismatch")
p.write_text(text.replace(marker, asset_handler + marker))


# 3) Fast path after compression, before Helmet/logging/rate-limit middleware.
patch(
    "src/serverCore.js",
    "import subtitlesRoute from './api/routes/subtitles.js';",
    "import subtitlesRoute, { encodingAssetHandler } from './api/routes/subtitles.js';",
)
patch(
    "src/serverCore.js",
    "import { prometheusMetrics } from './utils/metrics.js';",
    "import { prometheusMetrics, recordHttpRequest } from './utils/metrics.js';",
)
patch(
    "src/serverCore.js",
    r"    || /^\/(?:subtitles?|proxy\/(?:encoding|styled))\//.test(pathname);",
    r"    || /^\/(?:subtitles?|proxy\/(?:encoding|styled)|assets\/encoding)\//.test(pathname);",
)
patch(
    "src/serverCore.js",
    "app.use(requestId);\napp.use(compression({",
    """app.use(requestId);

function metricRoute(pathname) {
  if (pathname.startsWith('/assets/encoding/')) return 'subtitle_asset';
  if (pathname.startsWith('/proxy/')) return 'subtitle_proxy';
  if (pathname.startsWith('/subtitles/') || pathname.startsWith('/subtitle/')) return 'subtitle_search';
  if (pathname === '/manifest.json' || pathname === '/manifest') return 'manifest';
  if (pathname === '/health') return 'health';
  if (pathname.startsWith('/api/')) return 'api';
  return 'other';
}

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    recordHttpRequest(metricRoute(req.path), res.statusCode, elapsedMs);
  });
  next();
});

app.use(compression({""",
)
patch(
    "src/serverCore.js",
    "}));\napp.use(helmet({",
    "}));\n\n// Stable subtitle assets bypass logging and rate-limit middleware on successful delivery.\napp.get('/assets/encoding/:token.srt', encodingAssetHandler);\n\napp.use(helmet({",
)


# 4) Runtime observability: route-class HTTP latency and event-loop lag.
p = Path("src/utils/metrics.js")
text = p.read_text()
if not text.startswith("import { monitorEventLoopDelay } from 'node:perf_hooks';"):
    text = "import { monitorEventLoopDelay } from 'node:perf_hooks';\n" + text
marker = "const DURATION_BUCKETS = [100, 250, 500, 1000, 2500, 5000, 10000, 20000];\n"
if text.count(marker) != 1:
    raise SystemExit("metrics bucket marker mismatch")
text = text.replace(marker, marker + """const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
const httpStats = {
  recent: [],
  byRouteStatus: new Map(),
};

""")
marker = "function percentile(values, ratio) {"
if text.count(marker) != 1:
    raise SystemExit("metrics percentile marker mismatch")
http_fn = """export function recordHttpRequest(route, statusCode, ms) {
  if (!config.metrics.enabled) return;
  const safeRoute = String(route || 'other').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'other';
  const statusClass = `${Math.floor(Number(statusCode || 0) / 100) || 0}xx`;
  const duration = Math.max(0, Number(ms) || 0);
  const key = `${safeRoute}|${statusClass}`;
  httpStats.byRouteStatus.set(key, (httpStats.byRouteStatus.get(key) || 0) + 1);
  httpStats.recent.push(duration);
  while (httpStats.recent.length > Math.max(100, config.metrics.windowSize * 4)) httpStats.recent.shift();
}

"""
text = text.replace(marker, http_fn + marker)
marker = "  return `${lines.join('\\n')}\\n`;\n}"
if text.count(marker) != 1:
    raise SystemExit("metrics prometheus return marker mismatch")
observability = """  for (const [key, count] of httpStats.byRouteStatus) {
    const [route, status] = key.split('|');
    lines.push(`m7md_http_requests_total{route=\"${route}\",status=\"${status}\"} ${count}`);
  }
  lines.push(`m7md_http_request_duration_ms_p50 ${percentile(httpStats.recent, 0.50)}`);
  lines.push(`m7md_http_request_duration_ms_p95 ${percentile(httpStats.recent, 0.95)}`);
  lines.push(`m7md_http_request_duration_ms_p99 ${percentile(httpStats.recent, 0.99)}`);
  const eventLoopMeanMs = Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0;
  const p95 = eventLoopDelay.percentile(95);
  const p99 = eventLoopDelay.percentile(99);
  lines.push(`m7md_event_loop_delay_ms_mean ${eventLoopMeanMs}`);
  lines.push(`m7md_event_loop_delay_ms_p95 ${Number.isFinite(p95) ? p95 / 1e6 : 0}`);
  lines.push(`m7md_event_loop_delay_ms_p99 ${Number.isFinite(p99) ? p99 / 1e6 : 0}`);
"""
text = text.replace(marker, observability + marker)
p.write_text(text)


# 5) Regression coverage for stable asset URLs and runtime metrics.
p = Path("src/tests/encodingProxy.test.js")
text = p.read_text()
text = text.replace(r"^\/proxy\/encoding\/(.+)\.srt$", r"^\/assets\/encoding\/(.+)\.srt$")
stable_test = r'''
test('Stremio emits a stable version-bound asset URL for the same subtitle recipe', () => {
  const results = [{
    id: 'stable-one',
    provider: 'subdl',
    providerId: 'stable-one',
    lang: 'ara',
    download: 'https://example.com/stable-one.srt',
  }];
  const search = { type: 'movie', id: 'tt1375666', filename: 'Movie.1080p.BluRay.x264' };
  const first = toStremioSubtitles(results, 'https://addon.example', search)[0].url;
  const second = toStremioSubtitles(results, 'https://addon.example', search)[0].url;
  assert.equal(first, second);
  const match = new URL(first).pathname.match(/^\/assets\/encoding\/(.+)\.srt$/);
  assert.ok(match);
  const payload = verifyEncodingToken(match[1]);
  assert.equal(payload.assetVersion, config.app.version);
  assert.equal(payload.expiresAt, undefined);
});

'''
marker = "function timedSrt(text, cueCount = 8) {"
if text.count(marker) != 1:
    raise SystemExit("encoding proxy test marker mismatch")
text = text.replace(marker, stable_test + marker)
p.write_text(text)

patch(
    "src/tests/metrics.test.js",
    "import { getProviderMetrics, prometheusMetrics, recordProviderCall } from '../utils/metrics.js';",
    "import { getProviderMetrics, prometheusMetrics, recordHttpRequest, recordProviderCall } from '../utils/metrics.js';",
)
p = Path("src/tests/metrics.test.js")
p.write_text(p.read_text() + """

test('runtime metrics expose low-cardinality HTTP latency and event-loop gauges', () => {
  recordHttpRequest('subtitle_asset', 200, 12);
  recordHttpRequest('subtitle_asset', 200, 24);
  const prometheus = prometheusMetrics();
  assert.match(prometheus, /m7md_http_requests_total\\{route=\"subtitle_asset\",status=\"2xx\"} 2/);
  assert.match(prometheus, /m7md_http_request_duration_ms_p95 24/);
  assert.match(prometheus, /m7md_event_loop_delay_ms_p95 /);
});
""")


# 6) Release/documentation consistency. package.json + lock are bumped by npm version in the workflow.
patch(
    "src/release.js",
    "RELEASE_VERSION = '3.6.4'",
    "RELEASE_VERSION = '3.7.0'",
)
readme = Path("README.md")
text = readme.read_text().replace("# m7md Arabic Resolver v3.6.4", "# m7md Arabic Resolver v3.7.0", 1)
if "## ما الجديد في 3.7.0" not in text:
    marker = "## ما الجديد في 3.6.4"
    section = """## ما الجديد في 3.7.0

- Enterprise Edge foundation: stable version-bound subtitle asset URLs for effective CDN caching.
- Dedicated fast path for subtitle assets before logging and rate-limit middleware.
- CDN/Cloudflare cache headers with long immutable caching for successfully resolved primary assets and short TTL for fallback assets.
- Shared Railway Redis enabled for cross-instance cache and distributed refresh locks.
- Prometheus HTTP latency and event-loop delay metrics for baseline/p95/p99 observability.

"""
    if marker not in text:
        raise SystemExit("README release marker missing")
    text = text.replace(marker, section + marker, 1)
readme.write_text(text)

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
if "## 3.7.0 - Enterprise Edge Foundation" not in text:
    section = """# Changelog

## 3.7.0 - Enterprise Edge Foundation

- Emit deterministic signed `/assets/encoding/` URLs bound to the application version so identical subtitle recipes reuse a CDN cache key.
- Add an asset delivery fast path with immutable edge-cache headers for primary resolutions and conservative caching when a fallback source wins.
- Add HTTP p50/p95/p99 and event-loop delay Prometheus metrics.
- Enable shared Railway Redis as the distributed cache and refresh-lock layer.
- Preserve legacy `/proxy/encoding/` resolution for already-issued URLs.

"""
    if not text.startswith("# Changelog\n\n"):
        raise SystemExit("CHANGELOG header mismatch")
    text = text.replace("# Changelog\n\n", section, 1)
changelog.write_text(text)

env = Path(".env.example")
text = env.read_text()
if "REDIS_URL=" not in text:
    env.write_text(text.rstrip() + "\nREDIS_URL=\n")
