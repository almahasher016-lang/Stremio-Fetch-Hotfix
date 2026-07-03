const ARABIC_CODES = new Set(['ar', 'ara', 'arabic', 'العربية', 'arab', 'ar-sa', 'ar-eg', 'ar-ae', 'ar-lb', 'ar-sy', 'ar-iq', 'ar-jo', 'ar-ma', 'ar-dz', 'ar-tn', 'ar-ly', 'ar-ye', 'ar-qa', 'ar-kw', 'ar-bh', 'ar-om', 'ar-ps', 'ar-sd']);
const ENGLISH_CODES = new Set(['en', 'eng', 'english', 'en-us', 'en-gb', 'en-au', 'en-ca']);

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase().replace('_', '-');
}

export function isArabicLanguage(value) {
  if (!value) return false;
  const normalized = normalizeCode(value);
  if (ARABIC_CODES.has(normalized)) return true;
  return /[\u0600-\u06FF]/.test(String(value));
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
  return /[\u0600-\u06FF]/.test(String(value || ''));
}
