const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
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
