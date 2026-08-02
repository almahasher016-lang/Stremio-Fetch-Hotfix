from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, got {count}: {pattern[:120]!r}")
    write(path, updated)


write("src/utils/arabicBidi.js", r"""const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

function stripBidiControls(value) {
  return String(value ?? '').replace(BIDI_CONTROL_RE, '');
}

export function stabilizeArabicCueLine(line) {
  return stripBidiControls(line).trimEnd();
}

export function stabilizeArabicSrt(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(stabilizeArabicCueLine)
    .join('\n');
}
""")

regex_once(
    "src/utils/subtitleProcessor.js",
    r"const BIDI_CONTROL_RE = /\[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\]/g;\n"
    r"const LETTER_RE = /\\p\{L\}/u;\n"
    r"const ARABIC_SCRIPT_RE = /\\p\{Script_Extensions=Arabic\}/u;\n"
    r"const TERMINAL_NEUTRAL_RE = /\[\\p\{P\}\\p\{S\}\]\$/u;\n"
    r"const RIGHT_TO_LEFT_ISOLATE = '\\u2067';\n"
    r"const RIGHT_TO_LEFT_MARK = '\\u200F';\n"
    r"const POP_DIRECTIONAL_ISOLATE = '\\u2069';",
    r"const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;",
)
regex_once(
    "src/utils/subtitleProcessor.js",
    r"function arabicDominatesLine\(line\) \{.*?\n\}\n\nfunction isolateArabicLine\(line\) \{.*?\n\}\n\nfunction stripTags",
    """function isolateArabicLine(line) {
  return stripControlMarks(line).trimEnd();
}

function stripTags""",
    re.S,
)

replace_once("src/utils/encodingProxy.js", "return `encoding:v7:${sign(normalized)}`;", "return `encoding:v8:${sign(normalized)}`;")

regex_once(
    "src/utils/subtitleTiming.js",
    r"export function detectSyncPlan\(\{ subtitleRelease = \{\}, videoRelease = \{\}, extra = \{\} \} = \{\}\) \{.*?\n\}\n\nexport function applySyncPlan",
    r"""export function detectSyncPlan({ subtitleRelease = {}, videoRelease = {}, extra = {} } = {}) {
  const hints = [];
  const sourceFps = Number(subtitleRelease.fps || extra.subtitleFps || 0);
  const targetFps = Number(videoRelease.fps || extra.fps || extra.videoFps || 0);
  if (sourceFps && targetFps && Math.abs(sourceFps - targetFps) > 0.01) {
    hints.push(`fps-difference-unverified:${sourceFps}->${targetFps}`);
  }

  const rawOffset = extra.offsetMs ?? extra.subtitleOffsetMs;
  const offsetMs = Number(rawOffset);
  const hasExplicitOffset = rawOffset !== undefined
    && rawOffset !== null
    && String(rawOffset).trim() !== ''
    && Number.isFinite(offsetMs)
    && offsetMs !== 0;

  if (hasExplicitOffset) hints.push(`manual-offset:${offsetMs}`);

  return {
    enabled: hasExplicitOffset,
    ratio: 1,
    offsetMs: hasExplicitOffset ? offsetMs : 0,
    confidence: hasExplicitOffset ? 100 : 0,
    hints: hasExplicitOffset ? hints : [...hints, 'metadata-only-sync-disabled'],
    verified: hasExplicitOffset,
    method: hasExplicitOffset ? 'manual-offset' : 'none',
  };
}

export function applySyncPlan""",
    re.S,
)

replace_once("src/utils/stremio.js", "if (mode === 'reference') badges.push('⚡ RefSync');", "if (mode === 'reference') badges.push('🧪 Experimental RefSync');")
replace_once("src/utils/stremio.js", "if (mode === 'sync') badges.push('⏱ AutoSync');", "if (mode === 'sync') badges.push('⏱ Manual Timing');")
replace_once("src/utils/stremio.js", "if (mode === 'sync') parts.push('Auto Sync');", "if (mode === 'sync') parts.push('Manual Timing');")
replace_once("src/utils/stremio.js", "else if (mode === 'reference') parts.push('Reference Sync');", "else if (mode === 'reference') parts.push('Experimental Reference Sync');")

