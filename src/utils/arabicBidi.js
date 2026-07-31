const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const LETTER_RE = /\p{L}/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const TIMING_RE = /^\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}/u;
const INDEX_RE = /^\s*\d+\s*$/u;
const RIGHT_TO_LEFT_MARK = '\u200F';
const RIGHT_TO_LEFT_ISOLATE = '\u2067';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

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
  if (!clean || TIMING_RE.test(clean) || INDEX_RE.test(clean) || !arabicDominatesLine(clean)) return clean;

  // مرساتا RTL تثبتان الأقواس وعلامات الترقيم المحايدة من الجهتين،
  // بينما يمنع العزل المقاطع الإنجليزية والأرقام من التأثير في السطر المحيط.
  return `${RIGHT_TO_LEFT_MARK}${RIGHT_TO_LEFT_ISOLATE}${RIGHT_TO_LEFT_MARK}${clean}${RIGHT_TO_LEFT_MARK}${POP_DIRECTIONAL_ISOLATE}${RIGHT_TO_LEFT_MARK}`;
}

export function stabilizeArabicSrt(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(stabilizeArabicCueLine)
    .join('\n');
}
