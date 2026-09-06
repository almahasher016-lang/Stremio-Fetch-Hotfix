from pathlib import Path
import json

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# Shared source-family classifier. WEB is checked before generic REMUX so WEB.Remux cannot become BluRay.
timing = r'''function lower(value) {
  return String(value || '').toLowerCase();
}

function normalizeReleaseText(value) {
  return lower(value)
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sourceFamily(value) {
  const text = normalizeReleaseText(value);
  if (!text) return '';

  // WEB-derived remux/mux tags must win over the generic scene REMUX fallback.
  if (
    /\bweb\s*(?:dl\s*rip|dlrip|dl|rip|mux|remux)?\b/u.test(text)
    || /\b(?:webdl|webrip|webmux|webremux)\b/u.test(text)
  ) return 'web';

  if (
    /\b(?:blu\s*ray|bluray|bd\s*rip|bdrip|br\s*rip|brrip|bd\s*remux|bdremux|bdmv|uhd\s*blu\s*ray)\b/u.test(text)
  ) return 'bluray';

  // Bare REMUX in scene-style names is overwhelmingly BluRay/UHD-BluRay derived.
  if (/\bremux\b/u.test(text)) return 'bluray';
  if (/\bhdtv\b/u.test(text)) return 'hdtv';
  if (/\b(?:dvd\s*rip|dvdrip|dvd)\b/u.test(text)) return 'dvd';
  if (/\b(?:hdcam|cam|telesync|telecine)\b/u.test(text)) return 'cam';
  return '';
}

export function sameSourceFamily(left, right) {
  const a = sourceFamily(left);
  const b = sourceFamily(right);
  return Boolean(a && b && a === b);
}
'''
write('src/utils/timingCompatibility.js', timing)

# accuracyFirst: shared family parser + exact-video-hash reference evidence before filename-family heuristic.
path = 'src/utils/accuracyFirst.js'
text = read(path)
text = replace_once(text,
"function lower(value) {\n  return String(value || '').toLowerCase();\n}\n",
"import { sourceFamily } from './timingCompatibility.js';\n\nfunction lower(value) {\n  return String(value || '').toLowerCase();\n}\n",
'accuracy import')
old_family = r'''function sourceFamily(value) {
  const text = lower(value).replace(/[._-]+/g, ' ');
  if (/\b(?:blu ray|brrip|bdrip|remux)\b/u.test(text)) return 'bluray';
  if (/\b(?:web dl|web rip|web)\b/u.test(text)) return 'web';
  if (/\bhdtv\b/u.test(text)) return 'hdtv';
  if (/\b(?:dvd rip|dvdrip|dvd)\b/u.test(text)) return 'dvd';
  if (/\b(?:hdcam|cam|telesync|telecine)\b/u.test(text)) return 'cam';
  return '';
}

'''
text = replace_once(text, old_family, '', 'remove local source family')
anchor = r'''function sourceFamilyRank(item, targetFamily) {
  if (!targetFamily) return 0;
  const candidateFamily = sourceFamily(releaseText(item));
  if (!candidateFamily) return 1;
  return candidateFamily === targetFamily ? 2 : 0;
}
'''
replacement = anchor + r'''
function timingReferenceRank(item) {
  const evidence = item?.timingReferenceEvidence;
  if (!evidence?.exactVideoHash) return 0;
  const score = Number(evidence.matchScore || 0);
  return Math.max(0, Math.min(10_000, Number.isFinite(score) ? score : 0));
}
'''
text = replace_once(text, anchor, replacement, 'timing reference rank')
old_compare = r'''    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    const familyDelta = sourceFamilyRank(b, targetFamily) - sourceFamilyRank(a, targetFamily);
'''
new_compare = r'''    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    // An English subtitle returned for the exact video hash describes the actual playback
    // timeline more reliably than a filename-derived source-family guess.
    const referenceDelta = timingReferenceRank(b) - timingReferenceRank(a);
    if (referenceDelta) return referenceDelta;

    const familyDelta = sourceFamilyRank(b, targetFamily) - sourceFamilyRank(a, targetFamily);
'''
text = replace_once(text, old_compare, new_compare, 'reference comparator')
text += r'''

export function prioritizeAndLimitAccurateSubtitles(results = [], search = {}, limit = Infinity) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit)) return ranked;
  return ranked.slice(0, Math.max(0, Math.floor(safeLimit)));
}
'''
write(path, text)