new_stremio_function = r"""function subtitleOptionId(item, mode, index) {
  const base = item.id || item.providerId || `subtitle-${index}`;
  return `${base}-${mode}-v${config.app.version}`;
}

export function toStremioSubtitles(results, baseUrl, search = {}) {
  const output = [];
  const videoRelease = parseRelease(search.filename || search.query || '');
  const eligible = [];

  for (const [index, item] of results.entries()) {
    const rankedFallbacks = [
      ...results.slice(index + 1),
      ...results.slice(0, index),
    ].filter(candidate => candidate?.download || candidate?.url);
    const originalUrl = proxiedSubtitleUrl(baseUrl, item, null, null, search, rankedFallbacks);
    if (!originalUrl) continue;
    eligible.push({ item, index, rankedFallbacks, originalUrl });
  }

  let originalCount = 0;
  for (const { item, index, originalUrl } of eligible) {
    if (
      originalCount >= config.ranking.maxOriginalOptions
      || output.length >= config.ranking.maxStremioSubtitles
    ) break;
    output.push({
      id: subtitleOptionId(item, 'orig', index),
      url: originalUrl,
      lang: 'ara',
      name: subtitleName(item, 'original'),
    });
    originalCount += 1;
  }

  let styledCount = 0;
  for (const { item, index } of eligible) {
    if (output.length >= config.ranking.maxStremioSubtitles || styledCount >= 2) break;
    const styledFormat = styledSubtitleFormatHint(item);
    if (!styledFormat) continue;
    const url = styledSubtitleUrl(baseUrl, item, search);
    if (!url) continue;
    output.push({
      id: subtitleOptionId(item, `styled-${styledFormat}`, index),
      url,
      lang: 'ara',
      name: subtitleName(item, `styled-${styledFormat}`),
    });
    styledCount += 1;
  }

  if (config.ranking.enableAutoSyncOption) {
    let autoSyncCount = 0;
    for (const { item, index, rankedFallbacks } of eligible) {
      if (
        output.length >= config.ranking.maxStremioSubtitles
        || autoSyncCount >= config.ranking.maxAutoSyncOptions
      ) break;
      const syncPlan = detectSyncPlan({
        subtitleRelease: item.parsedRelease || parseRelease(item.releaseName || item.fileName || item.name),
        videoRelease,
        extra: search.extra || {},
      });
      if (
        !syncPlan.enabled
        || !syncPlan.verified
        || syncPlan.confidence < config.ranking.autoSyncMinConfidence
      ) continue;
      const autoSyncFallbacks = rankedFallbacks
        .map(candidate => ({
          ...candidate,
          syncPlan: detectSyncPlan({
            subtitleRelease: candidate.parsedRelease || parseRelease(candidate.releaseName || candidate.fileName || candidate.name),
            videoRelease,
            extra: search.extra || {},
          }),
        }))
        .filter(candidate => candidate.syncPlan.enabled && candidate.syncPlan.verified);
      output.push({
        id: subtitleOptionId(item, 'manual-sync', index),
        url: proxiedSubtitleUrl(baseUrl, item, syncPlan, null, search, autoSyncFallbacks),
        lang: 'ara',
        name: subtitleName(item, 'sync'),
      });
      autoSyncCount += 1;
    }
  }

  if (config.ranking.enableReferenceAutoSync) {
    let referenceCount = 0;
    for (const { item, index, rankedFallbacks } of eligible) {
      if (
        output.length >= config.ranking.maxStremioSubtitles
        || referenceCount >= config.ranking.maxReferenceOptions
      ) break;
      const reference = referenceForProxy(baseUrl, item);
      if (!reference) continue;
      const referenceFallbacks = rankedFallbacks
        .map(candidate => ({ ...candidate, reference: referenceForProxy(baseUrl, candidate) }))
        .filter(candidate => candidate.reference);
      output.push({
        id: subtitleOptionId(item, 'experimental-refsync', index),
        url: proxiedSubtitleUrl(baseUrl, item, null, reference, search, referenceFallbacks),
        lang: 'ara',
        name: subtitleName(item, 'reference'),
      });
      referenceCount += 1;
    }
  }

  return output;
}"""

