from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


# Search planning: strong IDs should be queried alone; release/title fallbacks must really be independent fallbacks.
path = 'src/services/searchPlanner.js'
replace_once(path,
"""  references = false,\n} = {}) {""",
"""  references = false,\n  relaxed = false,\n  maxAliases = 2,\n} = {}) {""")
replace_once(path,
"""        variants: [variant('exact-metadata', identity, { videoHash: null, videoSize: null })],""",
"""        variants: [variant('exact-metadata', identity, {\n          query: '',\n          filename: '',\n          videoHash: null,\n          videoSize: null,\n          relaxedFallback: relaxed,\n        })],""")
replace_once(path,
"""          query: identity.filename,\n          imdbId: identity.imdbId,\n          tmdbId: identity.tmdbId,\n          videoHash: null,\n          videoSize: null,""",
"""          query: identity.filename,\n          imdbId: null,\n          tmdbId: null,\n          videoHash: null,\n          videoSize: null,\n          relaxedFallback: relaxed,""")
replace_once(path,
"""          query: identity.title || identity.query,\n          filename: '',\n          videoHash: null,\n          videoSize: null,""",
"""          query: identity.title || identity.query,\n          filename: '',\n          imdbId: null,\n          tmdbId: null,\n          videoHash: null,\n          videoSize: null,\n          relaxedFallback: relaxed,""")
replace_once(path,
"""  return stages;\n}""",
"""  const canonical = String(identity.title || identity.query || '').trim().toLowerCase();\n  const aliases = [...new Set((identity.aliases || [])\n    .map(value => String(value || '').trim())\n    .filter(Boolean))]\n    .filter(value => value.toLowerCase() !== canonical)\n    .slice(0, Math.max(0, maxAliases));\n  if (aliases.length) {\n    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);\n    if (providers.length) {\n      stages.push({\n        name: 'alias-fallback',\n        providers,\n        variants: aliases.map(alias => variant('alias-fallback', identity, {\n          query: alias,\n          title: alias,\n          filename: '',\n          imdbId: null,\n          tmdbId: null,\n          videoHash: null,\n          videoSize: null,\n          relaxedFallback: relaxed,\n        })),\n      });\n    }\n  }\n\n  return stages;\n}""")

# OpenSubtitles: only exclude HI in strict search. Recovery can include it and strip SDH later in proxy processing.
path = 'src/providers/openSubtitles.js'
replace_once(path,
"""  addParam(params, 'hearing_impaired', config.providers.excludeHearingImpaired ? 'exclude' : 'include');""",
"""  addParam(\n    params,\n    'hearing_impaired',\n    variant.relaxedFallback ? 'include' : (config.providers.excludeHearingImpaired ? 'exclude' : 'include'),\n  );""")

# Accuracy preflight: feed measured content quality back into final ordering, not only hard-reject bad files.
path = 'src/services/accuracyPreflight.js'
replace_once(path,
"""  const decorated = ranked.map(item => {\n    const outcome = inspected.get(candidateKey(item, search));\n    return outcome ? { ...item, accuracyPreflight: outcome } : item;\n  });""",
"""  const decorated = ranked.map(item => {\n    const outcome = inspected.get(candidateKey(item, search));\n    if (!outcome) return item;\n    const measuredQuality = outcome.quality\n      ? { ...(item.quality || {}), ...outcome.quality }\n      : item.quality;\n    return {\n      ...item,\n      ...(measuredQuality ? { quality: measuredQuality, qualityScore: measuredQuality.score } : {}),\n      accuracyPreflight: outcome,\n    };\n  });""")