# Exact hash stage must not AND the strongest identity with weaker filename/metadata fields.
path = 'src/services/searchPlanner.js'
text = read(path)
old = "variants: [variant('exact-hash', identity, { query: identity.filename || identity.title || identity.query })],"
new = """variants: [variant('exact-hash', identity, {
          query: '',
          title: '',
          filename: '',
          imdbId: null,
          tmdbId: null,
          year: null,
        })],"""
text = replace_once(text, old, new, 'hash-only search variant')
write(path, text)

# Core ranking/reference changes.
path = 'src/services/subtitleServiceCore.js'
text = read(path)
text = replace_once(text,
"import { parseRelease, tokenOverlapScore } from '../utils/releaseParser.js';\n",
"import { parseRelease, tokenOverlapScore } from '../utils/releaseParser.js';\nimport { prioritizeAndLimitAccurateSubtitles } from '../utils/accuracyFirst.js';\nimport { sourceFamily } from '../utils/timingCompatibility.js';\n",
'core imports')
old_rank = r'''async function rankArabic(items, search, { relaxed = false } = {}) {
  const allowed = await filterRejected(search, items);
  const ranked = rankAndFilter(allowed, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore: relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore,
  });
  const safe = relaxed
    ? ranked.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))
    : ranked;
  return safe.slice(0, config.providers.topN).map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));
}
'''
new_rank = r'''async function rankArabic(items, search, { relaxed = false, limit = true } = {}) {
  const allowed = await filterRejected(search, items);
  const ranked = rankAndFilter(allowed, search, {
    outputArabicOnly: config.providers.outputArabicOnly,
    excludeHearingImpaired: relaxed ? false : config.providers.excludeHearingImpaired,
    excludeMachineTranslated: config.providers.excludeMachineTranslated,
    strictQualityFilters: relaxed ? false : config.providers.strictQualityFilters,
    maxReturnedPerRelease: config.ranking.maxReturnedPerRelease,
    minRankScore: relaxed ? config.resolver.recoveryMinRankScore : config.ranking.minRankScore,
  });
  const safe = relaxed
    ? ranked.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))
    : ranked;

  // Accuracy-first must see the entire plausible pool before TOP_N is applied. Cutting on
  // raw score first can permanently discard the subtitle whose timing family is correct.
  const prioritized = prioritizeAndLimitAccurateSubtitles(
    safe,
    search,
    limit ? config.providers.topN : Infinity,
  );
  return prioritized.map(item => (relaxed ? { ...item, recoveryTier: 'relaxed-arabic' } : item));
}
'''
text = replace_once(text, old_rank, new_rank, 'rank Arabic before limit')

