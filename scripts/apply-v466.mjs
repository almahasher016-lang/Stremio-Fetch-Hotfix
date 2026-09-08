import fs from 'node:fs';

const version = '4.6.6';

function replaceOnce(path, before, after) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`Expected patch target not found in ${path}`);
  text = text.replace(before, after);
  fs.writeFileSync(path, text);
}

fs.writeFileSync('src/utils/arabicLanguageProfile.js', String.raw`const SCRIPT_CHAR_RE = /\p{Script_Extensions=Arabic}/u;
const DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const PERSIAN_DISTINCTIVE_RE = /[پچژگکیۀ]/gu;
const ARABIC_DISTINCTIVE_RE = /[ةىئؤأإآضظثذ]/gu;

const PERSIAN_COMMON_WORDS = new Set([
  'است', 'نیست', 'که', 'برای', 'این', 'آن', 'را', 'می', 'یک', 'خیلی', 'باید', 'اگر', 'چرا', 'وقتی',
  'شما', 'هست', 'نمی', 'باشه', 'میشه', 'کردم', 'داری', 'داره', 'اون', 'اگه', 'خودش', 'چون', 'شاید',
]);

const ARABIC_COMMON_WORDS = new Set([
  'في', 'إلى', 'على', 'هذا', 'هذه', 'الذي', 'التي', 'أنا', 'نحن', 'أنت', 'لكن', 'هل', 'كان', 'ليس',
  'مع', 'عن', 'لقد', 'سوف', 'الآن', 'هناك', 'ماذا', 'لماذا', 'كيف', 'نعم', 'كلا', 'إن', 'أن', 'لا',
  'هو', 'هي', 'هم', 'هنا', 'أين',
]);

function countMatches(value, regex) {
  return (String(value || '').match(regex) || []).length;
}

function scriptWords(text) {
  return text
    .split(/[^\p{L}\p{M}]+/u)
    .filter(word => word && [...word].some(character => SCRIPT_CHAR_RE.test(character)));
}

export function analyzeArabicScriptLanguage(value = '') {
  const text = String(value || '').normalize('NFKC').replace(DIACRITICS_RE, ' ');
  const characters = [...text];
  const scriptCharCount = characters.filter(character => SCRIPT_CHAR_RE.test(character)).length;
  const words = scriptWords(text);
  const persianDistinctiveCount = countMatches(text, PERSIAN_DISTINCTIVE_RE);
  const arabicDistinctiveCount = countMatches(text, ARABIC_DISTINCTIVE_RE);
  const persianWordHits = words.reduce((sum, word) => sum + (PERSIAN_COMMON_WORDS.has(word) ? 1 : 0), 0);
  const arabicWordHits = words.reduce((sum, word) => sum + (ARABIC_COMMON_WORDS.has(word) ? 1 : 0), 0);
  const persianDistinctiveRatio = scriptCharCount ? persianDistinctiveCount / scriptCharCount : 0;

  const lexicalPersian = persianWordHits >= 6
    && persianWordHits >= Math.max(6, arabicWordHits * 2);
  const orthographicPersian = persianDistinctiveCount >= 20
    && persianDistinctiveRatio >= 0.012
    && persianWordHits >= 3
    && persianWordHits > arabicWordHits * 1.5;
  const likelyPersian = lexicalPersian || orthographicPersian;
  const likelyArabic = !likelyPersian && scriptCharCount > 0
    && (arabicWordHits >= 3 || arabicDistinctiveCount >= 4);

  return {
    language: likelyPersian ? 'persian' : likelyArabic ? 'arabic' : scriptCharCount ? 'arabic-script-unknown' : 'other',
    likelyPersian,
    likelyArabic,
    scriptCharCount,
    wordCount: words.length,
    persianDistinctiveCount,
    arabicDistinctiveCount,
    persianDistinctiveRatio: Number(persianDistinctiveRatio.toFixed(4)),
    persianWordHits,
    arabicWordHits,
  };
}

export function isLikelyPersianText(value = '') {
  return analyzeArabicScriptLanguage(value).likelyPersian;
}
`);

