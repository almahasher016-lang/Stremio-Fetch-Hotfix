from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    write(path, text.replace(old, new, 1))


arabic_bidi = r"""const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const LETTER_RE = /\p{L}/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const TERMINAL_NEUTRAL_RE = /[\p{P}\p{S}]$/u;
const RIGHT_TO_LEFT_MARK = '\u200F';

function stripBidiControls(value) {
  return String(value ?? '').replace(BIDI_CONTROL_RE, '');
}

function arabicDominatesLine(line) {
  let arabicLetters = 0;
  let otherLetters = 0;
  let firstLetterIsArabic = false;
  let foundFirstLetter = false;

  for (const character of line) {
    if (!LETTER_RE.test(character)) continue;
    const isArabic = ARABIC_SCRIPT_RE.test(character);
    if (!foundFirstLetter) {
      firstLetterIsArabic = isArabic;
      foundFirstLetter = true;
    }
    if (isArabic) arabicLetters += 1;
    else otherLetters += 1;
  }

  return arabicLetters > 0 && (arabicLetters >= otherLetters || firstLetterIsArabic);
}

export function stabilizeArabicCueLine(line) {
  const clean = stripBidiControls(line).trimEnd();
  if (!clean || !arabicDominatesLine(clean) || !TERMINAL_NEUTRAL_RE.test(clean)) return clean;

  // UAX #9 recommends a trailing RLM for a neutral punctuation mark on an RTL boundary.
  // Keep exactly one mark after the visible punctuation; never wrap or reorder the line.
  return `${clean}${RIGHT_TO_LEFT_MARK}`;
}

export function stabilizeArabicSrt(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(stabilizeArabicCueLine)
    .join('\n');
}
"""
write('src/utils/arabicBidi.js', arabic_bidi)

replace_once(
    'src/utils/subtitleProcessor.js',
    "const BIDI_CONTROL_RE = /[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]/g;\n",
    "const BIDI_CONTROL_RE = /[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]/g;\nconst LETTER_RE = /\\p{L}/u;\nconst ARABIC_SCRIPT_RE = /\\p{Script_Extensions=Arabic}/u;\nconst TERMINAL_NEUTRAL_RE = /[\\p{P}\\p{S}]$/u;\nconst RIGHT_TO_LEFT_MARK = '\\u200F';\n",
)

replace_once(
    'src/utils/subtitleProcessor.js',
    "function stripControlMarks(text) {\n  return String(text || '').replace(BIDI_CONTROL_RE, '');\n}\n\nfunction isolateArabicLine(line) {\n  return stripControlMarks(line).trimEnd();\n}\n",
    "function stripControlMarks(text) {\n  return String(text || '').replace(BIDI_CONTROL_RE, '');\n}\n\nfunction arabicDominatesLine(line) {\n  let arabicLetters = 0;\n  let otherLetters = 0;\n  let firstLetterIsArabic = false;\n  let foundFirstLetter = false;\n\n  for (const character of line) {\n    if (!LETTER_RE.test(character)) continue;\n    const isArabic = ARABIC_SCRIPT_RE.test(character);\n    if (!foundFirstLetter) {\n      firstLetterIsArabic = isArabic;\n      foundFirstLetter = true;\n    }\n    if (isArabic) arabicLetters += 1;\n    else otherLetters += 1;\n  }\n\n  return arabicLetters > 0 && (arabicLetters >= otherLetters || firstLetterIsArabic);\n}\n\nfunction isolateArabicLine(line) {\n  const clean = stripControlMarks(line).trimEnd();\n  if (!clean || !arabicDominatesLine(clean) || !TERMINAL_NEUTRAL_RE.test(clean)) return clean;\n\n  // Anchor only terminal neutral punctuation to the Arabic run. One trailing RLM is\n  // sufficient and avoids the bracket corruption caused by wrapping the whole line.\n  return `${clean}${RIGHT_TO_LEFT_MARK}`;\n}\n",
)

arabic_bidi_tests = r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeArabicCueLine, stabilizeArabicSrt } from '../utils/arabicBidi.js';

const RLM = '\u200F';
const UNSAFE_BIDI_RE = /[\u061C\u200E\u202A-\u202E\u2066-\u2069]/u;

