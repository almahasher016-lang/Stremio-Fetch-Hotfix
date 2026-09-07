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

# Version bump without touching dependency versions.
pkg = json.loads(read('package.json'))
pkg['version'] = '4.5.0'
write('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
lock = json.loads(read('package-lock.json'))
lock['version'] = '4.5.0'
if isinstance(lock.get('packages', {}).get(''), dict):
    lock['packages']['']['version'] = '4.5.0'
write('package-lock.json', json.dumps(lock, ensure_ascii=False, indent=2) + '\n')

p = 'src/release.js'
s = read(p)
s = replace_once(s, "export const RELEASE_VERSION = '4.4.2';", "export const RELEASE_VERSION = '4.5.0';", 'release version')
write(p, s)

# 1) Hard identity gate: explicit wrong movie/year/episode/edition never reaches the user
# unless the candidate itself has exact-hash evidence.
p = 'src/services/subtitleServiceCore.js'
s = read(p)
s = replace_once(
    s,
    "const RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition', 'fps']);\n",
    "const IDENTITY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition']);\nconst RECOVERY_HARD_CONFLICTS = new Set(['season', 'episode', 'year', 'edition', 'fps']);\n\nexport function hasHardIdentityConflict(item, search = {}) {\n  const exactSource = item?.sourceType === 'personal-vault-exact-hash'\n    || item?.sourceType === 'version-registry-exact-hash'\n    || exactHashMatch(item, search);\n  if (exactSource) return false;\n  const mismatched = Array.isArray(item?.releaseMatch?.mismatched) ? item.releaseMatch.mismatched : [];\n  return mismatched.some(field => IDENTITY_HARD_CONFLICTS.has(field));\n}\n",
    'identity hard gate helper',
)
s = replace_once(
    s,
    "  const safe = relaxed\n    ? ranked.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))\n    : ranked;\n",
    "  const identitySafe = ranked.filter(item => !hasHardIdentityConflict(item, search));\n  const safe = relaxed\n    ? identitySafe.filter(item => !(item.releaseMatch?.mismatched || []).some(field => RECOVERY_HARD_CONFLICTS.has(field)))\n    : identitySafe;\n",
    'apply identity hard gate',
)

# 2) Exact-video-hash English references are stable timeline evidence, not merely metadata hints.
old = """    if (exactHashMatch(best.reference, referenceSearch)) {\n      output = {\n        ...output,\n        timingReferenceEvidence: {\n          provider: best.reference.provider,\n          providerId: best.reference.providerId || best.reference.id || null,\n          releaseName: best.reference.releaseName || best.reference.fileName || best.reference.name || '',\n          matchScore: best.matchScore,\n          exactVideoHash: true,\n        },\n      };\n    }\n\n    if (autoSyncEnabled && best.matchScore >= config.referenceSync.minReferenceMatchScore) {\n      output = {\n        ...output,\n        referenceSubtitle: best.reference,\n        referenceMatchScore: best.matchScore,\n      };\n    }\n"""
new = """    if (exactHashMatch(best.reference, referenceSearch)) {\n      output = {\n        ...output,\n        timingReferenceEvidence: {\n          provider: best.reference.provider,\n          providerId: best.reference.providerId || best.reference.id || null,\n          releaseName: best.reference.releaseName || best.reference.fileName || best.reference.name || '',\n          matchScore: best.matchScore,\n          exactVideoHash: true,\n        },\n        // Exact-hash references describe the actual playback timeline. They are safe to attach\n        // even when generic experimental Reference Sync is disabled; delivery still applies a\n        // strict structural confidence gate before changing a single timestamp.\n        referenceSubtitle: best.reference,\n        referenceMatchScore: best.matchScore,\n        referenceSyncMode: 'exact-hash-stable',\n      };\n    }\n\n    if (!output.referenceSubtitle && autoSyncEnabled && best.matchScore >= config.referenceSync.minReferenceMatchScore) {\n      output = {\n        ...output,\n        referenceSubtitle: best.reference,\n        referenceMatchScore: best.matchScore,\n        referenceSyncMode: 'generic-experimental',\n      };\n    }\n"""
s = replace_once(s, old, new, 'attach exact hash reference')
write(p, s)

# 3) Ambiguous remake titles search by title+year in strict mode; bare-title stays recovery-only.
p = 'src/services/searchPlanner.js'
s = read(p)
s = replace_once(
    s,
    "  if (identity.title || identity.query) {\n    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);\n",
    "  if (identity.title || identity.query) {\n    const providers = configuredProviders(providerDefinitions, enabledNames, language, identity.type, providerOptions);\n    const baseTitle = identity.title || identity.query;\n    const strictTitleQuery = identity.type === 'movie' && identity.year\n      ? `${baseTitle} ${identity.year}`\n      : baseTitle;\n",
    'qualified title declaration',
)
s = replace_once(
    s,
    "          query: identity.title || identity.query,\n",
    "          query: relaxed ? baseTitle : strictTitleQuery,\n",
    'qualified title query',
)
s = replace_once(
    s,
    "          query: alias,\n          title: alias,\n",
    "          query: (!relaxed && identity.type === 'movie' && identity.year) ? `${alias} ${identity.year}` : alias,\n          title: alias,\n",
    'qualified alias query',
)
write(p, s)

# 4) Automatically feed exact-hash timeline references into normal Stremio options.
p = 'src/utils/stremio.js'
s = read(p)
s = replace_once(
    s,
    "function styledModeFormat(mode) {\n",
    "function stableReferenceForProxy(baseUrl, item) {\n  if (!item?.timingReferenceEvidence?.exactVideoHash || item?.referenceSyncMode !== 'exact-hash-stable') return null;\n  const reference = referenceForProxy(baseUrl, item);\n  return reference ? { ...reference, exactVideoHash: true } : null;\n}\n\nfunction styledModeFormat(mode) {\n",
    'stable reference helper',
)
s = replace_once(
    s,
    "  if (item.searchReason === 'hash-first' || item.movieHash) badges.push('🔑 Hash');\n",
    "  if (item.searchReason === 'hash-first' || item.movieHash) badges.push('🔑 Hash');\n  if (item.timingReferenceEvidence?.exactVideoHash) badges.push('🧭 Exact Timeline');\n",
    'timeline badge',
)
s = replace_once(
    s,
    "    const originalUrl = proxiedSubtitleUrl(baseUrl, item, null, null, search, rankedFallbacks);\n",
    "    const stableReference = stableReferenceForProxy(baseUrl, item);\n    const stableFallbacks = rankedFallbacks.map(candidate => ({\n      ...candidate,\n      reference: stableReferenceForProxy(baseUrl, candidate),\n    }));\n    const originalUrl = proxiedSubtitleUrl(baseUrl, item, null, stableReference, search, stableFallbacks);\n",
    'stable reference delivery',
)
write(p, s)

# 5) Stable exact-hash references use a stricter, deterministic DTW/piecewise proof gate.
p = 'src/utils/encodingProxy.js'
s = read(p)
s = replace_once(
    s,
    "      candidate: compactTokenCandidate(source.candidate),\n    };\n  }\n  if (source.kind === 'provider') {\n",
    "      candidate: compactTokenCandidate(source.candidate),\n      exactVideoHash: Boolean(source.exactVideoHash),\n    };\n  }\n  if (source.kind === 'provider') {\n",
    'vault exact hash token marker',
)
s = replace_once(
    s,
    "      candidate: compactTokenCandidate(source.candidate),\n    };\n  }\n  return {\n    kind: 'remote',\n",
    "      candidate: compactTokenCandidate(source.candidate),\n      exactVideoHash: Boolean(source.exactVideoHash),\n    };\n  }\n  return {\n    kind: 'remote',\n",
    'provider exact hash token marker',
)
s = replace_once(
    s,
    "    candidate: compactTokenCandidate(source.candidate),\n  };\n}\n\nfunction compactTokenFallback(fallback) {\n",
    "    candidate: compactTokenCandidate(source.candidate),\n    exactVideoHash: Boolean(source.exactVideoHash),\n  };\n}\n\nfunction compactTokenFallback(fallback) {\n",
    'remote exact hash token marker',
)
s = replace_once(
    s,
    "      const referencePlan = deriveReferenceSyncPlan(processed.text, referenceProcessed.text, config.referenceSync);\n",
    "      const referenceOptions = reference.exactVideoHash\n        ? {\n          ...config.referenceSync,\n          minConfidence: Math.max(92, Number(config.referenceSync.minConfidence || 0)),\n          minAnchorCoverage: Math.max(0.72, Number(config.referenceSync.minAnchorCoverage || 0)),\n          minTemporalAgreement: Math.max(0.84, Number(config.referenceSync.minTemporalAgreement || 0)),\n          dtwEnabled: true,\n          piecewise: true,\n          allowAggressiveStretch: false,\n        }\n        : config.referenceSync;\n      const referencePlan = deriveReferenceSyncPlan(processed.text, referenceProcessed.text, referenceOptions);\n",
    'strict exact hash timing proof',
)
s = replace_once(
    s,
    "    providerId: reference.providerId,\n    id: reference.id,\n    name: reference.name,\n    download: reference.url || reference.download,\n  });\n",
    "    providerId: reference.providerId,\n    id: reference.id,\n    name: reference.name,\n    download: reference.url || reference.download,\n    exactVideoHash: Boolean(reference.exactVideoHash),\n  });\n",
    'pass exact reference marker',
)
write(p, s)

# Tests: general invariants, not title-specific fixes.
p = 'src/tests/timingProofV450.test.js'
write(p, """import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createSearchPlan } from '../services/searchPlanner.js';\nimport { hasHardIdentityConflict } from '../services/subtitleServiceCore.js';\nimport { providerDefinitions } from '../providers/registry.js';\nimport { toStremioSubtitles } from '../utils/stremio.js';\nimport { verifyEncodingToken } from '../utils/encodingProxy.js';\n\ntest('strict movie title fallback includes year to disambiguate remakes', () => {\n  const plan = createSearchPlan({ type:'movie', title:'The Mummy', year:2026 }, providerDefinitions, ['opensubtitles'], { language:'ar' });\n  const stage = plan.find(item => item.name === 'title-fallback');\n  assert.equal(stage?.variants?.[0]?.query, 'The Mummy 2026');\n});\n\ntest('relaxed recovery may use bare title after strict year-qualified search', () => {\n  const plan = createSearchPlan({ type:'movie', title:'The Mummy', year:2026 }, providerDefinitions, ['opensubtitles'], { language:'ar', relaxed:true });\n  const stage = plan.find(item => item.name === 'title-fallback');\n  assert.equal(stage?.variants?.[0]?.query, 'The Mummy');\n});\n\ntest('explicit wrong year is a hard identity conflict unless exact hash proves the video', () => {\n  const search = { videoHash:'abc123' };\n  const wrong = { releaseMatch:{ mismatched:['year'] } };\n  assert.equal(hasHardIdentityConflict(wrong, search), true);\n  const exact = { ...wrong, movieHash:'abc123' };\n  assert.equal(hasHardIdentityConflict(exact, search), false);\n});\n\ntest('normal Stremio original option carries exact-hash timeline reference into encoding token', () => {\n  const result = {\n    id:'ar-1', provider:'opensubtitles', providerId:'123',\n    download:'/downloads/opensubtitles/123.srt', lang:'ara', score:1000,\n    timingReferenceEvidence:{ exactVideoHash:true, matchScore:900 },\n    referenceSyncMode:'exact-hash-stable',\n    referenceSubtitle:{\n      id:'en-1', provider:'opensubtitles', providerId:'456',\n      download:'/downloads/opensubtitles/456.srt', lang:'eng', releaseName:'Movie.2026.WEB-DL',\n    },\n  };\n  const [option] = toStremioSubtitles([result], 'https://example.test', { type:'movie', videoHash:'abc', filename:'Movie.2026.WEB-DL.mkv' });\n  assert.ok(option?.url?.includes('/assets/encoding/'));\n  const token = option.url.split('/assets/encoding/')[1].replace(/\\.srt$/, '');\n  const payload = verifyEncodingToken(token);\n  assert.equal(payload.reference?.exactVideoHash, true);\n});\n""")

# README / changelog.
p = 'README.md'
s = read(p)
s = replace_once(s, '# m7md Arabic Resolver v4.4.2', '# m7md Arabic Resolver v4.5.0', 'readme version')
section = """## ما الجديد في 4.5.0\n\n- **Hard Identity Gate**: أي تعارض صريح في السنة/الموسم/الحلقة/Edition يُرفض قبل الوصول للمستخدم، مع استثناء التطابق المؤكد بالـExact Hash.\n- البحث الصارم للعناوين المعاد استخدامها أصبح يضيف السنة (`Title + Year`) لمنع خلط نسخ أفلام مختلفة تحمل الاسم نفسه.\n- **Exact-Hash Timeline Sync** أصبح مسارًا مستقرًا: عندما يتوفر Reference إنجليزي لنفس بصمة الفيديو، يُمرر تلقائيًا للترجمة العربية العادية.\n- قبل تعديل أي توقيت، يُشترط Timing Proof صارم: DTW + Piecewise anchors، ثقة لا تقل عن 92، تغطية anchors لا تقل عن 72%، واتفاق زمني لا يقل عن 84%.\n- المراجع العامة المبنية على الاسم تبقى تجريبية ومغلقة افتراضيًا؛ المسار المستقر لا يعمل إلا مع Reference مطابق لبصمة الفيديو.\n- أضيفت اختبارات Regression عامة للعناوين المتكررة، تعارض السنة، وتمرير Exact Timeline Reference إلى Stremio.\n\n"""
marker = '## ما الجديد في 4.4.2\n'
if section not in s:
    if marker not in s:
        raise SystemExit('anchor not found: readme 4.4.2 section')
    s = s.replace(marker, section + marker, 1)
write(p, s)

p = 'CHANGELOG.md'
s = read(p)
entry = """## 4.5.0 - 2026-09-07\n\n- Add a hard identity gate for explicit year/season/episode/edition conflicts while preserving exact-hash authority.\n- Qualify strict movie title/alias fallback searches with the target year to prevent remake/title collisions.\n- Promote exact-video-hash English timeline references to a stable delivery path independent of generic experimental Reference Sync.\n- Automatically derive conservative DTW + piecewise timing correction for exact-hash references only, requiring >=92 confidence, >=0.72 anchor coverage, and >=0.84 temporal agreement.\n- Carry stable timing references through original Stremio options and fallback candidates while keeping generic metadata reference sync opt-in.\n- Add regression coverage for remake disambiguation, identity conflicts, and exact-hash timeline token delivery.\n\n"""
if not s.startswith('## 4.5.0'):
    s = entry + s
write(p, s)

print('v4.5.0 timing-proof changes applied')