regex_once(
    "src/utils/stremio.js",
    r"export function toStremioSubtitles\(results, baseUrl, search = \{\}\) \{.*?\n\}\n\nexport function queryOptionsFromRequest",
    new_stremio_function + "\n\nexport function queryOptionsFromRequest",
    re.S,
)

replace_once(
    "src/services/subtitleServiceCore.js",
    """  let ranked = hashRanked;
  for (const stage of plan) {
    raw.push(...await runStage(stage, search, 'ar'));
    ranked = await rankArabic(raw, search);
    if (ranked.length >= config.providers.topN) break;
  }
  const withReferences = await attachReferenceCandidates(ranked, search);""",
    """  for (const stage of plan) {
    raw.push(...await runStage(stage, search, 'ar'));
  }
  const ranked = await rankArabic(raw, search);
  const withReferences = await attachReferenceCandidates(ranked, search);""",
)
replace_once(
    "src/providers/subdl.js",
    "      if (all.length) break;",
    "      if (all.length >= config.providers.maxProviderItems) break;",
)

replace_once(
    "src/configCore.js",
    "  const nodeEnv = get('NODE_ENV', 'development');",
    "  const nodeEnv = get('NODE_ENV', 'development');\n  const experimentalSyncAllowed = toBool(get('ALLOW_EXPERIMENTAL_SYNC'), false);",
)
replace_once(
    "src/configCore.js",
    "'Private Arabic-first Stremio subtitle resolver with exact-version matching, bounded downloads, Arabic quality validation, Personal Vault, and deterministic synchronization without AI.'",
    "'Arabic-first Stremio subtitle resolver with broad provider search, conservative text handling, quality validation, Personal Vault, and opt-in experimental synchronization without AI.'",
)
replacements = {
    "topN: toInt(get('TOP_N'), 5, 1, 20),": "topN: toInt(get('TOP_N'), 10, 1, 20),",
    "enableAutoSyncOption: toBool(get('ENABLE_AUTO_SYNC_OPTION'), true),": "enableAutoSyncOption: experimentalSyncAllowed && toBool(get('ENABLE_AUTO_SYNC_OPTION'), false),",
    "enableReferenceAutoSync: toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), true),": "enableReferenceAutoSync: experimentalSyncAllowed && toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), false),",
    "strictReleaseMatching: toBool(get('STRICT_RELEASE_MATCHING'), true),": "strictReleaseMatching: toBool(get('STRICT_RELEASE_MATCHING'), false),",
    "maxStremioSubtitles: toInt(get('STREMIO_MAX_SUBTITLES'), 6, 1, 20),": "maxStremioSubtitles: toInt(get('STREMIO_MAX_SUBTITLES'), 12, 1, 20),",
    "maxReferenceOptions: toInt(get('STREMIO_REFERENCE_TOP'), 2, 0, 10),": "maxReferenceOptions: toInt(get('STREMIO_REFERENCE_TOP'), 1, 0, 10),",
    "maxOriginalOptions: toInt(get('STREMIO_ORIGINAL_TOP'), 5, 0, 20),": "maxOriginalOptions: toInt(get('STREMIO_ORIGINAL_TOP'), 10, 0, 20),",
    "maxProvidersPerStage: toInt(get('RESOLVER_MAX_PROVIDERS_PER_STAGE'), 3, 1, 10),": "maxProvidersPerStage: toInt(get('RESOLVER_MAX_PROVIDERS_PER_STAGE'), 4, 1, 10),",
    "enabled: toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), true),": "enabled: experimentalSyncAllowed && toBool(get('ENABLE_REFERENCE_AUTO_SYNC'), false),",
    "minConfidence: toInt(get('REFERENCE_SYNC_MIN_CONFIDENCE'), 72, 0, 100),": "minConfidence: toInt(get('REFERENCE_SYNC_MIN_CONFIDENCE'), 88, 0, 100),",
    "minCues: toInt(get('REFERENCE_SYNC_MIN_CUES'), 8, 2, 100),": "minCues: toInt(get('REFERENCE_SYNC_MIN_CUES'), 24, 2, 100),",
    "minCueRatio: toNumber(get('REFERENCE_SYNC_MIN_CUE_RATIO'), 0.55, 0, 1),": "minCueRatio: toNumber(get('REFERENCE_SYNC_MIN_CUE_RATIO'), 0.75, 0, 1),",
    "piecewise: toBool(get('REFERENCE_SYNC_PIECEWISE'), true),": "piecewise: toBool(get('REFERENCE_SYNC_PIECEWISE'), false),",
    "minAnchorCoverage: toNumber(get('REFERENCE_SYNC_MIN_ANCHOR_COVERAGE'), 0.45, 0, 1),": "minAnchorCoverage: toNumber(get('REFERENCE_SYNC_MIN_ANCHOR_COVERAGE'), 0.70, 0, 1),",
    "minTemporalAgreement: toNumber(get('REFERENCE_SYNC_MIN_TEMPORAL_AGREEMENT'), 0.68, 0, 1),": "minTemporalAgreement: toNumber(get('REFERENCE_SYNC_MIN_TEMPORAL_AGREEMENT'), 0.82, 0, 1),",
    "dtwEnabled: toBool(get('REFERENCE_SYNC_DTW_ENABLED'), true),": "dtwEnabled: toBool(get('REFERENCE_SYNC_DTW_ENABLED'), false),",
    "maxFallbacks: toInt(get('ENCODING_PROXY_MAX_FALLBACKS'), 2, 0, 4),": "maxFallbacks: toInt(get('ENCODING_PROXY_MAX_FALLBACKS'), 4, 0, 8),",
}
for old, new in replacements.items():
    replace_once("src/configCore.js", old, new)

