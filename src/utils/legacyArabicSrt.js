const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const LEADING_TERMINAL_RE = /^(\s*)([.,،:;!؟؛…]{1,3})(\s*)/u;
const TERMINAL_MARK_RE = /[.,،:;!؟؛…]/u;
const TRAILING_DECORATION_RE = /[\s"'’”»\-–—]+$/u;
const TRAILING_BOUNDARY_RE = /[\s.,،:;!؟؛…"'’”»\-–—]+$/u;
const OPENING_DECORATION_RE = /^[\s"'“‘«\-–—]+/u;

const MIN_LEGACY_BRACKET_LINES = 6;
const MIN_LEGACY_BRACKET_RATIO = 0.02;

function containsArabicLetter(value) {
  for (const character of String(value || '')) {
    if (/\p{L}/u.test(character) && ARABIC_SCRIPT_RE.test(character)) return true;
  }
  return false;
}

function countCharacter(value, target) {
  let count = 0;
  for (const character of String(value || '')) {
    if (character === target) count += 1;
  }
  return count;
}

function boundaryOpeningIndex(value) {
  const index = value.indexOf('(');
  if (index === -1 || LETTER_OR_NUMBER_RE.test(value.slice(0, index))) return -1;
  return index;
}

function boundaryClosingIndex(value) {
  const index = value.lastIndexOf(')');
  if (index === -1 || LETTER_OR_NUMBER_RE.test(value.slice(index + 1))) return -1;
  return index;
}

function legacyBracketDirection(value) {
  if (!containsArabicLetter(value)) return null;
  const opening = countCharacter(value, '(');
  const closing = countCharacter(value, ')');
  if (opening - closing === 2 && boundaryOpeningIndex(value) !== -1) return 'opening';
  if (closing - opening === 2 && boundaryClosingIndex(value) !== -1) return 'closing';
  return null;
}

function srtDialogueLines(text) {
  const output = [];
  for (const block of String(text || '').replace(/\r/gu, '').split(/\n{2,}/u)) {
    const lines = block.split('\n');
    const timeIndex = lines.findIndex(line => /\d{2,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}/u.test(line));
    if (timeIndex === -1) continue;
    output.push(...lines.slice(timeIndex + 1).filter(Boolean));
  }
  return output;
}

export function hasLegacyArabicBracketLayout(text) {
  const dialogue = srtDialogueLines(text);
  let arabicLines = 0;
  let openingEvidence = 0;
  let closingEvidence = 0;

  for (const line of dialogue) {
    if (!containsArabicLetter(line)) continue;
    arabicLines += 1;
    const direction = legacyBracketDirection(line);
    if (direction === 'opening') openingEvidence += 1;
    else if (direction === 'closing') closingEvidence += 1;
  }

  const evidence = openingEvidence + closingEvidence;
  if (evidence < MIN_LEGACY_BRACKET_LINES) return false;
  if (evidence / Math.max(1, arabicLines) < MIN_LEGACY_BRACKET_RATIO) return false;
  return (
    (openingEvidence >= 2 && closingEvidence >= 2)
    || openingEvidence >= MIN_LEGACY_BRACKET_LINES * 2
    || closingEvidence >= MIN_LEGACY_BRACKET_LINES * 2
  );
}

function insertBeforeTrailing(value, addition, boundaryPattern) {
  const suffix = value.match(boundaryPattern)?.[0] || '';
  const body = suffix ? value.slice(0, -suffix.length) : value;
  return `${body}${addition}${suffix}`;
}

function relocateLegacyLeadingTerminal(value) {
  const match = value.match(LEADING_TERMINAL_RE);
  if (!match) return value;
  const rest = value.slice(match[0].length);
  if (!containsArabicLetter(rest)) return value;

  const decoration = rest.match(TRAILING_DECORATION_RE)?.[0] || '';
  const visibleEnd = decoration ? rest.slice(0, -decoration.length) : rest;
  if (TERMINAL_MARK_RE.test(visibleEnd.at(-1) || '')) return value;

  const relocated = insertBeforeTrailing(rest, match[2], TRAILING_DECORATION_RE);
  return `${match[1]}${relocated}`;
}

function repairLegacyRoundBrackets(value) {
  const direction = legacyBracketDirection(value);
  if (direction === 'opening') {
    const boundary = boundaryOpeningIndex(value);
    const withoutBoundary = `${value.slice(0, boundary)}${value.slice(boundary + 1)}`;
    return insertBeforeTrailing(withoutBoundary, ')', TRAILING_BOUNDARY_RE);
  }
  if (direction === 'closing') {
    const boundary = boundaryClosingIndex(value);
    const withoutBoundary = `${value.slice(0, boundary)}${value.slice(boundary + 1)}`;
    const prefix = withoutBoundary.match(OPENING_DECORATION_RE)?.[0] || '';
    return `${prefix}(${withoutBoundary.slice(prefix.length)}`;
  }
  return value;
}

export function repairLegacyArabicCueLine(value) {
  const clean = String(value || '').trimEnd();
  return repairLegacyRoundBrackets(relocateLegacyLeadingTerminal(clean));
}

export function repairLegacyArabicSrt(text) {
  const source = String(text || '').replace(/\r\n?/gu, '\n');
  if (!hasLegacyArabicBracketLayout(source)) return source;

  return source
    .split(/(\n{2,})/u)
    .map(part => {
      if (/^\n{2,}$/u.test(part)) return part;
      const lines = part.split('\n');
      const timeIndex = lines.findIndex(line => /\d{2,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}/u.test(line));
      if (timeIndex === -1) return part;
      return lines
        .map((line, index) => index > timeIndex ? repairLegacyArabicCueLine(line) : line)
        .join('\n');
    })
    .join('');
}
