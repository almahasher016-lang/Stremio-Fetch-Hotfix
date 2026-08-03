import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLegacyArabicBracketLayout,
  repairLegacyArabicCueLine,
  repairLegacyArabicSrt,
} from '../utils/legacyArabicSrt.js';
import { processSubtitleBuffer } from '../utils/subtitleProcessor.js';

const RLM = '\u200F';
const RLI = '\u2067';
const PDI = '\u2069';

const PERSON_OF_INTEREST_S01E01_LINES = [
  '(أنا أُدعى (كارتر',
  '(سيد (ريس',
  '(يا سيد (ريس',
  '(بإمكانكَ أن تناديني بالسيد (فينش',
  'جيس)، مالخطْب؟)',
  'هانسن) تتحرك، إنها تتصل هاتفياً)',
  'ويلر)، مساعدها الإستشاري)',
  'سيندي)؟) -',
  '،ثمانية ملايين شخص',
  '...هنالك تفاوتات',
  '(دايان هانسن)، ترعرتَ في (ديترويت)',
  'الإصدار [WEB-DL] متاح',
];

function buildSrt(lines) {
  return lines.map((line, index) => (
    `${index + 1}\n00:00:${String(index).padStart(2, '0')},000 --> 00:00:${String(index + 1).padStart(2, '0')},000\n${line}`
  )).join('\n\n') + '\n';
}

test('detects the repeated legacy parenthesis layout from Person of Interest S01E01', () => {
  const source = buildSrt(PERSON_OF_INTEREST_S01E01_LINES);
  assert.equal(hasLegacyArabicBracketLayout(source), true);
});

test('repairs only deterministic legacy brackets and leading terminal punctuation', () => {
  const source = buildSrt(PERSON_OF_INTEREST_S01E01_LINES);
  const repaired = repairLegacyArabicSrt(source);

  assert.match(repaired, /أنا أُدعى \(كارتر\)/u);
  assert.match(repaired, /سيد \(ريس\)/u);
  assert.match(repaired, /\(جيس\)، مالخطْب؟/u);
  assert.match(repaired, /\(هانسن\) تتحرك، إنها تتصل هاتفياً/u);
  assert.match(repaired, /\(سيندي\)؟ -/u);
  assert.match(repaired, /ثمانية ملايين شخص،/u);
  assert.match(repaired, /هنالك تفاوتات\.\.\./u);
  assert.match(repaired, /\(دايان هانسن\)، ترعرتَ في \(ديترويت\)/u);
  assert.match(repaired, /الإصدار \[WEB-DL\] متاح/u);
  assert.equal(repairLegacyArabicSrt(repaired), repaired);
});

test('keeps isolated damage and healthy leading punctuation unchanged without file-level evidence', () => {
  const source = buildSrt([
    '(أنا أُدعى (كارتر',
    '،افتتاح مقصود',
    '...متابعة مقصودة',
    'شاهدت (الحلقة) أمس',
    'ابدأ من (',
  ]);

  assert.equal(hasLegacyArabicBracketLayout(source), false);
  assert.equal(repairLegacyArabicSrt(source), source);
});

test('repairs legacy punctuation only after the subtitle-level gate is satisfied', () => {
  assert.equal(repairLegacyArabicCueLine('،ثمانية ملايين شخص'), 'ثمانية ملايين شخص،');
  assert.equal(repairLegacyArabicCueLine('...هنالك تفاوتات'), 'هنالك تفاوتات...');
  assert.equal(repairLegacyArabicCueLine('مرحبا بالعالم.'), 'مرحبا بالعالم.');
});

test('processSubtitleBuffer repairs the real legacy pattern before applying bidi controls', () => {
  const source = buildSrt(PERSON_OF_INTEREST_S01E01_LINES);
  const once = processSubtitleBuffer(Buffer.from(source, 'utf8')).text;

  assert.match(once, new RegExp(`${RLI}أنا أُدعى \\(كارتر\\)${PDI}`, 'u'));
  assert.match(once, new RegExp(`${RLI}\\(جيس\\)، مالخطْب؟${PDI}`, 'u'));
  assert.match(once, new RegExp(`ثمانية ملايين شخص،${RLM}`, 'u'));
  assert.match(once, new RegExp(`هنالك تفاوتات\\.\\.\\.${RLM}`, 'u'));
  assert.doesNotMatch(once, /\(أنا أُدعى \(كارتر/u);
  assert.doesNotMatch(once, /جيس\)، مالخطْب؟\)/u);
  assert.equal(processSubtitleBuffer(Buffer.from(once, 'utf8')).text, once);
});