fs.writeFileSync('src/utils/language.js', String.raw`import { analyzeArabicScriptLanguage } from './arabicLanguageProfile.js';

const ARABIC_CODES = new Set(['ar', 'ara', 'arabic', 'العربية', 'عربي', 'عربية', 'arab', 'ar-sa', 'ar-eg', 'ar-ae', 'ar-lb', 'ar-sy', 'ar-iq', 'ar-jo', 'ar-ma', 'ar-dz', 'ar-tn', 'ar-ly', 'ar-ye', 'ar-qa', 'ar-kw', 'ar-bh', 'ar-om', 'ar-ps', 'ar-sd']);
const PERSIAN_CODES = new Set(['fa', 'fas', 'per', 'persian', 'farsi', 'فارسی', 'فارسي', 'fa-ir']);
const ENGLISH_CODES = new Set(['en', 'eng', 'english', 'en-us', 'en-gb', 'en-au', 'en-ca']);

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase().replace('_', '-');
}

export function isArabicLanguage(value) {
  if (!value) return false;
  const normalized = normalizeCode(value);
  if (PERSIAN_CODES.has(normalized)) return false;
  return ARABIC_CODES.has(normalized);
}

export function isEnglishLanguage(value) {
  if (!value) return false;
  return ENGLISH_CODES.has(normalizeCode(value));
}

export function providerLanguageParam(language = 'ar', provider = 'generic') {
  const normalized = normalizeCode(language);
  const english = isEnglishLanguage(normalized);
  if (provider === 'opensubtitles') return english ? 'en' : 'ar';
  if (provider === 'subdl') return english ? 'en' : 'ar';
  if (provider === 'subsource') return english ? 'english' : 'arabic';
  return english ? 'en' : 'ar';
}

export function normalizeStremioLanguage(value) {
  if (isArabicLanguage(value)) return 'ara';
  if (isEnglishLanguage(value)) return 'eng';
  return String(value || 'und').toLowerCase();
}

export function containsArabicText(value) {
  const profile = analyzeArabicScriptLanguage(value);
  return profile.scriptCharCount > 0 && !profile.likelyPersian;
}
`);

replaceOnce(
  'src/utils/subtitleQuality.js',
  "import { timeToMs } from './subtitleTiming.js';",
  "import { timeToMs } from './subtitleTiming.js';\nimport { analyzeArabicScriptLanguage } from './arabicLanguageProfile.js';",
);
replaceOnce(
  'src/utils/subtitleQuality.js',
  `  const arabicChars = letters.filter(character => ARABIC_LETTER_OR_NUMBER_RE.test(character));\n  const arabicRatio = letters.length ? clamp(arabicChars.length / letters.length, 0, 1) : 0;`,
  `  const arabicChars = letters.filter(character => ARABIC_LETTER_OR_NUMBER_RE.test(character));\n  const arabicRatio = letters.length ? clamp(arabicChars.length / letters.length, 0, 1) : 0;\n  const languageProfile = analyzeArabicScriptLanguage(allText);\n  const wrongLanguage = languageProfile.likelyPersian;`,
);
replaceOnce(
  'src/utils/subtitleQuality.js',
  `  if (arabicRatio >= minArabicRatio) score += 28;\n  else reasons.push('low-arabic-ratio');`,
  `  if (wrongLanguage) reasons.push('wrong-language-persian');\n  else if (arabicRatio >= minArabicRatio) score += 28;\n  else reasons.push('low-arabic-ratio');`,
);
replaceOnce(
  'src/utils/subtitleQuality.js',
  `  const valid = cues.length >= minCues && arabicRatio >= minArabicRatio && coverageValid;`,
  `  const valid = cues.length >= minCues && arabicRatio >= minArabicRatio && !wrongLanguage && coverageValid;`,
);
replaceOnce(
  'src/utils/subtitleQuality.js',
  `    arabicRatio: Number(arabicRatio.toFixed(3)),\n    duplicateRatio: Number(duplicateRatio.toFixed(3)),`,
  `    arabicRatio: Number(arabicRatio.toFixed(3)),\n    detectedLanguage: languageProfile.language,\n    persianDistinctiveRatio: languageProfile.persianDistinctiveRatio,\n    persianWordHits: languageProfile.persianWordHits,\n    arabicWordHits: languageProfile.arabicWordHits,\n    duplicateRatio: Number(duplicateRatio.toFixed(3)),`,
);

replaceOnce(
  'src/services/accuracyPreflight.js',
  "const HARD_REJECT_REASONS = new Set(['low-arabic-ratio', 'too-few-cues', 'invalid-timed-cues']);",
  "const HARD_REJECT_REASONS = new Set(['low-arabic-ratio', 'wrong-language-persian', 'too-few-cues', 'invalid-timed-cues']);",
);