start = text.index('function referenceCompatibility(')
end = text.index('\nfunction rankReferenceResults', start)
new_ref_compat = r'''function referenceCompatibility(arabic, reference, search) {
  const arabicRelease = arabic.parsedRelease || parseRelease(arabic.releaseName || arabic.fileName || arabic.name || '');
  const referenceRelease = reference.parsedRelease || parseRelease(reference.releaseName || reference.fileName || reference.name || '');
  let score = 0;

  if (search.videoHash && exactHashMatch(reference, search)) score += 900;
  if (arabic.imdbId && reference.imdbId && lower(arabic.imdbId) === lower(reference.imdbId)) score += 220;
  if (arabic.tmdbId && reference.tmdbId && String(arabic.tmdbId) === String(reference.tmdbId)) score += 140;
  if (arabic.season && reference.season && Number(arabic.season) === Number(reference.season)) score += 220;
  if (arabic.episode && reference.episode && Number(arabic.episode) === Number(reference.episode)) score += 280;

  const overlap = tokenOverlapScore(arabicRelease.tokens, referenceRelease.tokens);
  score += Math.round(overlap * 260);

  const arabicFamily = sourceFamily(arabicRelease.raw);
  const referenceFamily = sourceFamily(referenceRelease.raw);
  if (arabicFamily && referenceFamily) score += arabicFamily === referenceFamily ? 420 : -360;

  if (arabicRelease.source && referenceRelease.source && arabicRelease.source === referenceRelease.source) score += 80;
  if (arabicRelease.releaseGroup && referenceRelease.releaseGroup) {
    score += arabicRelease.releaseGroup === referenceRelease.releaseGroup ? 180 : 0;
  }
  if (arabicRelease.quality && referenceRelease.quality && arabicRelease.quality === referenceRelease.quality) score += 45;

  if (arabicRelease.service && referenceRelease.service) {
    score += arabicRelease.service === referenceRelease.service ? 140 : -90;
  }
  if (arabicRelease.edition && referenceRelease.edition) {
    score += arabicRelease.edition === referenceRelease.edition ? 220 : -480;
  }
  if (arabicRelease.fps && referenceRelease.fps) {
    score += Math.abs(arabicRelease.fps - referenceRelease.fps) <= 0.02 ? 220 : -480;
  }
  return score;
}
'''
text = text[:start] + new_ref_compat + text[end:]

start = text.index('async function attachReferenceCandidates(')
end = text.index('\nexport function mergeResults', start)
new_attach = r'''async function attachReferenceCandidates(arabicResults, search) {
  const autoSyncEnabled = Boolean(config.ranking.enableReferenceAutoSync && config.referenceSync.enabled);
  const exactHashEvidenceEnabled = Boolean(
    search.videoHash && providerAvailable('opensubtitles', 'en', search.type),
  );
  if ((!autoSyncEnabled && !exactHashEvidenceEnabled) || !arabicResults.length) return arabicResults;

  // Reference lookup must always be anchored to the actual video identity. Using an Arabic
  // candidate's release name here creates circular confirmation bias when that candidate is wrong.
  const referenceSearch = buildVideoIdentity({
    ...search,
    filename: search.filename || '',
    query: search.title || search.query,
  });
  const plan = createSearchPlan(referenceSearch, providerDefinitions, config.providers.enabled, {
    language: config.ranking.referenceLanguage || 'en',
    maxProvidersPerStage: config.resolver.maxReferenceProviders,
    references: true,
  });

  const raw = [];
  const exactHashStage = plan.find(stage => stage.name === 'exact-hash');
  if (exactHashEvidenceEnabled && exactHashStage) {
    raw.push(...await runStage(exactHashStage, referenceSearch, config.ranking.referenceLanguage || 'en'));
  }

  let references = rankReferenceResults(raw, referenceSearch);
  const exactReferences = references.filter(reference => exactHashMatch(reference, referenceSearch));

  // Generic reference auto-sync remains opt-in. If enabled and hash lookup did not produce a
  // reference, fall back to metadata/release searches based on the actual video filename.
  if (autoSyncEnabled && !references.length) {
    for (const stage of plan.filter(stage => stage.name !== 'exact-hash').slice(0, 2)) {
      raw.push(...await runStage(stage, referenceSearch, config.ranking.referenceLanguage || 'en'));
      if (raw.length) break;
    }
    references = rankReferenceResults(raw, referenceSearch);
  }

  const timingReferences = exactReferences.length ? exactReferences : (autoSyncEnabled ? references : []);
  if (!timingReferences.length) return arabicResults;

  return arabicResults.map(item => {
    if (item.provider === 'registry' || item.provider === 'vault') return item;
    const candidates = timingReferences
      .map(reference => ({ reference, matchScore: referenceCompatibility(item, reference, search) }))
      .sort((left, right) => right.matchScore - left.matchScore);
    const best = candidates[0];
    if (!best) return item;

    let output = item;
    if (exactHashMatch(best.reference, referenceSearch)) {
      output = {
        ...output,
        timingReferenceEvidence: {
          provider: best.reference.provider,
          providerId: best.reference.providerId || best.reference.id || null,
          releaseName: best.reference.releaseName || best.reference.fileName || best.reference.name || '',
          matchScore: best.matchScore,
          exactVideoHash: true,
        },
      };
    }

    if (autoSyncEnabled && best.matchScore >= config.referenceSync.minReferenceMatchScore) {
      output = {
        ...output,
        referenceSubtitle: best.reference,
        referenceMatchScore: best.matchScore,
      };
    }
    return output;
  });
}
'''
text = text[:start] + new_attach + text[end:]