# Core: strict first, then deterministic relaxed rerank, then one bounded OpenSubtitles recovery query.
path = 'src/services/subtitleServiceCore.js'
replace_once(path,
"""async function rankArabic(items, search) {\n  const allowed = await filterRejected(search, items);\n  return rankAndFilter(allowed, search, {\n    outputArabicOnly: config.providers.outputArabicOnly,\n    excludeHearingImpaired: config.providers.excludeHearingImpaired,\n    excludeMachineTranslated: config.providers.excludeMachineTranslated,\n    strictQualityFilters: config.providers.strictQualityFilters,\n    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,\n    minRankScore: config.ranking.minRankScore,\n  }).slice(0, config.providers.topN);\n}\n\nasync function finalizeArabic(search, ...groups) {\n  return rankArabic(mergeResults(...groups), search);\n}""",
"""const RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition']);\n\nasync function rankArabic(items, search, { relaxed = false } = {}) {\n  const allowed = await filterRejected(search, items);\n  const ranked = rankAndFilter(allowed, search, {\n    outputArabicOnly: config.providers.outputArabicOnly,\n    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,\n    excludeMachineTranslated: config.providers.excludeMachineTranslated,\n    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,\n    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,\n    minRankScore: relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore,\n  });\n  const safe = relaxed\n    ? ranked.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))\n    : ranked;\n  return safe.slice(0, config.providers.topN).map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));\n}\n\nasync function finalizeArabic(search, ...groups) {\n  return rankArabic(mergeResults(...groups), search);\n}\n\nasync function finalizeArabicRelaxed(search, ...groups) {\n  return rankArabic(mergeResults(...groups), search, { relaxed: true });\n}""")
replace_once(path,
"""    maxProvidersPerStage: config.resolver.maxProvidersPerStage,\n  }).filter(stage => stage.name === 'exact-hash');""",
"""    maxProvidersPerStage: config.resolver.maxProvidersPerStage,\n    maxAliases: config.resolver.recoveryMaxAliases,\n  }).filter(stage => stage.name === 'exact-hash');""")
replace_once(path,
"""    maxProvidersPerStage: config.resolver.maxProvidersPerStage,\n    includeHash: false,\n  });""",
"""    maxProvidersPerStage: config.resolver.maxProvidersPerStage,\n    includeHash: false,\n    maxAliases: config.resolver.recoveryMaxAliases,\n  });""")
replace_once(path,
"""  const ranked = await rankArabic(raw, search);\n  const withReferences = await attachReferenceCandidates(ranked, search);""",
"""  let ranked = await rankArabic(raw, search);\n  let recoveryRaw = [];\n  if (!ranked.length && config.resolver.recoveryEnabled) {\n    ranked = await rankArabic(raw, search, { relaxed: true });\n    if (!ranked.length && config.providers.enabled.includes('opensubtitles')) {\n      const recoveryPlan = createSearchPlan(search, providerDefinitions, ['opensubtitles'], {\n        language: 'ar',\n        maxProvidersPerStage: 1,\n        includeHash: false,\n        relaxed: true,\n        maxAliases: config.resolver.recoveryMaxAliases,\n      });\n      for (const stage of recoveryPlan) {\n        recoveryRaw.push(...await runStage(stage, search, 'ar'));\n      }\n      ranked = await rankArabic(mergeResults(raw, recoveryRaw), search, { relaxed: true });\n    }\n  }\n  const withReferences = await attachReferenceCandidates(ranked, search);""")
replace_once(path,
"""  return finalizeArabic(search, registryResults, vaultResults, withReferences);""",
"""  if (ranked.some(item => item.recoveryTier === 'relaxed-arabic')) {\n    return finalizeArabicRelaxed(search, registryResults, vaultResults, withReferences, recoveryRaw);\n  }\n  return finalizeArabic(search, registryResults, vaultResults, withReferences);""")

# Config: bounded recovery and wider content preflight. Keep machine translations excluded.
path = 'src/configCore.js'
replace_once(path,
"""      upgradeMinDelta: toInt(get('RESOLVER_UPGRADE_MIN_DELTA'), 180, 1, 5000),\n      metadata: {""",
"""      upgradeMinDelta: toInt(get('RESOLVER_UPGRADE_MIN_DELTA'), 180, 1, 5000),\n      recoveryEnabled: toBool(get('RESOLVER_RECOVERY_ENABLED'), true),\n      recoveryMinRankScore: toInt(get('RESOLVER_RECOVERY_MIN_RANK_SCORE'), -250, -2000, 3000),\n      recoveryMaxAliases: toInt(get('RESOLVER_RECOVERY_MAX_ALIASES'), 2, 0, 5),\n      metadata: {""")
replace_once(path,
"""      topN: toInt(get('ACCURACY_PREFLIGHT_TOP_N'), 3, 0, 5),""",
"""      topN: toInt(get('ACCURACY_PREFLIGHT_TOP_N'), 5, 0, 5),""")

# Release metadata.
path = 'src/release.js'
replace_once(path, "export const RELEASE_VERSION = '4.0.0';", "export const RELEASE_VERSION = '4.1.0';")

# Environment documentation.
p = Path('.env.example')
text = p.read_text()
if 'RESOLVER_RECOVERY_ENABLED=' not in text:
    anchor = 'RESOLVER_UPGRADE_MIN_DELTA=180\n'
    if anchor not in text:
        raise SystemExit('.env.example: resolver anchor missing')
    text = text.replace(anchor, anchor + 'RESOLVER_RECOVERY_ENABLED=true\nRESOLVER_RECOVERY_MIN_RANK_SCORE=-250\nRESOLVER_RECOVERY_MAX_ALIASES=2\n', 1)
