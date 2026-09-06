from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def replace(path, old, new, count=1):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, count), encoding='utf-8')

# Version metadata.
replace('src/release.js', "export const RELEASE_VERSION = '4.2.0';", "export const RELEASE_VERSION = '4.3.0';")
for name in ('package.json', 'package-lock.json'):
    p = ROOT / name
    data = json.loads(p.read_text(encoding='utf-8'))
    data['version'] = '4.3.0'
    if name == 'package-lock.json' and '' in data.get('packages', {}):
        data['packages']['']['version'] = '4.3.0'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Config: short-lived hard rejection + durable final Arabic Last-Known-Good.
replace(
    'src/configCore.js',
    """      cacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_CACHE_TTL'), 21600, 300, 604800),\n""",
    """      cacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_CACHE_TTL'), 21600, 300, 604800),\n      rejectCacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_REJECT_CACHE_TTL'), 180, 30, 3600),\n""",
)
replace(
    'src/configCore.js',
    """      staleWhileRevalidate: toBool(get('CACHE_STALE_WHILE_REVALIDATE'), false),\n""",
    """      staleWhileRevalidate: toBool(get('CACHE_STALE_WHILE_REVALIDATE'), false),\n      availabilityTtlSeconds: toInt(get('ARABIC_LKG_TTL'), 900, 60, 86400),\n      availabilityStaleSeconds: toInt(get('ARABIC_LKG_STALE_SECONDS'), 604800, 600, 2592000),\n""",
)
replace(
    '.env.example',
    """ACCURACY_PREFLIGHT_CACHE_TTL=21600\n""",
    """ACCURACY_PREFLIGHT_CACHE_TTL=21600\nACCURACY_PREFLIGHT_REJECT_CACHE_TTL=180\nARABIC_LKG_TTL=900\nARABIC_LKG_STALE_SECONDS=604800\n""",
)

# Accuracy preflight: version its decision cache, shorten hard-reject caching, and fail open
# only when hard rejection would otherwise erase the entire Arabic list.
accuracy = ROOT / 'src/services/accuracyPreflight.js'
text = accuracy.read_text(encoding='utf-8')
text = text.replace(
    """    fps: search.fps || search.extra?.fps || null,\n""",
    """    fps: search.fps || search.extra?.fps || null,\n    policyVersion: config.app.version,\n""",
    1,
)
old = """  if (outcome.state !== 'unavailable') {\n    await cacheSetImpl(\n      key,\n      outcome,\n      config.accuracyPreflight.cacheTtlSeconds,\n      config.cache.staleSeconds,\n    );\n  }\n"""
new = """  if (outcome.state !== 'unavailable') {\n    const hardRejected = outcome.state === 'rejected';\n    await cacheSetImpl(\n      key,\n      outcome,\n      hardRejected ? config.accuracyPreflight.rejectCacheTtlSeconds : config.accuracyPreflight.cacheTtlSeconds,\n      hardRejected ? 0 : config.cache.staleSeconds,\n    );\n  }\n"""
if old not in text:
    raise SystemExit('accuracy cache anchor not found')
text = text.replace(old, new, 1)
old = """  // Only hard content failures are removed. Slow/unavailable preflight never hides a subtitle.\n  const survivors = decorated.filter(item => item.accuracyPreflight?.state !== 'rejected');\n  return prioritizeAccurateSubtitles(survivors, search);\n}\n"""
new = """  // Hard failures are removed when at least one candidate survives. If every inspected\n  // Arabic candidate is hard-rejected, fail open instead of turning a non-empty provider\n  // result into an empty Stremio list. Delivery-time quality gates and fallback sources\n  // remain authoritative when the selected asset is fetched.\n  const survivors = decorated.filter(item => item.accuracyPreflight?.state !== 'rejected');\n  if (survivors.length > 0) return prioritizeAccurateSubtitles(survivors, search);\n  return prioritizeAccurateSubtitles(decorated.map(item => ({\n    ...item,\n    accuracyPreflightFallback: 'all-candidates-rejected',\n  })), search);\n}\n"""
if old not in text:
    raise SystemExit('accuracy survivors anchor not found')
accuracy.write_text(text, encoding='utf-8')

