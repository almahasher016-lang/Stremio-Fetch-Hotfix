import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stabilizeArabicCueLine,
  stabilizeArabicSrt,
  stripBidiControls,
} from '../utils/arabicBidi.js';

const RLM = '\u200F';
const UNSAFE_BIDI_RE = /[\u061C\u200E\u202A-\u202E\u2066-\u2069]/u;

test('anchors the terminal Arabic comma from the user-visible Stremio failure', () => {
  const source = 'ربما أنك حلمت بهذا الحدث،';
  assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('anchors selected terminal punctuation and closing punctuation only', () => {
  const cases = [
    'مرحبا بالعالم.',
    'انتبه!',
    'هل أنت بخير؟',
    'توقف؛',
    'قال:',
    'ربما...',
    '(مرحبا بالعالم.)',
    '[هل أنت بخير؟]',
    '{انتبه!}',
    '«هذا صحيح»',
    'قال "نعم"',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('does not anchor generic symbols or opening punctuation', () => {
  const cases = [
    'الناتج +',
    'القيمة =',
    'حقوق النشر ©',
    'ابدأ من (',
    'ابدأ من [',
    'ابدأ من {',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('keeps internal punctuation and brackets untouched when the line ends with a letter', () => {
  const cases = [
    'نعم، منذ زمن بعيد، انتقلت',
    'أنا.. وبعض صديقاتي',
    'شاهدت (الحلقة) أمس',
    'الإصدار [WEB-DL] متاح',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('removes upstream bidi controls then adds at most one calculated trailing RLM', () => {
  const source = '\u200F\u2067\u200F(مرحبا.)\u200F\u2069\u200F';
  assert.equal(stabilizeArabicCueLine(source), `(مرحبا.)${RLM}`);
  assert.equal(stripBidiControls(source), '(مرحبا.)');
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
