from pathlib import Path

ROOT=Path('.')
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(s,a,b,label):
    if a not in s: raise SystemExit(f'anchor not found: {label}')
    return s.replace(a,b,1)

# scoring: allow caller to defer score floor until after Accuracy-First.
p='src/utils/scoring.js'; s=r(p)
s=rep(s,"  const minRankScore = config.minRankScore ?? appConfig.ranking.minRankScore ?? -250;\n", "  const minRankScore = config.minRankScore ?? appConfig.ranking.minRankScore ?? -250;\n  const applyMinRankScore = config.applyMinRankScore ?? true;\n", 'score option')
s=rep(s,"    if (scoring.score < minRankScore) continue;\n", "    if (applyMinRankScore && scoring.score < minRankScore) continue;\n", 'score gate')
w(p,s)

# Accuracy-first: strong timing evidence can rescue a low heuristic score; score floor is post-order.
p='src/utils/accuracyFirst.js'; s=r(p)
insert='''\nexport function hasStrongTimingEvidence(item, search = {}) {\n  if (evidenceRank(item) > 0 || timingReferenceRank(item) > 0) return true;\n  if (hardConflictCount(item) > 0) return false;\n  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');\n  const candidateFamily = sourceFamily(releaseText(item));\n  if (targetFamily && candidateFamily && targetFamily === candidateFamily) return true;\n  const match = meaningfulReleaseMatch(item);\n  return Boolean(match && Number(match.criticalMismatches || 0) === 0 && Number(match.tier || 0) >= 2);\n}\n\nexport function applyPostAccuracyScoreFloor(results = [], search = {}, minScore = Number.NEGATIVE_INFINITY) {\n  const ranked = prioritizeAccurateSubtitles(results, search);\n  const floor = Number(minScore);\n  if (!Number.isFinite(floor)) return ranked;\n  return ranked.filter(item => Number(item?.score ?? Number.NEGATIVE_INFINITY) >= floor || hasStrongTimingEvidence(item, search));\n}\n'''
s=rep(s,"\n\nexport function prioritizeAndLimitAccurateSubtitles", insert+"\nexport function prioritizeAndLimitAccurateSubtitles", 'accuracy exports')
w(p,s)

