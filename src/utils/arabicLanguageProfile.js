const SCRIPT_CHAR_RE = /\p{Script_Extensions=Arabic}/u;
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
