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

export function decodeSubtitleBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.slice(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.slice(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let i = 2; i < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1] || 0;
      swapped[i - 1] = bytes[i];
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
  }

  const utf8 = bytes.toString('utf8');
  if (replacementRatio(utf8) < 0.005) return { text: utf8, encoding: 'utf-8' };

  const cp = decodeCp1256(bytes);
  return { text: cp, encoding: 'windows-1256' };
}

function stripControlMarks(text) {
  return text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
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
  let input = String(text || '').replace(/^WEBVTT[^\n]*(\n|$)/i, '').replace(/\r/g, '');
  input = input.replace(/^NOTE[\s\S]*?(?:\n\n|$)/gmi, '');
  input = input.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
  const blocks = input.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const output = [];
  let index = 1;
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(l => /-->/.test(l));
    if (timeIndex === -1) continue;
    output.push(String(index++));
    output.push(lines[timeIndex].replace(/\s+(align|position|line|size):[^\s]+/g, ''));
    output.push(...lines.slice(timeIndex + 1));
    output.push('');
  }
  return output.join('\n');
}

export function normalizeSrtIndexes(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const output = [];
  let index = 1;
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trimEnd());
    const timeIndex = lines.findIndex(line => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line));
    if (timeIndex === -1) continue;
    output.push(String(index++));
    output.push(lines[timeIndex].replace(/\./g, ','));
    output.push(...lines.slice(timeIndex + 1).filter(l => !/^\d+$/.test(l) || lines.length <= 2));
    output.push('');
  }
  return output.join('\n').trim() + '\n';
}

export function processSubtitleBuffer(buffer, options = {}) {
  const decoded = decodeSubtitleBuffer(buffer);
  let text = stripControlMarks(decoded.text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isVtt = /^\s*WEBVTT/i.test(text) || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(text);
  if (isVtt) text = vttToSrt(text);
  text = text.split('\n').map(stripTags).join('\n');
  text = stripSdhLines(text, options);
  text = normalizeSrtIndexes(text);
  return { text, encoding: decoded.encoding, format: isVtt ? 'vtt' : 'srt' };
}
