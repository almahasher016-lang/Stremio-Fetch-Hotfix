const CP1256 = new Map(Object.entries({
  128: '€', 129: 'پ', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡',
  136: 'ˆ', 137: '‰', 138: 'ٹ', 139: '‹', 140: 'Œ', 141: 'چ', 142: 'ژ', 143: 'ڈ',
  144: 'گ', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—',
  152: 'ک', 153: '™', 154: 'ڑ', 155: '›', 156: 'œ', 157: '‌', 158: '‍', 159: 'ں',
  160: '\u00A0', 161: '،', 162: '¢', 163: '£', 164: '¤', 165: '¥', 166: '¦', 167: '§',
  168: '¨', 169: '©', 170: 'ھ', 171: '«', 172: '¬', 173: '\u00AD', 174: '®', 175: '¯',
  176: '°', 177: '±', 178: '²', 179: '³', 180: '´', 181: 'µ', 182: '¶', 183: '·',
  184: '¸', 185: '¹', 186: '؛', 187: '»', 188: '¼', 189: '½', 190: '¾', 191: '؟',
  192: 'ہ', 193: 'ء', 194: 'آ', 195: 'أ', 196: 'ؤ', 197: 'إ', 198: 'ئ', 199: 'ا',
  200: 'ب', 201: 'ة', 202: 'ت', 203: 'ث', 204: 'ج', 205: 'ح', 206: 'خ', 207: 'د',
  208: 'ذ', 209: 'ر', 210: 'ز', 211: 'س', 212: 'ش', 213: 'ص', 214: 'ض', 215: '×',
  216: 'ط', 217: 'ظ', 218: 'ع', 219: 'غ', 220: 'ـ', 221: 'ف', 222: 'ق', 223: 'ك',
  224: 'à', 225: 'ل', 226: 'â', 227: 'م', 228: 'ن', 229: 'ه', 230: 'و', 231: 'ç',
  232: 'è', 233: 'é', 234: 'ê', 235: 'ë', 236: 'ى', 237: 'ي', 238: 'î', 239: 'ï',
  240: 'ً', 241: 'ٌ', 242: 'ٍ', 243: 'َ', 244: 'ُ', 245: 'ِ', 246: '÷', 247: 'ّ',
  248: 'ْ', 249: 'ù', 250: 'ú', 251: 'û', 252: 'ü', 253: 'ے', 254: '‍', 255: 'ی'
}).map(([k, v]) => [Number(k), v]));

const BIDI_CONTROL_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const LETTER_RE = /\p{L}/u;
const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/u;
const TERMINAL_NEUTRAL_RE = /[\p{P}\p{S}]$/u;
const RIGHT_TO_LEFT_ISOLATE = '\u2067';
const RIGHT_TO_LEFT_MARK = '\u200F';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

function decodeCp1256(buffer) {
  let output = '';
  for (const byte of buffer) {
    if (byte < 128) output += String.fromCharCode(byte);
    else output += CP1256.get(byte) || String.fromCharCode(byte);
  }
  return output;
}

function replacementRatio(text) {
  if (!text) return 1;
  const count = (text.match(/�/g) || []).length;
  return count / Math.max(1, text.length);
}

function decodeUtf16Be(bytes, offset = 0) {
  const length = bytes.length - offset - ((bytes.length - offset) % 2);
  const swapped = Buffer.alloc(length);
  for (let index = 0; index < length; index += 2) {
    swapped[index] = bytes[offset + index + 1];
    swapped[index + 1] = bytes[offset + index];
  }
  return swapped.toString('utf16le');
}

function detectBomlessUtf16(bytes) {
  const sampleLength = Math.min(bytes.length - (bytes.length % 2), 8_192);
  if (sampleLength < 16) return null;
  const pairs = sampleLength / 2;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenZeros += 1;
    if (bytes[index + 1] === 0) oddZeros += 1;
  }
  const threshold = Math.max(4, Math.floor(pairs * 0.18));
  if (oddZeros >= threshold && oddZeros >= Math.max(1, evenZeros) * 3) return 'utf-16le';
  if (evenZeros >= threshold && evenZeros >= Math.max(1, oddZeros) * 3) return 'utf-16be';
  return null;
}

export function decodeSubtitleBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.slice(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.slice(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16Be(bytes, 2), encoding: 'utf-16be' };
  }

  const bomlessUtf16 = detectBomlessUtf16(bytes);
  if (bomlessUtf16 === 'utf-16le') {
    return { text: bytes.subarray(0, bytes.length - (bytes.length % 2)).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (bomlessUtf16 === 'utf-16be') {
    return { text: decodeUtf16Be(bytes), encoding: 'utf-16be' };
  }

  const utf8 = bytes.toString('utf8');
  if (replacementRatio(utf8) < 0.005) return { text: utf8, encoding: 'utf-8' };

  const cp = decodeCp1256(bytes);
  return { text: cp, encoding: 'windows-1256' };
}

function stripControlMarks(text) {
  return String(text || '').replace(BIDI_CONTROL_RE, '');
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

function isolateArabicLine(line) {
  const clean = stripControlMarks(line).trimEnd();
  if (!arabicDominatesLine(clean)) return clean;
  const compatibilityMark = TERMINAL_NEUTRAL_RE.test(clean) ? RIGHT_TO_LEFT_MARK : '';
  return `${RIGHT_TO_LEFT_ISOLATE}${clean}${compatibilityMark}${POP_DIRECTIONAL_ISOLATE}`;
}

function stripTags(line) {
  return line
    .replace(/\{\\[^}]+}/g, '')
    .replace(/<\/?(?:i|b|u|font|c|ruby|rt|v|lang)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+$/g, '');
}

function stripSdhLines(text, options = {}) {
  const stripMusic = options.stripMusicNotes !== false;
  const stripSdh = Boolean(options.stripSdh);
  return text.split('\n').filter(line => {
    const l = line.trim();
    if (!l) return true;
    if (stripMusic && /^[♪♫]+|[♪♫]+$/.test(l)) return false;
    if (stripSdh && /^\[[^\]]{1,80}]$/.test(l)) return false;
    if (stripSdh && /^\([^)]{1,80}\)$/.test(l)) return false;
    return true;
  }).join('\n');
}