replaceOnce(
  'src/utils/encodingProxy.js',
  "        && error.quality?.reasons?.includes('low-arabic-ratio')",
  "        && error.quality?.reasons?.some(reason => ['low-arabic-ratio', 'wrong-language-persian'].includes(reason))",
);

replaceOnce(
  'src/utils/subtitleArchive.js',
  "import { buildReleaseMatch } from './scoring.js';",
  "import { buildReleaseMatch } from './scoring.js';\nimport { analyzeArabicScriptLanguage } from './arabicLanguageProfile.js';",
);
replaceOnce(
  'src/utils/subtitleArchive.js',
  `function arabicContentClass(candidate) {\n  const text = decodeSubtitleBuffer(candidate.buffer).text || '';\n  const arabicCount = (text.match(ARABIC_RE) || []).length;`,
  `function arabicContentClass(candidate) {\n  const text = decodeSubtitleBuffer(candidate.buffer).text || '';\n  if (analyzeArabicScriptLanguage(text).likelyPersian) return 0;\n  const arabicCount = (text.match(ARABIC_RE) || []).length;`,
);
replaceOnce(
  'src/utils/subtitleArchive.js',
  `  const text = decoded.text || '';\n  const format = detectSubtitleFormat(text);`,
  `  const text = decoded.text || '';\n  if (analyzeArabicScriptLanguage(text).likelyPersian) return Number.NEGATIVE_INFINITY;\n  const format = detectSubtitleFormat(text);`,
);

replaceOnce(
  'src/utils/stremio.js',
  `  if (item.timingReferenceEvidence?.exactVideoHash) badges.push('🧭 Exact Timeline');\n  if (item.hearingImpaired || item.sdh) badges.push('👂 SDH');\n  if (item.machineTranslated || item.automatedTranslated) badges.push('🤖 MT');\n  if (item.quality?.score) badges.push(\`✓ Q\${item.quality.score}\`);`,
  `  if (item.timingReferenceEvidence?.exactVideoHash) badges.push('🧭 Exact Timeline');\n  const timingVerified = Boolean(\n    item.timingReferenceEvidence?.exactVideoHash\n    || item.sourceType === 'version-registry-exact-hash'\n    || item.sourceType === 'personal-vault-exact-hash'\n    || item.releaseMatchTier >= 3\n  );\n  if (!timingVerified && item.provider !== 'vault' && item.provider !== 'registry') badges.push('⚠ Timing Unverified');\n  if (item.hearingImpaired || item.sdh) badges.push('👂 SDH');\n  if (item.machineTranslated || item.automatedTranslated) badges.push('🤖 MT');\n  if (item.quality?.score) badges.push(\`✓ Text Q\${item.quality.score}\`);`,
);