write("src/tests/arabicBidi.test.js", r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeArabicCueLine, stabilizeArabicSrt } from '../utils/arabicBidi.js';

const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

test('preserves Arabic punctuation, brackets, quotes, and ellipsis exactly', () => {
  const cases = [
    'مرحبا بالعالم.',
    '(مرحبا بالعالم.)',
    '[هل أنت بخير؟]',
    '{انتبه!}',
    '«هذا صحيح، أليس كذلك؟»',
    '— مرحبا...',
    'هل شاهدت (WEB-DL 1080p)؟',
  ];
  for (const source of cases) {
    assert.equal(stabilizeArabicCueLine(source), source);
  }
});

test('removes upstream bidi controls without moving visible characters', () => {
  const source = '\u200F\u2067\u200F(مرحبا.)\u200F\u2069\u200F';
  assert.equal(stabilizeArabicCueLine(source), '(مرحبا.)');
});

test('is exactly idempotent and leaves no hidden direction controls', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(مرحبا.)\u200F\u2069\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.equal(once, '1\n00:00:01,000 --> 00:00:02,000\n(مرحبا.)\n');
  assert.doesNotMatch(once, BIDI_CONTROL_RE);
});

test('does not alter indexes, timings, numeric dialogue, or mixed Latin lines', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
""")

processor_tests = read("src/tests/subtitleProcessor.test.js")
processor_tests = processor_tests.replace(
    r"assert.match(result.text, /\u2067مرحبا\u2069\n\u2067بك\u2069/);",
    r"assert.match(result.text, /مرحبا\nبك/);"
)
processor_tests = processor_tests.replace(
    r"assert.match(result.text, /\u2067مرحبا بالعالم\.\u200F\u2069/);",
    r"assert.match(result.text, /مرحبا بالعالم\./);"
)
processor_tests = processor_tests.replace(
    r"assert.match(result.text, /\u2067هل أنت بخير؟\u200F\u2069/);",
    r"assert.match(result.text, /هل أنت بخير؟/);"
)
processor_tests = processor_tests.replace(
    r"assert.match(result.text, /\u2067انتبه!\u200F\u2069/);",
    r"assert.match(result.text, /انتبه!/);"
)
processor_tests = processor_tests.replace(
    r"assert.match(result.text, /\u2067الإصدار WEB-DL 3\.4\.0\.\u200F\u2069/);",
    r"assert.match(result.text, /الإصدار WEB-DL 3\.4\.0\./);"
)
processor_tests = processor_tests.replace(
    r"assert.match(once, /\u2067مرحبا!\u200F\u2069/);",
    r"assert.match(once, /مرحبا!/);"
)
processor_tests = processor_tests.replace(
    r"assert.match(once, /\u2067مرحبا!\u200F\u2069/u);",
    r"assert.match(once, /مرحبا!/u);"
)
if "preserves paired punctuation without injecting bidi controls" not in processor_tests:
    processor_tests += r"""

test('processSubtitleBuffer preserves paired punctuation without injecting bidi controls', () => {
  const visible = '— (هل شاهدت [Euphoria]؟) «نعم، شاهدته...»';
  const input = Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${visible}\n`, 'utf8');
  const result = processSubtitleBuffer(input);
  assert.ok(result.text.includes(visible));
  assert.doesNotMatch(result.text, /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u);
  assert.equal(processSubtitleBuffer(Buffer.from(result.text)).text, result.text);
});
"""
write("src/tests/subtitleProcessor.test.js", processor_tests)

timing_tests = read("src/tests/subtitleTiming.test.js")
timing_tests = timing_tests.replace(
"""test('detectSyncPlan enables confident fps correction', () => {
  const plan = detectSyncPlan({ subtitleRelease: { fps: 25 }, videoRelease: { fps: 23.976 } });
  assert.equal(plan.enabled, true);
  assert.ok(plan.confidence >= 70);
});""",
"""test('detectSyncPlan rejects unverified fps-only correction', () => {
  const plan = detectSyncPlan({ subtitleRelease: { fps: 25 }, videoRelease: { fps: 23.976 } });
  assert.equal(plan.enabled, false);
  assert.equal(plan.ratio, 1);
  assert.equal(plan.confidence, 0);
  assert.ok(plan.hints.some(hint => hint.startsWith('fps-difference-unverified:')));
});

test('detectSyncPlan enables only an explicit manual offset', () => {
  const plan = detectSyncPlan({ extra: { subtitleOffsetMs: 1750 } });
  assert.equal(plan.enabled, true);
  assert.equal(plan.verified, true);
  assert.equal(plan.offsetMs, 1750);
  assert.equal(plan.ratio, 1);
});"""
)
write("src/tests/subtitleTiming.test.js", timing_tests)

write("src/tests/reliabilityDefaults.test.js", r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../configCore.js';

test('safe defaults prioritize broad original subtitle coverage', () => {
  const config = buildConfig({});
  assert.equal(config.ranking.enableAutoSyncOption, false);
  assert.equal(config.ranking.enableReferenceAutoSync, false);
  assert.equal(config.referenceSync.enabled, false);
  assert.equal(config.providers.topN, 10);
  assert.equal(config.ranking.maxOriginalOptions, 10);
  assert.equal(config.ranking.maxStremioSubtitles, 12);
  assert.equal(config.resolver.maxProvidersPerStage, 4);
});

test('legacy sync flags cannot bypass the experimental master gate', () => {
  const blocked = buildConfig({
    ENABLE_AUTO_SYNC_OPTION: 'true',
    ENABLE_REFERENCE_AUTO_SYNC: 'true',
  });
  assert.equal(blocked.ranking.enableAutoSyncOption, false);
  assert.equal(blocked.ranking.enableReferenceAutoSync, false);
  assert.equal(blocked.referenceSync.enabled, false);

  const optedIn = buildConfig({
    ALLOW_EXPERIMENTAL_SYNC: 'true',
    ENABLE_AUTO_SYNC_OPTION: 'true',
    ENABLE_REFERENCE_AUTO_SYNC: 'true',
  });
  assert.equal(optedIn.ranking.enableAutoSyncOption, true);
  assert.equal(optedIn.ranking.enableReferenceAutoSync, true);
  assert.equal(optedIn.referenceSync.enabled, true);
});
""")

replace_once("src/release.js", "export const RELEASE_VERSION = '3.5.6';", "export const RELEASE_VERSION = '3.5.7';")

package = json.loads(read("package.json"))
package["version"] = "3.5.7"
package["description"] = "Arabic-first Stremio subtitle resolver with broad provider search, conservative punctuation handling, Personal Vault, and opt-in experimental synchronization without AI."
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")

lock = json.loads(read("package-lock.json"))
lock["version"] = "3.5.7"
if "" in lock.get("packages", {}):
    lock["packages"][""]["version"] = "3.5.7"
write("package-lock.json", json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

env_path = ".env.example"
env_text = read(env_path)
safe_env = """
# Synchronization derived only from timing structure is experimental and disabled by default.
ALLOW_EXPERIMENTAL_SYNC=false
ENABLE_AUTO_SYNC_OPTION=false
ENABLE_REFERENCE_AUTO_SYNC=false
TOP_N=10
STREMIO_MAX_SUBTITLES=12
STREMIO_ORIGINAL_TOP=10
RESOLVER_MAX_PROVIDERS_PER_STAGE=4
ENCODING_PROXY_MAX_FALLBACKS=4
"""
if "ALLOW_EXPERIMENTAL_SYNC=" not in env_text:
    env_text = env_text.rstrip() + "\n\n" + safe_env.lstrip()
else:
    env_text = re.sub(r"^ALLOW_EXPERIMENTAL_SYNC=.*$", "ALLOW_EXPERIMENTAL_SYNC=false", env_text, flags=re.M)
    env_text = re.sub(r"^ENABLE_AUTO_SYNC_OPTION=.*$", "ENABLE_AUTO_SYNC_OPTION=false", env_text, flags=re.M)
    env_text = re.sub(r"^ENABLE_REFERENCE_AUTO_SYNC=.*$", "ENABLE_REFERENCE_AUTO_SYNC=false", env_text, flags=re.M)
write(env_path, env_text if env_text.endswith("\n") else env_text + "\n")

changelog = read("CHANGELOG.md")
entry = """## 3.5.7 - Conservative Text and Search Reliability
- Removed both layers of resolver-injected RLM/RLI/PDI controls; SRT delivery now strips untrusted bidi controls while preserving every visible bracket, quote, ellipsis, and punctuation mark in source order.
- Disabled metadata-only FPS synchronization and placed all original subtitle candidates before any explicitly enabled experimental transform.
- Added a new `ALLOW_EXPERIMENTAL_SYNC` master gate so legacy Railway flags cannot silently re-enable structural reference sync.
- Expanded the default result pool to ten originals, searched all configured provider stages before truncation, and allowed SubDL metadata, filename, and title search shapes to contribute together.
- Raised reference-sync thresholds and disabled DTW/piecewise warping by default.
- Added regression coverage for paired Arabic punctuation, hidden-control removal, idempotence, safe sync defaults, and explicit manual offsets.

"""
if "## 3.5.7 - Conservative Text and Search Reliability" not in changelog:
    changelog = changelog.replace("# Changelog\n\n", "# Changelog\n\n" + entry, 1)
write("CHANGELOG.md", changelog)

readme = read("README.md")
readme = re.sub(r"^# m7md Arabic Resolver v\d+\.\d+\.\d+$", "# m7md Arabic Resolver v3.5.7", readme, count=1, flags=re.M)
section = """## ما الجديد في 3.5.7

- أزيل حقن علامات الاتجاه الخفية من طبقتي المعالجة والإرسال؛ يحذف المشروع العلامات الدخيلة فقط ويحافظ على الأقواس والنقاط والاقتباسات كما هي في ملف الترجمة.
- أصبحت الترجمات الأصلية أول ما يظهر، وارتفع عدد المرشحين الأصليين الافتراضي إلى عشرة.
- تُنفذ جميع مراحل البحث والمزودات المضبوطة قبل قص النتائج، ولا يتوقف البحث لمجرد امتلاء أول خمس خانات.
- أوقفت مزامنة FPS والمزامنة المرجعية البنيوية افتراضيًا لأنها لا تثبت توافق النسخة. لا تعمل إلا بعد تفعيل `ALLOW_EXPERIMENTAL_SYNC=true` صراحة.
- بقيت الإزاحة اليدوية الصريحة متاحة، وأضيفت اختبارات تمنع عودة حقن RTL أو تفعيل مزامنة غير مثبتة.

"""
if "## ما الجديد في 3.5.7" not in readme:
    marker = "## ما الجديد في 3.5.6"
    if marker in readme:
        readme = readme.replace(marker, section + marker, 1)
    else:
        readme = readme.rstrip() + "\n\n" + section
readme = readme.replace('{"status":"ok","version":"3.5.6","ai":false}', '{"status":"ok","version":"3.5.7","ai":false}')
write("README.md", readme)

print("Applied comprehensive subtitle reliability release 3.5.7")