export function vttToSrt(text) {
  const input = String(text || '').replace(/^WEBVTT[^\n]*(\n|$)/i, '').replace(/\r/g, '');
  const blocks = input
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .filter(block => !/^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(block));
  const output = [];
  let index = 1;

  function timestamp(value) {
    const match = String(value || '').trim().match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{3})$/);
    if (!match) return null;
    const hours = match[1] === undefined ? '00' : match[1].padStart(2, '0');
    return `${hours}:${match[2]}:${match[3]},${match[4]}`;
  }

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(l => /-->/.test(l));
    if (timeIndex === -1) continue;
    const timing = lines[timeIndex].match(/^(\S+)\s*-->\s*(\S+)/);
    const start = timestamp(timing?.[1]);
    const end = timestamp(timing?.[2]);
    if (!start || !end) continue;
    output.push(String(index++));
    output.push(`${start} --> ${end}`);
    output.push(...lines.slice(timeIndex + 1));
    output.push('');
  }
  return output.join('\n');
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

function assTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) return null;
  const milliseconds = match[4].padEnd(3, '0').slice(0, 3);
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]},${milliseconds}`;
}

export function assToSrt(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const defaultFormat = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  let format = defaultFormat;
  let inEvents = false;
  let index = 1;
  const output = [];

  for (const rawLine of lines) {
    const section = rawLine.trim().match(/^\[([^\]]+)]$/);
    if (section) {
      inEvents = section[1].trim().toLowerCase() === 'events';
      continue;
    }
    if (!inEvents) continue;

    const formatMatch = rawLine.match(/^\s*Format\s*:\s*(.+)$/i);
    if (formatMatch) {
      const fields = formatMatch[1].split(',').map(field => field.trim().toLowerCase()).filter(Boolean);
      if (fields.includes('start') && fields.includes('end') && fields.includes('text')) format = fields;
      continue;
    }

    const dialogue = rawLine.match(/^\s*Dialogue\s*:\s*(.*)$/i);
    if (!dialogue) continue;
    const values = splitAssFields(dialogue[1], format.length);
    if (!values.length) continue;
    const start = assTimestamp(values[format.indexOf('start')]);
    const end = assTimestamp(values[format.indexOf('end')]);
    let cueText = values[format.indexOf('text')] || '';
    if (!start || !end || !cueText.trim()) continue;
    if (/\{\\p[1-9]\}/i.test(cueText) && !/\{\\p0\}/i.test(cueText)) continue;
    cueText = cueText.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
    output.push(String(index++), `${start} --> ${end}`, cueText, '');
  }
  return output.join('\n');
}

export function normalizeSrtIndexes(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const output = [];
  let index = 1;
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trimEnd());
    const timeIndex = lines.findIndex(line => /\d{2,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}/.test(line));
    if (timeIndex === -1) continue;
    output.push(String(index++));
    output.push(lines[timeIndex].replace(/(\d{2}:\d{2})\.(\d{3})/g, '$1,$2'));
    output.push(...lines.slice(timeIndex + 1));
    output.push('');
  }
  return output.join('\n').trim() + '\n';
}

export function applyArabicSubtitleDirection(text) {
  const blocks = String(text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
  const output = blocks.map(block => {
    const lines = block.split('\n');
    const timeIndex = lines.findIndex(line => /\d{2,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2}[,.]\d{3}/.test(line));
    if (timeIndex === -1) return block;
    return lines
      .map((line, index) => index > timeIndex ? isolateArabicLine(line) : line)
      .join('\n')
      .trimEnd();
  }).join('\n\n');
  return output ? `${output}\n` : '';
}

export function processSubtitleBuffer(buffer, options = {}) {
  const decoded = decodeSubtitleBuffer(buffer);
  let text = stripControlMarks(decoded.text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isAss = /^\s*\[(?:Script Info|Events)]/im.test(text) && /^\s*Dialogue\s*:/im.test(text);
  const isVtt = !isAss && (/^\s*WEBVTT/i.test(text) || /(?:^|\n)(?:\d{1,3}:)?\d{2}:\d{2}\.\d{3}\s*-->/.test(text));
  if (isAss) text = assToSrt(text);
  else if (isVtt) text = vttToSrt(text);
  text = text.split('\n').map(stripTags).join('\n');
  text = stripSdhLines(text, options);
  text = normalizeSrtIndexes(text);
  text = applyArabicSubtitleDirection(text);
  return { text, encoding: decoded.encoding, format: isAss ? 'ass' : isVtt ? 'vtt' : 'srt' };
}
