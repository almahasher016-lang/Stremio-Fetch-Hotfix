import { stabilizeArabicCueLine, stripBidiControls } from './arabicBidi.js';

const ASS_TEXT_TOKEN_RE = /(\{[^}]*\}|<\/?[^>]+>)/gu;
const DRAWING_MODE_RE = /\\p(-?\d+(?:\.\d+)?)/giu;
const VISUAL_LINE_BREAK_RE = /(\\[Nn])/gu;
const DEFAULT_EVENT_FORMAT = [
  'layer',
  'start',
  'end',
  'style',
  'name',
  'marginl',
  'marginr',
  'marginv',
  'effect',
  'text',
];

function isOverrideOrHtmlTag(value) {
  return value.startsWith('{') || value.startsWith('<');
}

function tokenizeTextRun(value) {
  return String(value || '')
    .split(ASS_TEXT_TOKEN_RE)
    .filter(Boolean)
    .map(token => ({
      tag: isOverrideOrHtmlTag(token),
      value: isOverrideOrHtmlTag(token) ? token : stripBidiControls(token),
    }));
}

function visibleText(tokens) {
  return tokens
    .filter(token => !token.tag)
    .map(token => token.value.replace(/\\h/giu, ' '))
    .join('');
}

function directionalBoundaries(value) {
  const clean = stripBidiControls(value).trimEnd();
  const stabilized = stabilizeArabicCueLine(value);
  if (stabilized === clean) return { prefix: '', suffix: '' };
  return {
    prefix: stabilized.match(/^[\u200F\u2067]+/u)?.[0] || '',
    suffix: stabilized.match(/[\u200F\u2069]+$/u)?.[0] || '',
  };
}

function firstTextPosition(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].tag) continue;
    const offset = tokens[index].value.search(/\S/u);
    if (offset !== -1) return { index, offset };
  }
  return null;
}

function lastTextPosition(tokens) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].tag) continue;
    const trailingWhitespace = tokens[index].value.match(/\s*$/u)?.[0].length || 0;
    const offset = tokens[index].value.length - trailingWhitespace;
    if (offset > 0) return { index, offset };
  }
  return null;
}

function stabilizeTextRun(value) {
  const tokens = tokenizeTextRun(value);
  const boundaries = directionalBoundaries(visibleText(tokens));
  if (!boundaries.prefix && !boundaries.suffix) return tokens.map(token => token.value).join('');

  const first = firstTextPosition(tokens);
  const last = lastTextPosition(tokens);
  if (!first || !last) return tokens.map(token => token.value).join('');

  if (boundaries.suffix) {
    const token = tokens[last.index];
    token.value = `${token.value.slice(0, last.offset)}${boundaries.suffix}${token.value.slice(last.offset)}`;
  }
  if (boundaries.prefix) {
    const token = tokens[first.index];
    token.value = `${token.value.slice(0, first.offset)}${boundaries.prefix}${token.value.slice(first.offset)}`;
  }
  return tokens.map(token => token.value).join('');
}

function drawingModeAfterTag(tag, currentMode) {
  let drawingMode = currentMode;
  for (const match of String(tag || '').matchAll(DRAWING_MODE_RE)) {
    drawingMode = Number(match[1]) !== 0;
  }
  return drawingMode;
}

function stabilizeVisualLine(value, initialDrawingMode = false) {
  const tokens = String(value || '').split(ASS_TEXT_TOKEN_RE).filter(Boolean);
  let drawingMode = initialDrawingMode;
  let textRun = '';
  let output = '';

  const flushTextRun = () => {
    if (!textRun) return;
    output += stabilizeTextRun(textRun);
    textRun = '';
  };

  for (const token of tokens) {
    if (token.startsWith('{')) {
      const nextDrawingMode = drawingModeAfterTag(token, drawingMode);
      if (nextDrawingMode !== drawingMode) {
        if (!drawingMode) flushTextRun();
        output += token;
        drawingMode = nextDrawingMode;
        continue;
      }
    }

    if (drawingMode) output += token;
    else textRun += token;
  }

  flushTextRun();
  return { text: output, drawingMode };
}

export function stabilizeArabicAssDialogueText(value) {
  const parts = String(value || '').split(VISUAL_LINE_BREAK_RE);
  let drawingMode = false;
  return parts.map(part => {
    if (/^\\[Nn]$/u.test(part)) return part;
    const stabilized = stabilizeVisualLine(part, drawingMode);
    drawingMode = stabilized.drawingMode;
    return stabilized.text;
  }).join('');
}

function splitAssFields(value, count) {
  const fields = [];
  let remaining = String(value || '');
  for (let index = 0; index < count - 1; index += 1) {
    const comma = remaining.indexOf(',');
    if (comma === -1) return [];
    fields.push(remaining.slice(0, comma));
    remaining = remaining.slice(comma + 1);
  }
  fields.push(remaining);
  return fields;
}

export function stabilizeArabicStyledSubtitle(text) {
  const lines = String(text || '').replace(/\r\n?/gu, '\n').split('\n');
  let eventFormat = DEFAULT_EVENT_FORMAT;
  let inEvents = false;

  return lines.map(rawLine => {
    const section = rawLine.trim().match(/^\[([^\u005D]+)\]$/u);
    if (section) {
      inEvents = section[1].trim().toLowerCase() === 'events';
      if (inEvents) eventFormat = DEFAULT_EVENT_FORMAT;
      return rawLine;
    }
    if (!inEvents) return rawLine;

    const formatMatch = rawLine.match(/^\s*Format\s*:\s*(.+)$/iu);
    if (formatMatch) {
      const fields = formatMatch[1]
        .split(',')
        .map(field => field.trim().toLowerCase())
        .filter(Boolean);
      eventFormat = fields.includes('text') ? fields : null;
      return rawLine;
    }

    const dialogue = rawLine.match(/^(\s*Dialogue\s*:\s*)(.*)$/iu);
    if (!dialogue) return rawLine;
    if (!eventFormat) return rawLine;
    const values = splitAssFields(dialogue[2], eventFormat.length);
    const textIndex = eventFormat.indexOf('text');
    if (!values.length || textIndex === -1) return rawLine;

    values[textIndex] = stabilizeArabicAssDialogueText(values[textIndex]);
    return `${dialogue[1]}${values.join(',')}`;
  }).join('\n');
}
