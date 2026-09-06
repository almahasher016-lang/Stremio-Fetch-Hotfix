from pathlib import Path

# Wire adaptive provider control into the existing deterministic retry/circuit-breaker pipeline.
p = Path('src/services/subtitleServiceCore.js')
text = p.read_text()
old = "import { withRetry } from '../utils/retry.js';"
new = "import { parseRetryAfter, withRetry } from '../utils/retry.js';"
if text.count(old) != 1:
    raise SystemExit('retry import anchor mismatch')
text = text.replace(old, new, 1)
old = """    maxConcurrent: config.providers.maxConcurrentPerProvider,
    minIntervalMs: config.providers.minIntervalMsPerProvider,
"""
new = """    maxConcurrent: config.providers.maxConcurrentPerProvider,
    minIntervalMs: config.providers.minIntervalMsPerProvider,
    latencyThresholdMs: Math.max(750, Math.floor(config.providers.timeoutMs * 0.6)),
"""
if text.count(old) != 1:
    raise SystemExit('limiter constructor anchor mismatch')
text = text.replace(old, new, 1)
old = """        variant.signal?.throwIfAborted();
        breaker?.recordSuccess();
        recordProviderCall(providerName, { ok: true, count: results.length, ms: Date.now() - started });
"""
new = """        variant.signal?.throwIfAborted();
        const elapsedMs = Date.now() - started;
        limiter?.recordOutcome({ ok: true, ms: elapsedMs });
        breaker?.recordSuccess();
        recordProviderCall(providerName, { ok: true, count: results.length, ms: elapsedMs });
"""
if text.count(old) != 1:
    raise SystemExit('provider success anchor mismatch')