# Core provider-cycle completeness tracking via AsyncLocalStorage.
p='src/services/subtitleServiceCore.js'; s=r(p)
s=rep(s,"import { config } from '../config.js';\n", "import { AsyncLocalStorage } from 'node:async_hooks';\nimport { config } from '../config.js';\n", 'async local import')
s=s.replace("import { prioritizeAndLimitAccurateSubtitles } from '../utils/accuracyFirst.js';", "import { applyPostAccuracyScoreFloor, hasStrongTimingEvidence, prioritizeAndLimitAccurateSubtitles } from '../utils/accuracyFirst.js';")
s=s.replace("import { isEnglishLanguage } from '../utils/language.js';", "import { isArabicLanguage, isEnglishLanguage } from '../utils/language.js';")
anchor="const backgroundRefreshTasks = new Set();\n"
cycle='''const providerCycleStorage = new AsyncLocalStorage();\n\nfunction createProviderCycle() {\n  return { attempted: 0, succeeded: 0, failed: 0, providersAttempted: new Set(), providersFailed: new Set() };\n}\n\nfunction cycleFor(variant) {\n  return isArabicLanguage(variant?.language || 'ar') ? providerCycleStorage.getStore() : null;\n}\n\nfunction recordCycleAttempt(providerName, variant) {\n  const cycle = cycleFor(variant);\n  if (!cycle) return;\n  cycle.attempted += 1;\n  cycle.providersAttempted.add(providerName);\n}\n\nfunction recordCycleSuccess(providerName, variant) {\n  const cycle = cycleFor(variant);\n  if (!cycle) return;\n  cycle.succeeded += 1;\n}\n\nfunction recordCycleFailure(providerName, variant) {\n  const cycle = cycleFor(variant);\n  if (!cycle) return;\n  cycle.failed += 1;\n  cycle.providersFailed.add(providerName);\n}\n\nexport function classifyProviderCycle(cycle = {}) {\n  const attempted = Number(cycle.attempted || 0);\n  const succeeded = Number(cycle.succeeded || 0);\n  const failed = Number(cycle.failed || 0);\n  if (!attempted) return 'complete';\n  if (!failed) return 'complete';\n  if (!succeeded) return 'failed';\n  return 'degraded';\n}\n\n'''
s=rep(s,anchor,anchor+cycle,'cycle helpers')
s=rep(s,"async function runProvider(providerName, variant) {\n  const handler = providerHandlers[providerName];\n  if (!handler) return [];\n", "async function runProvider(providerName, variant) {\n  const handler = providerHandlers[providerName];\n  if (!handler) return [];\n  recordCycleAttempt(providerName, variant);\n", 'attempt')
s=rep(s,"        recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'circuit-breaker-open' });\n        return [];", "        recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'circuit-breaker-open' });\n        recordCycleFailure(providerName, variant);\n        return [];", 'breaker failure')
s=rep(s,"        breaker?.recordSuccess();\n        recordProviderCall(providerName, { ok: true, count: results.length, ms: elapsedMs });", "        breaker?.recordSuccess();\n        recordCycleSuccess(providerName, variant);\n        recordProviderCall(providerName, { ok: true, count: results.length, ms: elapsedMs });", 'success')
s=s.replace("          recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: 'stage-deadline' });\n          return [];", "          recordProviderCall(providerName, { ok: false, count: 0, ms: Date.now() - started, error: 'stage-deadline' });\n          recordCycleFailure(providerName, variant);\n          return [];")
s=s.replace("        breaker?.recordFailure();\n        recordProviderCall(providerName, { ok: false, count: 0, ms: elapsedMs, error: error.message });", "        breaker?.recordFailure();\n        recordCycleFailure(providerName, variant);\n        recordProviderCall(providerName, { ok: false, count: 0, ms: elapsedMs, error: error.message });")
s=s.replace("      recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'stage-deadline-queued' });\n      return [];", "      recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: 'stage-deadline-queued' });\n      recordCycleFailure(providerName, variant);\n      return [];")
s=s.replace("    recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: error.message });\n    console.warn", "    recordCycleFailure(providerName, variant);\n    recordProviderCall(providerName, { ok: false, count: 0, ms: 0, error: error.message });\n    console.warn")
# ensure aborted provider tasks settle before classifying cycle
s=rep(s,"    if (outcome === 'deadline') {\n      controller.abort(new DOMException('Provider stage deadline exceeded', 'AbortError'));\n    }", "    if (outcome === 'deadline') {\n      controller.abort(new DOMException('Provider stage deadline exceeded', 'AbortError'));\n      await Promise.allSettled(tasks);\n    }", 'deadline settle')

# Defer score floor until after accuracy ordering, with timing-evidence rescue.
old='''  const ranked = rankAndFilter(allowed, search, {\n    outputArabicOnly: config.providers.outputArabicOnly,\n    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,\n    excludeMachineTranslated: config.providers.excludeMachineTranslated,\n    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,\n    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,\n    minRankScore: relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore,\n  });'''
new='''  const minRankScore = relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore;\n  const ranked = rankAndFilter(allowed, search, {\n    outputArabicOnly: config.providers.outputArabicOnly,\n    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,\n    excludeMachineTranslated: config.providers.excludeMachineTranslated,\n    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,\n    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,\n    minRankScore,\n    applyMinRankScore: false,\n  });'''
s=rep(s,old,new,'defer min score')
old2='''  const prioritized = prioritizeAndLimitAccurateSubtitles(\n    safe,\n    search,\n    limit ? config.providers.topN : Infinity,\n  );\n  return prioritized.map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));'''
new2='''  const ordered = applyPostAccuracyScoreFloor(safe, search, minRankScore);\n  const prioritized = limit ? ordered.slice(0, config.providers.topN) : ordered;\n  return prioritized.map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));'''
s=rep(s,old2,new2,'post score floor')