text = replace_once(text,
"  let ranked = await rankArabic(raw, search);\n",
"  let ranked = await rankArabic(raw, search, { limit: false });\n",
'full candidate pool strict')
text = replace_once(text,
"    ranked = await rankArabic(raw, search, { relaxed: true });\n",
"    ranked = await rankArabic(raw, search, { relaxed: true, limit: false });\n",
'full candidate pool relaxed')
text = replace_once(text,
"      ranked = await rankArabic(mergeResults(raw, recoveryRaw), search, { relaxed: true });\n",
"      ranked = await rankArabic(mergeResults(raw, recoveryRaw), search, { relaxed: true, limit: false });\n",
'full recovery pool')
write(path, text)

# Final LKG is availability fallback, not an authority that freezes a merely acceptable ranking.
path = 'src/services/subtitleService.js'
text = read(path)
old = r'''  const lkg = await readAvailabilityLkg(search);
  // Exact hash/release LKG is safe to serve while fresh. A catalog-only LKG is fallback-only
  // because a different release of the same movie/episode may need better timing alignment.
  if (lkg?.kind !== 'catalog' && lkg?.hit && !lkg.stale) return lkg.value;

  const key = singleflightKey(search);
'''
new = r'''  const lkg = await readAvailabilityLkg(search);
  // Final LKG exists to preserve Arabic availability when providers fail. It must not short-circuit
  // normal ranking, otherwise an older merely-acceptable list can hide a newly available exact or
  // timing-compatible subtitle. The version-scoped search cache remains the normal fast path.

  const key = singleflightKey(search);
'''
text = replace_once(text, old, new, 'LKG fallback-only')
write(path, text)

# Search ranking should refresh often enough to discover better releases while LKG stays long-lived fallback.
path = 'src/configCore.js'
text = read(path)
text = replace_once(text,
"searchTtlSeconds: toInt(get('SEARCH_CACHE_TTL'), 3600, 30, 86400),",
"searchTtlSeconds: toInt(get('SEARCH_CACHE_TTL'), 900, 30, 86400),",
'search cache ttl')
write(path, text)

# Explain passive exact-hash reference evidence.
path = 'src/utils/explainRanking.js'
text = read(path)
text = replace_once(text,
"  if (scoreReasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) labels.push('provider-confirmed-hash');\n",
"  if (scoreReasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) labels.push('provider-confirmed-hash');\n  if (item.timingReferenceEvidence?.exactVideoHash) labels.push('exact-hash-timing-reference');\n",
'explain label')
text = replace_once(text,
"        contentPreflight: item.accuracyPreflight || null,\n        quality,\n",
"        contentPreflight: item.accuracyPreflight || null,\n        timingReference: item.timingReferenceEvidence || null,\n        quality,\n",
'explain evidence')
write(path, text)

# Release bump.
path = 'src/release.js'
text = read(path).replace("RELEASE_VERSION = '4.3.0'", "RELEASE_VERSION = '4.4.0'", 1)
write(path, text)