text = text.replace('ACCURACY_PREFLIGHT_TOP_N=3', 'ACCURACY_PREFLIGHT_TOP_N=5')
p.write_text(text)

# Regression tests for the exact failure modes.
Path('src/tests/zeroResultRecovery.test.js').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPlan } from '../services/searchPlanner.js';
import { buildOpenSubtitlesRequest } from '../providers/openSubtitles.js';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

const definitions = {
  opensubtitles: {
    name: 'opensubtitles',
    configured: () => true,
    supports: { movie: true, series: true, hash: true, reference: true },
  },
};

test('metadata and fallback plans do not over-constrain providers with title plus IDs', () => {
  const plan = createSearchPlan({
    type: 'movie',
    imdbId: 'tt11561116',
    tmdbId: 123,
    title: 'The Whisper Man',
    filename: 'The.Whisper.Man.2026.2160p.WEB-DL.mkv',
    aliases: ['Whisper Man'],
  }, definitions, ['opensubtitles'], { includeHash: false });

  const exact = plan.find(stage => stage.name === 'exact-metadata').variants[0];
  assert.equal(exact.query, '');
  assert.equal(exact.filename, '');
  assert.equal(exact.imdbId, 'tt11561116');

  const release = plan.find(stage => stage.name === 'release-fallback').variants[0];
  assert.equal(release.imdbId, null);
  assert.equal(release.tmdbId, null);
  assert.match(release.query, /Whisper\.Man/);

  const title = plan.find(stage => stage.name === 'title-fallback').variants[0];
  assert.equal(title.imdbId, null);
  assert.equal(title.tmdbId, null);
  assert.equal(title.query, 'The Whisper Man');

  const alias = plan.find(stage => stage.name === 'alias-fallback').variants[0];
  assert.equal(alias.query, 'Whisper Man');
});

test('OpenSubtitles recovery includes hearing-impaired results only for relaxed fallback', () => {
  const strict = new URL(buildOpenSubtitlesRequest({ type: 'movie', language: 'ar', imdbId: 'tt11561116' }).url);
  const relaxed = new URL(buildOpenSubtitlesRequest({ type: 'movie', language: 'ar', imdbId: 'tt11561116', relaxedFallback: true }).url);
  assert.equal(strict.searchParams.get('hearing_impaired'), 'exclude');
  assert.equal(relaxed.searchParams.get('hearing_impaired'), 'include');
});

test('measured preflight quality participates in final ordering', async () => {
  const results = [
    { provider: 'subdl', id: 'a', providerId: 'a', lang: 'ar', releaseName: 'Movie.2026.WEB-DL', download: 'https://example.com/a.srt', score: 500 },
    { provider: 'subdl', id: 'b', providerId: 'b', lang: 'ar', releaseName: 'Movie.2026.WEB-DL', download: 'https://example.com/b.srt', score: 500 },
  ];
  const outcomes = new Map([
    ['https://example.com/a.srt', { quality: { valid: true, score: 45, reasons: [] }, encoding: 'utf-8', format: 'srt' }],
    ['https://example.com/b.srt', { quality: { valid: true, score: 96, reasons: [] }, encoding: 'utf-8', format: 'srt' }],
  ]);
  const ranked = await applyAccuracyPreflight(results, { filename: 'Movie.2026.WEB-DL.mkv' }, {
    preflightImpl: async item => outcomes.get(item.download),
    cacheGetImpl: async () => null,
    cacheSetImpl: async () => {},
  });
  assert.equal(ranked[0].id, 'b');
  assert.equal(ranked[0].quality.score, 96);
});
''')

# Changelog / README concise release notes.
p = Path('CHANGELOG.md')
text = p.read_text()
entry = """## 4.1.0 - 2026-09-06\n\n- Eliminate avoidable empty subtitle lists with deterministic strict-to-relaxed Arabic recovery.\n- Stop over-constraining provider queries by separating ID-only, release-only, title-only, and alias search shapes.\n- Allow OpenSubtitles HI/SDH candidates only when strict search returns nothing; machine translations remain excluded.\n- Feed measured Accuracy Preflight content quality back into final ordering and inspect the top five candidates by default.\n- Preserve hard season, episode, year, and edition conflict rejection during recovery.\n\n"""
if '## 4.1.0 - 2026-09-06' not in text:
    p.write_text(entry + text)

p = Path('README.md')
text = p.read_text()
if '### v4.1.0' not in text:
    text += """\n\n### v4.1.0\n\nZero-result recovery now separates strong-ID and fallback searches, performs a safe Arabic relaxed tier only when strict search is empty, keeps machine translations excluded, rejects hard identity conflicts, and uses measured content quality from the top five preflight candidates in final ordering.\n"""
p.write_text(text)