fs.writeFileSync('src/tests/arabicLanguageRegression.test.js', String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { analyzeArabicScriptLanguage } from '../utils/arabicLanguageProfile.js';
import { isArabicLanguage } from '../utils/language.js';
import { analyzeSubtitleQuality } from '../utils/subtitleQuality.js';
import { extractSubtitlePayload } from '../utils/subtitleArchive.js';
import { subtitleDisplayName } from '../utils/stremio.js';

function timedSrt(line, count = 20) {
  const blocks = [];
  for (let index = 0; index < count; index += 1) {
    const start = String(index + 1).padStart(2, '0');
    const end = String(index + 2).padStart(2, '0');
    blocks.push((index + 1) + '\n00:00:' + start + ',000 --> 00:00:' + end + ',000\n' + line);
  }
  return blocks.join('\n\n');
}

const persianLine = 'این یک ترجمه فارسی است که برای این فیلم ساخته شده و باید درست نمایش داده شود ولی عربی نیست شما چرا این را می بینید';
const arabicLine = 'هذه ترجمة عربية لهذا الفيلم وأنا أريد أن تكون في التوقيت الصحيح ولكن يجب التحقق من النسخة قبل العرض';

test('Persian text is not accepted as Arabic just because it uses Arabic script', () => {
  const profile = analyzeArabicScriptLanguage((persianLine + ' ').repeat(20));
  assert.equal(profile.likelyPersian, true);
  assert.equal(profile.language, 'persian');
  assert.equal(isArabicLanguage('فارسی'), false);
  assert.equal(isArabicLanguage('fa'), false);
  assert.equal(isArabicLanguage('العربية'), true);
});

test('quality gate hard-invalidates a full Persian subtitle while preserving real Arabic', () => {
  const persian = analyzeSubtitleQuality(timedSrt(persianLine));
  const arabic = analyzeSubtitleQuality(timedSrt(arabicLine));
  assert.ok(persian.arabicRatio >= 0.9);
  assert.equal(persian.valid, false);
  assert.ok(persian.reasons.includes('wrong-language-persian'));
  assert.equal(persian.detectedLanguage, 'persian');
  assert.equal(arabic.valid, true);
  assert.notEqual(arabic.detectedLanguage, 'persian');
});

test('ZIP selection rejects a longer Persian subtitle and chooses the Arabic entry', async () => {
  const archive = zipSync({
    'Persian-long.srt': strToU8(timedSrt(persianLine, 40)),
    'Arabic.srt': strToU8(timedSrt(arabicLine, 20)),
  });
  const extracted = await extractSubtitlePayload(Buffer.from(archive), {
    maxDecompressedBytes: 1_000_000,
    maxArchiveEntries: 8,
    sourceName: 'Spider.Man.Brand.New.Day.2026.zip',
    context: { type: 'movie', filename: 'Spider.Man.Brand.New.Day.2026.4k.Th Rong.mkv', year: 2026 },
  });
  assert.equal(extracted.entryName, 'Arabic.srt');
});

test('Stremio quality badge separates text quality from timing confidence', () => {
  const name = subtitleDisplayName({
    provider: 'opensubtitles',
    quality: { score: 100 },
    releaseMatchTier: 0,
    score: 918,
    parsedRelease: { quality: '1080p', source: 'telesync' },
  });
  assert.match(name, /Text Q100/);
  assert.match(name, /Timing Unverified/);
});
`);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

let release = fs.readFileSync('src/release.js', 'utf8');
release = release.replace(/RELEASE_VERSION = '[^']+'/u, `RELEASE_VERSION = '${version}'`);
fs.writeFileSync('src/release.js', release);

let readme = fs.readFileSync('README.md', 'utf8');
readme = readme.replace(/^# m7md Arabic Resolver v[^\n]+/u, `# m7md Arabic Resolver v${version}`);
if (!readme.includes(`## ما الجديد في ${version}`)) {
  const section = `## ما الجديد في ${version}\n\n- إضافة تمييز فعلي بين العربية والفارسية داخل ملفات الترجمة؛ الحروف ذات Arabic Script لم تعد كافية وحدها لاعتبار الملف عربيًا.\n- رفض الترجمة الفارسية كخطأ لغة نهائي أثناء Accuracy Preflight وقبل إظهارها في Stremio، مع تطبيق الحماية نفسها داخل ZIP.\n- إصلاح تصنيف أكواد اللغة حتى \`fa/fas/per/farsi/persian/فارسی\` لا تُعامل كعربية.\n- تغيير شارة \`Q100\` إلى \`Text Q100\` لأنها تقيس سلامة محتوى ملف الترجمة، لا ضمان تطابق توقيته مع إصدار الفيديو.\n- إضافة \`⚠ Timing Unverified\` عندما لا يوجد exact timeline ولا دليل مطابقة إصدار قوي.\n- إضافة اختبارات انحدار مبنية على حالة Spider-Man: Brand New Day 2026 التي أعادت ترجمة فارسية في المركز الأول.\n\n`;
  const marker = '## ما الجديد في 4.6.5';
  readme = readme.includes(marker) ? readme.replace(marker, section + marker) : readme.trimEnd() + '\n\n' + section;
}
fs.writeFileSync('README.md', readme);

let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## ${version} - 2026-09-08`)) {
  const entry = `## ${version} - 2026-09-08\n\n- Distinguish Persian/Farsi from Arabic using lexical and orthographic evidence instead of Arabic-script Unicode alone.\n- Hard-reject Persian subtitle content in Accuracy Preflight and ZIP entry selection.\n- Stop treating Persian language labels/codes as Arabic.\n- Rename Q badges to Text Q and label weak timing/release evidence as Timing Unverified.\n- Add Spider-Man: Brand New Day shaped regressions for Persian-vs-Arabic selection.\n\n`;
  changelog = entry + changelog;
}
fs.writeFileSync('CHANGELOG.md', changelog);