text = text.replace(old, new, 1)
old = """        breaker?.recordFailure();
        recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: error.message });
"""
new = """        const elapsedMs = Date.now() - started;
        limiter?.recordOutcome({
          ok: false,
          ms: elapsedMs,
          statusCode: error?.statusCode || error?.status || 0,
          retryAfterMs: parseRetryAfter(error?.retryAfter) || 0,
        });
        breaker?.recordFailure();
        recordProviderCall(providerName, { ok: false, count: 0, ms: elapsedMs, error: error.message });
"""
if text.count(old) != 1:
    raise SystemExit('provider failure anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)

# Preserve Retry-After for HTML/text providers such as YIFY, not only JSON APIs.
p = Path('src/utils/http.js')
text = p.read_text()
old = """      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }
    return text;
"""
new = """      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      err.retryAfter = response.headers['retry-after'] || null;
      throw err;
    }
    return text;
"""
if text.count(old) != 1:
    raise SystemExit('fetchText error anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)

# Update existing limiter assertion and add deterministic adaptive-behaviour regressions.
p = Path('src/tests/providerLimiter.test.js')
text = p.read_text()
old = """    maxConcurrent: 1,
    minIntervalMs: 50,
  });
});
"""
new = """    maxConcurrent: 1,
    minIntervalMs: 50,
    effectiveMaxConcurrent: 1,
    effectiveMinIntervalMs: 50,
    adaptivePenalty: 0,
    blockedUntil: null,
  });
});

test('provider limiter backs off deterministically after overload and recovers on success', () => {
  let clock = 1_000;
  const limiter = new ProviderLimiter('provider', {
    maxConcurrent: 3,
    minIntervalMs: 100,
    now: () => clock,
  });
  limiter.recordOutcome({ ok: false, ms: 500, statusCode: 429, retryAfterMs: 2_000 });
  let status = limiter.status();
  assert.equal(status.adaptivePenalty, 2);
  assert.equal(status.effectiveMaxConcurrent, 1);
  assert.ok(status.effectiveMinIntervalMs > 100);
  assert.equal(status.blockedUntil, 3_000);

  clock = 3_100;
  limiter.recordOutcome({ ok: true, ms: 100 });
  limiter.recordOutcome({ ok: true, ms: 100 });
  status = limiter.status();
  assert.equal(status.adaptivePenalty, 0);
  assert.equal(status.effectiveMaxConcurrent, 3);
  assert.equal(status.effectiveMinIntervalMs, 100);
});

test('provider limiter reduces concurrency after sustained high latency without a failure', () => {
  const limiter = new ProviderLimiter('provider', {
    maxConcurrent: 4,
    minIntervalMs: 0,
    latencyThresholdMs: 500,
  });
  limiter.recordOutcome({ ok: true, ms: 900 });
  limiter.recordOutcome({ ok: true, ms: 900 });
  const status = limiter.status();
  assert.equal(status.adaptivePenalty, 2);
  assert.equal(status.effectiveMaxConcurrent, 1);
});
"""
if text.count(old) != 1:
    raise SystemExit('provider limiter test anchor mismatch')
text = text.replace(old, new, 1)
p.write_text(text)

# Add a real YIFY Last-Known-Good fallback regression without touching Redis in the test.
p = Path('src/tests/yify.test.js')
text = p.read_text()
append = r'''

test('YIFY stores parsed last-known-good rows and reuses them during a later outage', async () => {
  const html = `<table><tbody>
    <tr data-id="392064">
      <td><span class="sub-lang">Arabic</span></td>
      <td><a href="/subtitles/inception-2010-arabic-yify-392064">Inception.2010.1080p.BrRip.x264.YIFY</a></td>
    </tr>
  </tbody></table>`;
  let cachedRows = null;
  let cachedTtl = null;
  const live = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => html,
      cacheSetImpl: async (_key, value, ttl) => {
        cachedRows = value;
        cachedTtl = ttl;
      },
      cacheGetEntryImpl: async () => null,
    },
  );
  assert.equal(live.length, 1);
  assert.equal(cachedRows.length, 1);
  assert.equal(cachedTtl, 3600);

  const fallback = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => { throw new Error('upstream unavailable'); },
      cacheGetEntryImpl: async () => ({ value: cachedRows, stale: true, source: 'redis' }),
      cacheSetImpl: async () => {},
    },
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].lastKnownGood, true);
  assert.equal(fallback[0].sourceType, 'fallback-cache');
  assert.equal(fallback[0].searchReason, 'yify-last-known-good');
});

test('YIFY can fall back to last-known-good rows when an anti-bot challenge appears', async () => {
  const cached = [{
    provider: 'yify',
    id: 'yify-tt1375666-1',
    providerId: '1',
    name: 'Inception.2010.BluRay',
    releaseName: 'Inception.2010.BluRay',
    lang: 'ara',
    imdbId: 'tt1375666',
    download: `${config.yify.baseUrl}/subtitle/inception.zip`,
  }];
  const rows = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => '<html><title>Just a moment...</title><form id="challenge-form"></form></html>',
      cacheGetEntryImpl: async () => ({ value: cached, stale: true }),
      cacheSetImpl: async () => {},
    },
  );
  assert.equal(rows[0].lastKnownGood, true);
});
'''
if "stores parsed last-known-good rows" in text:
    raise SystemExit('YIFY LKG tests already present')
p.write_text(text.rstrip() + append + '\n')

# Documentation/release metadata; package + lockfile are handled by npm version in the workflow.
p = Path('src/release.js')
text = p.read_text()
if "RELEASE_VERSION = '3.8.0'" not in text:
    raise SystemExit('unexpected release version')
p.write_text(text.replace("RELEASE_VERSION = '3.8.0'", "RELEASE_VERSION = '3.9.0'", 1))

p = Path('README.md')
text = p.read_text()
text = text.replace('# m7md Arabic Resolver v3.8.0', '# m7md Arabic Resolver v3.9.0', 1)
marker = '## ما الجديد في 3.8.0\n'
section = '''## ما الجديد في 3.9.0\n\n- YIFY Last-Known-Good parsed results are retained in Redis and used during anti-bot/layout/upstream outages.\n- Text/HTML provider requests now propagate `Retry-After` just like JSON providers.\n- Provider concurrency and start intervals adapt deterministically to 429/5xx/high-latency pressure, then recover after healthy calls.\n- Existing Circuit Breaker and retry pipeline remains authoritative; no duplicate resilience stack was added.\n\n'''
if marker not in text:
    raise SystemExit('README v3.8 marker missing')
p.write_text(text.replace(marker, section + marker, 1))

p = Path('CHANGELOG.md')
text = p.read_text()
marker = '# Changelog\n\n'
section = '''## 3.9.0 - Provider Resilience 2.0\n\n- Add Redis-backed YIFY Last-Known-Good parsed-result fallback for live scrape failures and anti-bot challenges.\n- Propagate `Retry-After` from text/HTML upstream responses.\n- Add deterministic adaptive provider limiting driven by overload and latency outcomes.\n- Add regression coverage for YIFY fallback and adaptive limiter recovery.\n\n'''
if not text.startswith(marker):
    raise SystemExit('CHANGELOG header mismatch')
p.write_text(marker + section + text[len(marker):])