# Final post-preflight LKG. This is intentionally version-independent so a deploy cannot
# erase a previously usable Arabic list. Exact/release hits may be served fresh; broad
# catalog hits are fallback-only to avoid forcing the wrong release onto a new file.
service = ROOT / 'src/services/subtitleService.js'
service.write_text("""import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { acquireRefreshLock, cacheGetEntry, cacheSet, releaseRefreshLock } from '../cache/redis.js';
import { applyAccuracyPreflight } from './accuracyPreflight.js';
import * as core from './subtitleServiceCore.js';

const inFlight = new Map();
const waitMs = Math.min(20_000, Math.max(250, Number(process.env.CACHE_SINGLEFLIGHT_WAIT_MS) || 5_000));
const pollMs = Math.min(1_000, Math.max(25, Number(process.env.CACHE_SINGLEFLIGHT_POLL_MS) || 100));

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizedFilename(value) {
  return String(value || '').trim().toLowerCase().replace(/\\s+/g, ' ').slice(0, 500);
}

function availabilityKeySpecs(search = {}) {
  const type = String(search.type || 'movie').toLowerCase();
  const id = String(search.id || search.imdbId || search.tmdbId || search.query || search.title || '').trim().toLowerCase();
  const season = Number(search.season || 0) || 0;
  const episode = Number(search.episode || 0) || 0;
  const videoHash = String(search.videoHash || search.hash || '').trim().toLowerCase();
  const videoSize = String(search.videoSize || search.size || '').trim();
  const filename = normalizedFilename(search.filename);
  const raw = [];
  if (videoHash) raw.push({ kind: 'exact', raw: `hash|${type}|${videoHash}|${videoSize}` });
  if (filename) raw.push({ kind: 'release', raw: `release|${type}|${id}|${season}|${episode}|${filename}|${videoSize}` });
  if (id) raw.push({ kind: 'catalog', raw: `catalog|${type}|${id}|${season}|${episode}` });
  const seen = new Set();
  return raw.filter(item => {
    if (seen.has(item.raw)) return false;
    seen.add(item.raw);
    return true;
  }).map(item => ({ ...item, key: `arabic-lkg:${digest(item.raw)}` }));
}

export function __availabilityKeySpecsForTests(search = {}) {
  return availabilityKeySpecs(search);
}

function usable(results) {
  return Array.isArray(results) && results.length > 0;
}

async function readAvailabilityLkg(search) {
  let broadFallback = null;
  for (const spec of availabilityKeySpecs(search)) {
    const cached = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    if (!cached?.hit || !usable(cached.value)) continue;
    const hit = { ...cached, kind: spec.kind };
    if (spec.kind === 'catalog') broadFallback ||= hit;
    else return hit;
  }
  return broadFallback;
}

async function writeAvailabilityLkg(search, results) {
  if (!usable(results)) return;
  const writes = availabilityKeySpecs(search).map(spec => cacheSet(
    spec.key,
    results,
    config.cache.availabilityTtlSeconds,
    config.cache.availabilityStaleSeconds,
  ));
  await Promise.allSettled(writes);
}

function singleflightKey(search) {
  const identity = JSON.stringify({
    type: search?.type || 'movie',
    id: search?.id || '',
    imdbId: search?.imdbId || '',
    tmdbId: search?.tmdbId || '',
    season: search?.season || null,
    episode: search?.episode || null,
    videoHash: search?.videoHash || search?.hash || '',
    videoSize: search?.videoSize || search?.size || '',
    filename: search?.filename || '',
    query: search?.query || search?.title || '',
    release: config.app.version,
  });
  return `cold-search:${digest(identity)}`;
}

async function searchCore(search) {
  return applyAccuracyPreflight(await core.searchSubtitles(search), search);
}

async function runDistributed(search, key) {
  let lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
  if (!lock.acquired) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      lock = await acquireRefreshLock(key, config.cache.refreshLockTtlSeconds);
      if (lock.acquired) break;
    }
  }
  if (!lock.acquired) return searchCore(search);
  try {
    return await searchCore(search);
  } finally {
    await releaseRefreshLock(lock);
  }
}

export async function searchSubtitles(search) {
  const lkg = await readAvailabilityLkg(search);
  // Exact hash/release LKG is safe to serve while fresh. A catalog-only LKG is fallback-only
  // because a different release of the same movie/episode may need better timing alignment.
  if (lkg?.kind !== 'catalog' && lkg?.hit && !lkg.stale) return lkg.value;

  const key = singleflightKey(search);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const fresh = await runDistributed(search, key);
    if (usable(fresh)) {
      await writeAvailabilityLkg(search, fresh);
      return fresh;
    }
    if (lkg?.hit && usable(lkg.value)) return lkg.value;
    return fresh;
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

export const getProvidersStatus = core.getProvidersStatus;
export const getProviderMetricsStatus = core.getProviderMetricsStatus;
export const getBreakersStatus = core.getBreakersStatus;
export const resetProviderBreaker = core.resetProviderBreaker;
export const getProviderLimitersStatus = core.getProviderLimitersStatus;
export const mergeResults = core.mergeResults;
export const flushBackgroundRefreshes = core.flushBackgroundRefreshes;
""", encoding='utf-8')