for filename in ['package.json', 'package-lock.json']:
    p = ROOT / filename
    data = json.loads(p.read_text(encoding='utf-8'))
    data['version'] = '4.4.0'
    if filename == 'package-lock.json' and isinstance(data.get('packages'), dict) and '' in data['packages']:
        data['packages']['']['version'] = '4.4.0'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Tests for family parsing and ordering evidence.
timing_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFamily } from '../utils/timingCompatibility.js';

test('sourceFamily keeps WEB Remux in the WEB timing family', () => {
  assert.equal(sourceFamily('Movie.2026.2160p.AMZN.WEB.Remux.HEVC-GRP.mkv'), 'web');
  assert.equal(sourceFamily('Movie.2026.1080p.WEBMux-GRP.mkv'), 'web');
});

test('sourceFamily recognizes BluRay remux aliases', () => {
  assert.equal(sourceFamily('Movie.2026.2160p.BDRemux.DV.HDR-GRP.mkv'), 'bluray');
  assert.equal(sourceFamily('Movie.2026.1080p.BDMV-GRP.mkv'), 'bluray');
  assert.equal(sourceFamily('Movie.2026.2160p.BluRay.REMUX-GRP.mkv'), 'bluray');
});
'''
write('src/tests/timingCompatibility.test.js', timing_test)

path = 'src/tests/accuracyFirst.test.js'
text = read(path)
text += r'''

test('accuracy-first keeps a low raw-score same-family candidate when limiting a large pool', async () => {
  const { prioritizeAndLimitAccurateSubtitles } = await import('../utils/accuracyFirst.js');
  const web = Array.from({ length: 11 }, (_, index) => ({
    provider: 'opensubtitles',
    id: `web-${index}`,
    releaseName: `Show.S01E07.2160p.WEB-DL-GRP${index}`,
    score: 2000 - index,
    releaseMatch: releaseMatch({ tier: 2, priority: 20000, mismatched: ['source'] }),
    scoreReasons: [],
  }));
  const bluray = {
    provider: 'subdl',
    id: 'bluray-correct',
    releaseName: 'Show.S01E07.720p.BluRay.x264-BLOODY',
    score: 300,
    releaseMatch: releaseMatch({ tier: 1, priority: 9000, mismatched: ['quality', 'releaseGroup'] }),
    scoreReasons: [],
  };
  const ranked = prioritizeAndLimitAccurateSubtitles(
    [...web, bluray],
    { filename: 'Show.S01E07.2160p.BluRay.REMUX-GRP.mkv' },
    10,
  );
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].id, 'bluray-correct');
});

test('exact-hash timing reference outranks filename family when there are no hard conflicts', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      id: 'filename-family',
      provider: 'subdl',
      releaseName: 'Movie.2026.1080p.BluRay-GRP',
      score: 1200,
      releaseMatch: releaseMatch({ tier: 3, priority: 30000 }),
      timingReferenceEvidence: { exactVideoHash: true, matchScore: 700 },
      scoreReasons: [],
    },
    {
      id: 'hash-reference-family',
      provider: 'opensubtitles',
      releaseName: 'Movie.2026.1080p.WEB-DL-GRP',
      score: 800,
      releaseMatch: releaseMatch({ tier: 2, priority: 22000 }),
      timingReferenceEvidence: { exactVideoHash: true, matchScore: 1500 },
      scoreReasons: [],
    },
  ], { filename: 'Movie.2026.2160p.BluRay.REMUX-GRP.mkv' });
  assert.equal(ranked[0].id, 'hash-reference-family');
});