# Wrap fresh build in request-local provider cycle.
anchor='''async function buildFreshSubtitles(input) {'''
# leave build function unchanged, add wrapper before refresh function later
insert='''async function buildFreshSubtitlesWithStatus(input) {\n  const cycle = createProviderCycle();\n  const results = await providerCycleStorage.run(cycle, () => buildFreshSubtitles(input));\n  return { results, cycleStatus: classifyProviderCycle(cycle) };\n}\n\n'''
idx=s.index('function refreshInBackground(')
s=s[:idx]+insert+s[idx:]
# background policy
s=s.replace("      const fresh = await buildFreshSubtitles(search);\n      if (Array.isArray(fresh) && fresh.length > 0) {", "      const { results: fresh, cycleStatus } = await buildFreshSubtitlesWithStatus(search);\n      if (Array.isArray(fresh) && fresh.length > 0) {")
s=s.replace("        const preserved = existing?.hit && hasUsableSubtitleResults(existing.value)\n          ? preserveAccurateCandidates(search, fresh, existing.value)\n          : preserveAccurateCandidates(search, fresh);\n        await cacheSet(key, preserved, config.cache.searchTtlSeconds, config.cache.staleSeconds);", "        const existingGood = existing?.hit && hasUsableSubtitleResults(existing.value) ? existing.value : null;\n        const next = cycleStatus === 'complete'\n          ? preserveAccurateCandidates(search, fresh)\n          : (existingGood ? preserveAccurateCandidates(search, fresh, existingGood) : preserveAccurateCandidates(search, fresh));\n        if (cycleStatus === 'complete' || existingGood) {\n          await cacheSet(key, next, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n        }")
# Replace exported search function with status-aware version
start=s.index('export async function searchSubtitles(search) {')
end=s.index('\nexport async function getProvidersStatus()', start)
oldblock=s[start:end]
newblock='''export async function searchSubtitlesWithStatus(search) {\n  const identity = await versionRegistry.hydrateIdentity(buildVideoIdentity(search));\n  const key = cacheKey(identity);\n  const cached = await cacheGetEntry(key, { allowStale: true, preferShared: true });\n  const cachedGood = cached?.hit && hasUsableSubtitleResults(cached.value) ? cached.value : null;\n\n  if (cachedGood && !cached.stale) return { results: cachedGood, cycleStatus: 'cached' };\n  if (cachedGood && cached.stale && config.cache.staleWhileRevalidate) {\n    refreshInBackground(key, identity);\n    return { results: cachedGood, cycleStatus: 'cached' };\n  }\n\n  const { results: ranked, cycleStatus } = await buildFreshSubtitlesWithStatus(identity);\n  if (hasUsableSubtitleResults(ranked)) {\n    const next = cycleStatus === 'complete'\n      ? preserveAccurateCandidates(identity, ranked)\n      : (cachedGood ? preserveAccurateCandidates(identity, ranked, cachedGood) : preserveAccurateCandidates(identity, ranked));\n    if (cycleStatus === 'complete' || cachedGood) {\n      await cacheSet(key, next, config.cache.searchTtlSeconds, config.cache.staleSeconds);\n    }\n    return { results: next, cycleStatus };\n  }\n\n  if (cachedGood) return { results: cachedGood, cycleStatus };\n  return { results: [], cycleStatus };\n}\n\nexport async function searchSubtitles(search) {\n  return (await searchSubtitlesWithStatus(search)).results;\n}\n'''
s=s[:start]+newblock+s[end:]
w(p,s)