# Tests: preflight cannot erase the complete list; LKG keys are version-independent and layered.
acc_test = ROOT / 'src/tests/accuracyPreflight.test.js'
text = acc_test.read_text(encoding='utf-8')
append = """\n\ntest('accuracy preflight fails open when every Arabic candidate is hard-rejected', async () => {\n  const results = [candidate('first'), candidate('second', { score: 490 })];\n  const inspected = await applyAccuracyPreflight(results, { filename: 'Movie.2026.BluRay.mkv' }, {\n    ...noCache,\n    preflightImpl: async () => ({ quality: { valid: false, score: 10, reasons: ['low-arabic-ratio'] } }),\n  });\n  assert.equal(inspected.length, 2);\n  assert.equal(inspected[0].accuracyPreflightFallback, 'all-candidates-rejected');\n});\n"""
if "fails open when every Arabic candidate" not in text:
    acc_test.write_text(text.rstrip() + append + '\n', encoding='utf-8')

lkg_test = ROOT / 'src/tests/arabicFinalLkg.test.js'
lkg_test.write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { __availabilityKeySpecsForTests } from '../services/subtitleService.js';\n\ntest('final Arabic LKG has exact, release and catalog scopes without app-version coupling', () => {\n  const specs = __availabilityKeySpecsForTests({\n    type: 'series',\n    id: 'tt11198330:1:7',\n    season: 1,\n    episode: 7,\n    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.mkv',\n    videoHash: 'f6bdfb5e54ea25bf',\n    videoSize: '27228198074',\n  });\n  assert.deepEqual(specs.map(item => item.kind), ['exact', 'release', 'catalog']);\n  assert.ok(specs.every(item => item.key.startsWith('arabic-lkg:')));\n  assert.ok(specs.every(item => !item.raw.includes('4.3.0')));\n});\n""", encoding='utf-8')

# Docs.
changelog = ROOT / 'CHANGELOG.md'
text = changelog.read_text(encoding='utf-8')
entry = """## 4.3.0 - 2026-09-06\n\n- Add a version-independent final Arabic Last-Known-Good cache after Accuracy Preflight.\n- Prevent Accuracy Preflight from erasing the entire Arabic list when all inspected candidates hard-reject.\n- Version Accuracy Preflight decision keys with the application release to invalidate stale false rejections on deploy.\n- Reduce hard-rejection cache TTL to three minutes with no stale extension; valid quality decisions retain the normal cache TTL.\n- Serve fresh exact/release LKG immediately, while catalog-level LKG remains fallback-only to avoid forcing a mismatched release.\n\n"""
if not text.startswith('## 4.3.0'):
    changelog.write_text(entry + text, encoding='utf-8')

readme = ROOT / 'README.md'
text = readme.read_text(encoding='utf-8')
section = """\n\n### v4.3.0 Final Arabic availability\n\nA post-preflight, version-independent Redis Last-Known-Good layer now protects the final Arabic list. Accuracy Preflight can still remove a bad candidate when another candidate survives, but it cannot turn a non-empty Arabic provider result into an empty Stremio list. Hard-rejection decisions are release-versioned and expire quickly, preventing stale false rejections from surviving deploys.\n"""
if '### v4.3.0 Final Arabic availability' not in text:
    readme.write_text(text.rstrip() + section + '\n', encoding='utf-8')

print('v4.3.0 final Arabic LKG changes prepared')