test('anchors the terminal comma from the user-visible Stremio failure', () => {
  const source = 'ربما أنك حلمت بهذا الحدث،';
  assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('keeps internal Arabic punctuation untouched when the line ends with a letter', () => {
  const cases = [
    'نعم، منذ زمن بعيد، انتقلت',
    'أنا.. وبعض صديقاتي',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('anchors terminal punctuation, paired brackets, quotes, and ellipsis without moving visible text', () => {
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
    assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
  }
});

test('replaces upstream bidi controls with exactly one trailing RLM', () => {
  const source = '\u200F\u2067\u200F(مرحبا.)\u200F\u2069\u200F';
  assert.equal(stabilizeArabicCueLine(source), `(مرحبا.)${RLM}`);
});

test('is exactly idempotent and preserves indexes and timings', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(مرحبا.)\u200F\u2069\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.equal(once, `1\n00:00:01,000 --> 00:00:02,000\n(مرحبا.)${RLM}\n`);
  assert.doesNotMatch(once, UNSAFE_BIDI_RE);
  assert.equal((once.match(/\u200F/gu) || []).length, 1);
});

test('does not anchor numeric dialogue or a Latin-dominant mixed line', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
"""
write('src/tests/arabicBidi.test.js', arabic_bidi_tests)

old_processor_test = r"""test('processSubtitleBuffer preserves paired punctuation without injecting bidi controls', () => {
  const visible = '— (هل شاهدت [Euphoria]؟) «نعم، شاهدته...»';
  const input = Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${visible}\n`, 'utf8');
  const result = processSubtitleBuffer(input);
  assert.ok(result.text.includes(visible));
  assert.doesNotMatch(result.text, /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u);
  assert.equal(processSubtitleBuffer(Buffer.from(result.text)).text, result.text);
});"""
new_processor_test = r"""test('processSubtitleBuffer anchors terminal Arabic punctuation with one RLM', () => {
  const visible = 'ربما أنك حلمت بهذا الحدث،';
  const input = Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${visible}\n`, 'utf8');
  const result = processSubtitleBuffer(input);
  assert.ok(result.text.includes(`${visible}\u200F`));
  assert.equal((result.text.match(/\u200F/gu) || []).length, 1);
  assert.doesNotMatch(result.text, /[\u061C\u200E\u202A-\u202E\u2066-\u2069]/u);
  assert.equal(processSubtitleBuffer(Buffer.from(result.text)).text, result.text);
});

test('processSubtitleBuffer leaves internal punctuation in source order', () => {
  const visible = 'نعم، منذ زمن بعيد، انتقلت\nأنا.. وبعض صديقاتي';
  const input = Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${visible}\n`, 'utf8');
  const result = processSubtitleBuffer(input);
  assert.ok(result.text.includes(visible));
  assert.doesNotMatch(result.text, /\u200F/u);
});"""
replace_once('src/tests/subtitleProcessor.test.js', old_processor_test, new_processor_test)

replace_once('src/release.js', "export const RELEASE_VERSION = '3.5.7';", "export const RELEASE_VERSION = '3.5.8';")
replace_once('package.json', '"version": "3.5.7"', '"version": "3.5.8"')

lock = read('package-lock.json')
if lock.count('"version": "3.5.7"') < 2:
    raise SystemExit('package-lock.json: expected at least two 3.5.7 version fields')
lock = lock.replace('"version": "3.5.7"', '"version": "3.5.8"', 2)
write('package-lock.json', lock)

replace_once('src/utils/encodingProxy.js', 'return `encoding:v8:${sign(normalized)}`;', 'return `encoding:v9:${sign(normalized)}`;')

readme = read('README.md')
readme = readme.replace('# m7md Arabic Resolver v3.5.7', '# m7md Arabic Resolver v3.5.8', 1)
marker = '## ما الجديد في 3.5.7\n'
section = """## ما الجديد في 3.5.8

- تصحيح العرض البصري للترقيم النهائي العربي في Stremio: تُضاف علامة RLM واحدة بعد النقطة أو الفاصلة أو القوس النهائي فقط.
- لا يُغلّف السطر كاملًا ولا تُحرّك أي علامة ظاهرة، وتبقى الفواصل والنقاط الداخلية كما هي.
- إضافة اختبار انحدار مطابق للصورة الفعلية: `ربما أنك حلمت بهذا الحدث،` يجب ألا تظهر الفاصلة قبل كلمة «ربما».
- كسر كاش ملفات الترجمة ورفع رقم Manifest مع إبقاء معرّف الإضافة ثابتًا.

"""
if marker not in readme:
    raise SystemExit('README marker not found')
readme = readme.replace(marker, section + marker, 1)
readme = readme.replace('{"status":"ok","version":"3.5.7","ai":false}', '{"status":"ok","version":"3.5.8","ai":false}', 1)
write('README.md', readme)

changelog = read('CHANGELOG.md')
entry = """## 3.5.8 - Terminal Arabic Punctuation Direction
- Fixed terminal Arabic punctuation rendering on Stremio by adding exactly one trailing RLM after a neutral punctuation or closing symbol on Arabic-dominant cue lines.
- Kept internal punctuation and visible character order unchanged, without wrapping full lines in embeddings or isolates.
- Added regression tests based on the user-visible `ربما أنك حلمت بهذا الحدث،` failure and retained idempotent cleanup of upstream bidi controls.
- Bumped the encoding cache namespace and public manifest version while preserving the stable add-on ID.

"""
changelog = changelog.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
write('CHANGELOG.md', changelog)

print('Applied terminal Arabic punctuation correction v3.5.8')