# Outer final LKG respects completeness: complete replaces, degraded merges, cached/failed don't rewrite.
p='src/services/subtitleService.js'; s=r(p)
s=rep(s,"async function writeAvailabilityLkg(search, results) {", "async function writeAvailabilityLkg(search, results, mode = 'merge') {", 'lkg mode')
s=rep(s,"    const preserved = current?.hit && usable(current.value)\n      ? core.preserveAccurateCandidates(search, results, current.value)\n      : core.preserveAccurateCandidates(search, results);", "    const preserved = mode === 'replace'\n      ? core.preserveAccurateCandidates(search, results)\n      : (current?.hit && usable(current.value)\n        ? core.preserveAccurateCandidates(search, results, current.value)\n        : core.preserveAccurateCandidates(search, results));", 'lkg replace')
s=rep(s,"async function searchCore(search) {\n  return applyAccuracyPreflight(await core.searchSubtitles(search), search);\n}", "async function searchCore(search) {\n  const outcome = await core.searchSubtitlesWithStatus(search);\n  return { ...outcome, results: await applyAccuracyPreflight(outcome.results, search) };\n}\n", 'outer status')
old='''    const fresh = await runDistributed(search, key);\n    if (usable(fresh)) {\n      await writeAvailabilityLkg(search, fresh);\n      return fresh;\n    }\n    if (lkg?.hit && usable(lkg.value)) return lkg.value;\n    return fresh;'''
new='''    const outcome = await runDistributed(search, key);\n    const fresh = outcome.results;\n    if (usable(fresh)) {\n      if (outcome.cycleStatus === 'complete') await writeAvailabilityLkg(search, fresh, 'replace');\n      else if (outcome.cycleStatus === 'degraded') await writeAvailabilityLkg(search, fresh, 'merge');\n      return fresh;\n    }\n    if (lkg?.hit && usable(lkg.value)) return lkg.value;\n    return fresh;'''
s=rep(s,old,new,'outer lkg policy')
w(p,s)

# Regression corpus + tests.
fixture=ROOT/'src/tests/fixtures/timing-regressions.json'; fixture.parent.mkdir(parents=True,exist_ok=True)
fixture.write_text('''[\n  {\n    "name":"house-of-the-dragon-s01e07-bluray-over-web",\n    "search":{"filename":"House.of.the.Dragon.S01E07.2160p.BluRay.Remux.DV.HDR.HEVC.Atmos-SGF.mkv"},\n    "expected":"bluray",\n    "candidates":[\n      {"id":"web","provider":"opensubtitles","releaseName":"House.of.the.Dragon.S01E07.2160p.WEB-DL-GRP","score":1500,"releaseMatch":{"targetFields":3,"tier":2,"priority":21000,"criticalMismatches":0,"mismatched":["source"]}},\n      {"id":"bluray","provider":"opensubtitles","releaseName":"House.of.the.Dragon.S01E07.720p.BluRay.x264-BLOODY","score":700,"releaseMatch":{"targetFields":3,"tier":2,"priority":18000,"criticalMismatches":0,"mismatched":["quality"]}}\n    ]\n  },\n  {\n    "name":"exact-hash-veto",\n    "search":{"filename":"Movie.2026.2160p.BluRay.Remux.mkv","videoHash":"abcd1234"},\n    "expected":"hash",\n    "candidates":[\n      {"id":"heuristic","provider":"subdl","releaseName":"Movie.2026.2160p.BluRay.Remux-GRP","score":2200,"releaseMatch":{"targetFields":4,"tier":5,"priority":52000,"criticalMismatches":0,"mismatched":[]}},\n      {"id":"hash","provider":"opensubtitles","releaseName":"Movie.2026.1080p.WEB-DL-OTHER","score":100,"scoreReasons":[{"reason":"exact-video-hash-match","value":1800}],"releaseMatch":{"targetFields":4,"tier":1,"priority":8000,"criticalMismatches":0,"mismatched":["source"]}}\n    ]\n  }\n]\n''',encoding='utf-8')

