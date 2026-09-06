from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def replace(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Release + package metadata
replace('src/release.js', "export const RELEASE_VERSION = '4.1.0';", "export const RELEASE_VERSION = '4.2.0';")

p = ROOT / 'package.json'
data = json.loads(p.read_text(encoding='utf-8'))
data['version'] = '4.2.0'
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

p = ROOT / 'package-lock.json'
data = json.loads(p.read_text(encoding='utf-8'))
data['version'] = '4.2.0'
if '' in data.get('packages', {}):
    data['packages']['']['version'] = '4.2.0'
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Shared-first cache reads: critical search reads must consult Redis before per-replica memory.
redis_path = ROOT / 'src/cache/redis.js'
text = redis_path.read_text(encoding='utf-8')
old = """export async function cacheGetEntry(key, options = {}) {\n  const fullKey = normalizeKey(key);\n  const cached = unwrap(memory.get(fullKey), options);\n  if (cached) {\n    recordCache(cached.stale ? 'memory-stale' : 'memory-hit');\n    return { ...cached, source: 'memory' };\n  }\n  if (memory.has(fullKey)) memory.delete(fullKey);\n\n  const client = await getSharedRedisClient();\n  if (!client) {\n    recordCache('miss');\n    return null;\n  }\n  try {\n    const raw = await client.get(fullKey);\n    const parsed = raw ? JSON.parse(raw) : null;\n    const fromRedis = unwrap(parsed, options);\n    if (!fromRedis) {\n      recordCache('miss');\n      return null;\n    }\n    memory.set(fullKey, fromRedis.entry);\n    pruneMemory();\n    recordCache(fromRedis.stale ? 'redis-stale' : 'redis-hit');\n    return { ...fromRedis, source: 'redis' };\n  } catch (err) {\n    recordCache('error');\n    console.warn('[cache:get]', err.message);\n    return null;\n  }\n}\n"""
new = """export async function cacheGetEntry(key, options = {}) {\n  const fullKey = normalizeKey(key);\n  const preferShared = Boolean(options.preferShared);\n\n  const memoryEntry = () => {\n    const cached = unwrap(memory.get(fullKey), options);\n    if (!cached && memory.has(fullKey)) memory.delete(fullKey);\n    return cached;\n  };\n\n  if (!preferShared) {\n    const cached = memoryEntry();\n    if (cached) {\n      recordCache(cached.stale ? 'memory-stale' : 'memory-hit');\n      return { ...cached, source: 'memory' };\n    }\n  }\n\n  const client = await getSharedRedisClient();\n  if (client) {\n    try {\n      const raw = await client.get(fullKey);\n      const parsed = raw ? JSON.parse(raw) : null;\n      const fromRedis = unwrap(parsed, options);\n      if (fromRedis) {\n        memory.set(fullKey, fromRedis.entry);\n        pruneMemory();\n        recordCache(fromRedis.stale ? 'redis-stale' : 'redis-hit');\n        return { ...fromRedis, source: 'redis' };\n      }\n    } catch (err) {\n      recordCache('error');\n      console.warn('[cache:get]', err.message);\n    }\n  }\n\n  // Redis is unavailable or has no usable entry. A local entry is only a fallback,\n  // never the first authority for shared search results across replicas.\n  const cached = memoryEntry();\n  if (cached) {\n    recordCache(cached.stale ? 'memory-fallback-stale' : 'memory-fallback');\n    return { ...cached, source: 'memory-fallback' };\n  }\n  recordCache('miss');\n  return null;\n}\n"""
if old not in text:
    raise SystemExit('redis cacheGetEntry anchor not found')
redis_path.write_text(text.replace(old, new, 1), encoding='utf-8')

# Search availability invariants: no empty search-cache writes; stale last-known-good wins over transient emptiness.
core_path = ROOT / 'src/services/subtitleServiceCore.js'
text = core_path.read_text(encoding='utf-8')
text = text.replace(
"""      const fresh = await buildFreshSubtitles(search);\n      await cacheSet(key, fresh, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n""",
"""      const fresh = await buildFreshSubtitles(search);\n      if (Array.isArray(fresh) && fresh.length > 0) {\n        await cacheSet(key, fresh, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n      }\n""",
1,
)
old = """export async function searchSubtitles(search) {\n  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));\n  const key = cacheKey(identity);\n  const cached = await cacheGetEntry(key, { allowStale: config.cache.staleWhileRevalidate });\n  if (cached?.hit && !cached.stale) return cached.value;\n  if (cached?.hit && cached.stale) {\n    refreshInBackground(key, identity);\n    return cached.value;\n  }\n  const ranked = await buildFreshSubtitles(identity);\n  await cacheSet(key, ranked, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n  return ranked;\n}\n"""
new = """export function hasUsableSubtitleResults(value) {\n  return Array.isArray(value) && value.length > 0;\n}\n\nexport async function searchSubtitles(search) {\n  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));\n  const key = cacheKey(identity);\n\n  // Search availability is shared-state critical. Prefer Redis over replica-local memory\n  // and always retain a stale non-empty result as Last-Known-Good fallback.\n  const cached = await cacheGetEntry(key, { allowStale: true, preferShared: true });\n  const cachedGood = cached?.hit && hasUsableSubtitleResults(cached.value) ? cached.value : null;\n\n  if (cachedGood && !cached.stale) return cachedGood;\n  if (cachedGood && cached.stale && config.cache.staleWhileRevalidate) {\n    refreshInBackground(key, identity);\n    return cachedGood;\n  }\n\n  const ranked = await buildFreshSubtitles(identity);\n  if (hasUsableSubtitleResults(ranked)) {\n    await cacheSet(key, ranked, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n    return ranked;\n  }\n\n  // Never poison Redis or replica memory with an empty search result. Provider 403/429,\n  // timeouts, circuit-breaker opens and transient metadata failures are intentionally\n  // indistinguishable from a legitimate empty provider response at this layer.\n  // Keeping empties uncached makes the next Stremio probe retry immediately.\n  if (cachedGood) return cachedGood;\n  return [];\n}\n"""
if old not in text:
    raise SystemExit('subtitle searchSubtitles anchor not found')
core_path.write_text(text.replace(old, new, 1), encoding='utf-8')

# Never let Stremio/client/CDN cache the search list. Positive results are cached server-side in Redis.
route_path = ROOT / 'src/api/routes/subtitles.js'
text = route_path.read_text(encoding='utf-8')
old = """    const results = await searchSubtitles(search);\n    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');\n    const body = normalizeStremioSubtitleResponse({\n"""
new = """    const results = await searchSubtitles(search);\n    setStremioSearchNoStoreHeaders(res);\n    const body = normalizeStremioSubtitleResponse({\n"""
if old not in text:
    raise SystemExit('stremio cache header anchor not found')
text = text.replace(old, new, 1)
insert_anchor = """async function stremioHandler(req, res, next) {\n"""
helper = """export function setStremioSearchNoStoreHeaders(res) {\n  res.setHeader('Cache-Control', 'no-store, max-age=0');\n  res.setHeader('CDN-Cache-Control', 'no-store');\n  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');\n  res.setHeader('Surrogate-Control', 'no-store');\n  res.setHeader('Pragma', 'no-cache');\n  res.setHeader('Expires', '0');\n}\n\n"""
if insert_anchor not in text:
    raise SystemExit('stremio handler anchor not found')
route_path.write_text(text.replace(insert_anchor, helper + insert_anchor, 1), encoding='utf-8')

# Regression tests for availability invariants.
test_path = ROOT / 'src/tests/arabicAvailability.test.js'
test_path.write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { hasUsableSubtitleResults } from '../services/subtitleServiceCore.js';\nimport { setStremioSearchNoStoreHeaders } from '../api/routes/subtitles.js';\n\ntest('empty subtitle arrays are never considered cacheable usable search results', () => {\n  assert.equal(hasUsableSubtitleResults([]), false);\n  assert.equal(hasUsableSubtitleResults(null), false);\n  assert.equal(hasUsableSubtitleResults([{ id: 'arabic-1' }]), true);\n});\n\ntest('Stremio subtitle search responses are explicitly no-store at every cache layer', () => {\n  const headers = new Map();\n  const res = { setHeader(name, value) { headers.set(name.toLowerCase(), value); } };\n  setStremioSearchNoStoreHeaders(res);\n  assert.equal(headers.get('cache-control'), 'no-store, max-age=0');\n  assert.equal(headers.get('cdn-cache-control'), 'no-store');\n  assert.equal(headers.get('cloudflare-cdn-cache-control'), 'no-store');\n  assert.equal(headers.get('surrogate-control'), 'no-store');\n  assert.equal(headers.get('pragma'), 'no-cache');\n  assert.equal(headers.get('expires'), '0');\n});\n""", encoding='utf-8')

# Changelog + README note.
changelog = ROOT / 'CHANGELOG.md'
text = changelog.read_text(encoding='utf-8')
entry = """## 4.2.0 - 2026-09-06\n\n- Make Arabic subtitle availability resilient to transient provider failures.\n- Never persist empty subtitle search results into Redis or replica-local memory.\n- Prefer shared Redis before per-replica memory for subtitle-search cache reads.\n- Preserve stale non-empty Last-Known-Good results when a fresh provider search returns empty.\n- Prevent Stremio, CDN, and intermediary caches from caching subtitle-list responses; positive lists remain server-side cached.\n- Prevent background refresh from overwriting a good cached subtitle list with an empty result.\n\n"""
if not text.startswith('## 4.2.0'):
    changelog.write_text(entry + text, encoding='utf-8')

readme = ROOT / 'README.md'
text = readme.read_text(encoding='utf-8')
section = """\n\n### v4.2.0 Arabic availability guarantee\n\nSubtitle-list responses are now client `no-store`, while positive Arabic search results remain cached in shared Redis. Empty searches are never persisted, replica-local memory cannot override shared Redis for subtitle searches, and a stale non-empty Last-Known-Good list is retained when a fresh provider attempt temporarily returns nothing. This prevents transient provider 403/429/timeouts from poisoning Stremio with an empty Arabic list.\n"""
if '### v4.2.0 Arabic availability guarantee' not in text:
    readme.write_text(text.rstrip() + section + '\n', encoding='utf-8')

print('v4.2.0 availability changes prepared')
