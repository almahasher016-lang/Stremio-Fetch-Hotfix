const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const LETTER_RE = /\p{L}/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const TERMINAL_BOUNDARY_RE = /(?:[.,،:;!؟؛…"'’”]|\p{Pe}|\p{Pf})$/u;
const RIGHT_TO_LEFT_MARK = '\u200F';
const RIGHT_TO_LEFT_ISOLATE = '\u2067';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

const BRACKET_PAIRS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['（', '）'],
  ['［', '］'],
  ['｛', '｝'],
  ['〈', '〉'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
  ['【', '】'],
  ['〔', '〕'],
]);
const CLOSING_TO_OPENING = new Map(
  [...BRACKET_PAIRS].map(([opening, closing]) => [closing, opening]),
);

export function stripBidiControls(value) {
  return String(value ?? '').replace(BIDI_CONTROL_RE, '');
}

function isArabicLetter(character) {
  return LETTER_RE.test(character) && ARABIC_SCRIPT_RE.test(character);
}

function containsArabicLetter(value) {
  for (const character of value) {
    if (isArabicLetter(character)) return true;
  }
  return false;
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

  const strongArabicLead = firstLetterIsArabic
    && arabicLetters >= 2
    && arabicLetters * 4 >= otherLetters;
  return arabicLetters > 0 && (arabicLetters >= otherLetters || strongArabicLead);
}

function hasArabicBracketPair(line) {
  const stack = [];

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (BRACKET_PAIRS.has(character)) {
      stack.push({ character, index });
      continue;
    }

    const expectedOpening = CLOSING_TO_OPENING.get(character);
    if (!expectedOpening) continue;

    let stackIndex = stack.length - 1;
    while (stackIndex >= 0 && stack[stackIndex].character !== expectedOpening) {
      stackIndex -= 1;
    }
    if (stackIndex < 0) continue;

    const opening = stack[stackIndex];
    stack.length = stackIndex;
    if (containsArabicLetter(line.slice(opening.index + 1, index))) return true;
  }

  return false;
}

export function stabilizeArabicCueLine(line) {
  const clean = stripBidiControls(line).trimEnd();
  if (!clean || !arabicDominatesLine(clean)) return clean;

  // A paired bracket containing Arabic needs one isolated RTL run so the renderer
  // resolves both brackets together. Never inject marks beside individual brackets.
  if (hasArabicBracketPair(clean)) {
    return `${RIGHT_TO_LEFT_ISOLATE}${clean}${POP_DIRECTIONAL_ISOLATE}`;
  }

  if (!TERMINAL_BOUNDARY_RE.test(clean)) return clean;

  // For lines without paired brackets, anchor only selected terminal punctuation.
  return `${clean}${RIGHT_TO_LEFT_MARK}`;
}

export function stabilizeArabicSrt(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(stabilizeArabicCueLine)
    .join('\n');
}