test=ROOT/'src/tests/timingRegressionCorpus.test.js'
test.write_text('''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport { prioritizeAccurateSubtitles, applyPostAccuracyScoreFloor } from '../utils/accuracyFirst.js';\nimport { classifyProviderCycle } from '../services/subtitleServiceCore.js';\n\nconst corpus = JSON.parse(await readFile(new URL('./fixtures/timing-regressions.json', import.meta.url), 'utf8'));\nfor (const item of corpus) {\n  test(`timing regression: ${item.name}`, () => {\n    const ranked = prioritizeAccurateSubtitles(item.candidates, item.search);\n    assert.equal(ranked[0].id, item.expected);\n  });\n}\n\ntest('post-accuracy score floor rescues a strong source-family match', () => {\n  const search = { filename: 'Show.S01E07.2160p.BluRay.Remux-GRP.mkv' };\n  const results = [\n    { id:'bluray-low', provider:'subdl', releaseName:'Show.S01E07.720p.BluRay.x264-BLOODY', score:-500, releaseMatch:{targetFields:3,tier:2,priority:12000,criticalMismatches:0,mismatched:['quality']} },\n    { id:'unknown-low', provider:'yify', releaseName:'Show.S01E07.Unknown.Release', score:-600, releaseMatch:{targetFields:0,tier:0,priority:0,criticalMismatches:0,mismatched:[]} },\n    { id:'web-high', provider:'opensubtitles', releaseName:'Show.S01E07.2160p.WEB-DL-GRP', score:1600, releaseMatch:{targetFields:3,tier:2,priority:22000,criticalMismatches:0,mismatched:['source']} },\n  ];\n  const ranked = applyPostAccuracyScoreFloor(results, search, -250);\n  assert.equal(ranked[0].id, 'bluray-low');\n  assert.ok(ranked.some(item => item.id === 'bluray-low'));\n  assert.equal(ranked.some(item => item.id === 'unknown-low'), false);\n});\n\ntest('provider cycle completeness distinguishes complete, degraded and failed', () => {\n  assert.equal(classifyProviderCycle({attempted:3,succeeded:3,failed:0}), 'complete');\n  assert.equal(classifyProviderCycle({attempted:3,succeeded:2,failed:1}), 'degraded');\n  assert.equal(classifyProviderCycle({attempted:2,succeeded:0,failed:2}), 'failed');\n});\n''',encoding='utf-8')

# Docs refine scope.
p='CHANGELOG.md'; s=r(p)
needle='- Keep newly discovered exact-video-hash evidence authoritative over preserved heuristic candidates.\n'
extra='- Move `minRankScore` behind Accuracy-First and rescue candidates with strong timing evidence.\n- Classify provider cycles as complete/degraded/failed and only merge prior pools on degraded cycles.\n- Add a permanent timing regression corpus, including the House of the Dragon BluRay-vs-WEB incident.\n'
if extra not in s: s=s.replace(needle,needle+extra,1)
w(p,s)
p='README.md'; s=r(p)
needle='- تطبيق الحماية نفسها على background refresh وFinal Arabic LKG مع إبقاء Exact Hash أقوى دليل.\n'
extra='- أصبح `minRankScore` فلترًا بعد Accuracy-First، مع إنقاذ المرشح ذي الدليل الزمني القوي بدل حذفه مبكرًا.\n- دورة المزودات تُصنّف `complete/degraded/failed`: الدمج مع النتائج القديمة يحدث فقط عند تدهور حقيقي، أما الدورة الكاملة فتستبدل الكاش.\n- أضيف Regression Corpus دائم لحالات التوافق، يبدأ بحالة House of the Dragon BluRay مقابل WEB.\n'
if extra not in s: s=s.replace(needle,needle+extra,1)
w(p,s)

print('final v4.4.1 policy applied')