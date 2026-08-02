import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stabilizeArabicCueLine,
  stabilizeArabicSrt,
  stripBidiControls,
} from '../utils/arabicBidi.js';

const RLM = '\u200F';
const RLI = '\u2067';
const PDI = '\u2069';
const UNSAFE_BIDI_RE = /[\u061C\u200E\u202A-\u202E\u2066\u2068]/u;

test('isolates the paired-parenthesis line shown incorrectly on the TV', () => {
  const source = '(شخص يُقتل في مدينة نيويورك)';
  assert.equal(stabilizeArabicCueLine(source), `${RLI}${source}${PDI}`);
});

test('isolates a bracket-bearing Arabic line exactly once, including nested pairs', () => {
  const cases = [
    'شاهدت (الحلقة) أمس',
    '(شخص يُقتل في مدينة (نيويورك))',
    '[هل أنت بخير؟]',
    '{انتبه!}',
    'النص 【العربي】 هنا',
  ];
  for (const source of cases) {
    assert.equal(stabilizeArabicCueLine(source), `${RLI}${source}${PDI}`);
  }
});

test('does not isolate unmatched opening brackets or pairs containing Latin text only', () => {
  const cases = [
    'ابدأ من (',
    'الإصدار [WEB-DL] متاح',
    'الدقة (1080p) ممتازة',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('keeps the existing terminal policy for an unmatched closing bracket', () => {
  const source = 'انتهى هنا )';
  assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('anchors the terminal Arabic comma from the earlier Stremio failure', () => {
  const source = 'ربما أنك حلمت بهذا الحدث،';
  assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('anchors selected terminal punctuation on lines without Arabic bracket pairs', () => {
  const cases = [
    'مرحبا بالعالم.',
    'انتبه!',
    'هل أنت بخير؟',
    'توقف؛',
    'قال:',
    'ربما...',
    'قال «نعم»',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('does not anchor generic symbols or opening punctuation', () => {
  const cases = [
    'الناتج +',
    'القيمة =',
    'حقوق النشر ©',
    'ابدأ من [',
    'ابدأ من {',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('keeps internal punctuation unchanged on bracket-free lines ending with a letter', () => {
  const cases = [
    'نعم، منذ زمن بعيد، انتقلت',
    'أنا.. وبعض صديقاتي',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('removes upstream controls before applying one calculated strategy', () => {
  const bracketSource = `\u200F\u2067(مرحبا.)\u2069\u200F`;
  assert.equal(stabilizeArabicCueLine(bracketSource), `${RLI}(مرحبا.)${PDI}`);
  assert.equal(stripBidiControls(bracketSource), '(مرحبا.)');

  const punctuationSource = '\u202Bمرحبا!\u202C';
  assert.equal(stabilizeArabicCueLine(punctuationSource), `مرحبا!${RLM}`);
});

test('is exactly idempotent for bracket isolation and terminal punctuation', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(شخص يُقتل في مدينة نيويورك)\u2069\n\n2\n00:00:03,000 --> 00:00:04,000\nمرحبا!\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.equal(
    once,
    `1\n00:00:01,000 --> 00:00:02,000\n${RLI}(شخص يُقتل في مدينة نيويورك)${PDI}\n\n2\n00:00:03,000 --> 00:00:04,000\nمرحبا!${RLM}\n`,
  );
  assert.doesNotMatch(once, UNSAFE_BIDI_RE);
  assert.equal((once.match(/\u2067/gu) || []).length, 1);
  assert.equal((once.match(/\u2069/gu) || []).length, 1);
  assert.equal((once.match(/\u200F/gu) || []).length, 1);
});

test('does not modify numeric dialogue or a Latin-dominant mixed line', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
