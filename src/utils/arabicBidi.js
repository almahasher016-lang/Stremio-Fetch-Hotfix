const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const LETTER_RE = /\p{L}/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const TERMINAL_BOUNDARY_RE = /(?:[.,،:;!؟؛…"'’”]|\p{Pe}|\p{Pf})$/u;
const RIGHT_TO_LEFT_MARK = '\u200F';

export function stripBidiControls(value) {
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
  if (!clean || !arabicDominatesLine(clean) || !TERMINAL_BOUNDARY_RE.test(clean)) return clean;

  // Anchor only selected terminal punctuation and closing punctuation to the Arabic run.
  // Do not add marks at line start or around inline brackets.
  return `${clean}${RIGHT_TO_LEFT_MARK}`;
}

export function stabilizeArabicSrt(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(stabilizeArabicCueLine)
    .join('\n');
}