test('hard episode conflicts still beat exact-hash timing-reference similarity', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      id: 'wrong-episode',
      provider: 'opensubtitles',
      releaseName: 'Show.S01E08.1080p.WEB-DL-GRP',
      score: 2000,
      releaseMatch: releaseMatch({ tier: 1, priority: 10000, criticalMismatches: 1, mismatched: ['episode'] }),
      timingReferenceEvidence: { exactVideoHash: true, matchScore: 3000 },
      scoreReasons: [],
    },
    {
      id: 'right-episode',
      provider: 'subdl',
      releaseName: 'Show.S01E07.1080p.BluRay-GRP',
      score: 500,
      releaseMatch: releaseMatch({ tier: 2, priority: 20000, mismatched: [] }),
      timingReferenceEvidence: { exactVideoHash: true, matchScore: 500 },
      scoreReasons: [],
    },
  ], { filename: 'Show.S01E07.1080p.BluRay-GRP.mkv' });
  assert.equal(ranked[0].id, 'right-episode');
});
'''
write(path, text)

path = 'src/tests/searchPlanner.test.js'
text = read(path)
text += r'''

test('exact-hash stage uses hash identity without weaker filename or metadata constraints', () => {
  const plan = createSearchPlan({
    type: 'series',
    id: 'tt11198330:1:7',
    imdbId: 'tt11198330',
    season: 1,
    episode: 7,
    videoHash: 'f6bdfb5e54ea25bf',
    videoSize: 27228198074,
    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.Remux.mkv',
  }, providers, Object.keys(providers));
  const item = plan.find(stage => stage.name === 'exact-hash').variants[0];
  assert.equal(item.videoHash, 'f6bdfb5e54ea25bf');
  assert.equal(item.videoSize, 27228198074);
  assert.equal(item.query, '');
  assert.equal(item.filename, '');
  assert.equal(item.imdbId, null);
  assert.equal(item.tmdbId, null);
});
'''
write(path, text)

# README and changelog.
path = 'README.md'
text = read(path)
text = replace_once(text, '# m7md Arabic Resolver v4.3.0', '# m7md Arabic Resolver v4.4.0', 'README title')
marker = '## ما الجديد في 4.0.0\n'
notes = '''## ما الجديد في 4.4.0\n\n- تطبيق Accuracy-First على كامل مجموعة المرشحين قبل قص `TOP_N` حتى لا تختفي ترجمة متوافقة زمنيًا بسبب Score أولي أقل.\n- جعل مرحلة exact-hash تعتمد على `videoHash + videoSize` دون خلطها مع filename/IMDb/TMDB الأضعف.\n- إضافة Exact-Hash English Timing Reference كدليل ترتيب سلبي/آمن عند توفره، دون تشغيل مزامنة زمنية تلقائية عامة.\n- إزالة الانحياز الدائري من Reference lookup: المرجع يُبحث بهوية ملف الفيديو الحقيقي لا باسم ترجمة عربية مرشحة.\n- توسيع Source Family لتمييز `WEB.Remux/WEBMux` عن `BDRemux/BDMV/BluRay REMUX`.\n- تحويل Final Arabic LKG إلى fallback للتوافر فقط بدل أن يجمد ترتيبًا أقدم، وخفض Search cache الافتراضي إلى 15 دقيقة لاكتشاف ترجمات أفضل أسرع.\n\n'''
if '## ما الجديد في 4.4.0' not in text:
    text = replace_once(text, marker, notes + marker, 'README notes')
write(path, text)

path = 'CHANGELOG.md'
text = read(path)
entry = '''## 4.4.0 - 2026-09-06\n\n- Apply timing accuracy ordering to the full plausible candidate pool before TOP_N truncation.\n- Make exact-hash provider searches hash/size authoritative instead of ANDing weaker filename and metadata constraints.\n- Add passive exact-video-hash English timing-reference evidence for ranking without enabling generic auto-sync.\n- Anchor reference lookup to the actual video identity and remove candidate-seeded circular confirmation bias.\n- Harden source-family parsing for WEB Remux/WEBMux and BDRemux/BDMV/BluRay aliases.\n- Keep final Arabic LKG as availability fallback rather than a fresh-ranking authority and shorten the default search-cache TTL.\n\n'''
if not text.startswith('## 4.4.0'):
    text = entry + text
write(path, text)

print('v4.4.0 patch applied')
