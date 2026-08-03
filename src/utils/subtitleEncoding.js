import iconv from 'iconv-lite';

const ARABIC_SCRIPT_RE = /\p{Script_Extensions=Arabic}/gu;
const ARABIC_BASE_RE = /[\u0621-\u063A\u0641-\u064A\u066E-\u06D3]/gu;
const ARABIC_MARK_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const LATIN_MOJIBAKE_RE = /[À-ÖØ-öø-ÿ]/g;
const SUBTITLE_STRUCTURE_RE = /(?:\d{1,3}:)?\d{1,2}:\d{2}(?::\d{2})?[,.]\d+|Dialogue\s*:|<p\b|<sync\b|\{\d+\}\{\d+\}|\[\d+\]\[\d+\]/giu;

// Unicode's published Mac OS Arabic mapping, excluding direction overrides.
const MAC_ARABIC_HIGH = [
  'Ä', '\u00A0', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á', 'à', 'â', 'ä', 'ں', '«', 'ç', 'é', 'è',
  'ê', 'ë', 'í', '…', 'î', 'ï', 'ñ', 'ó', '»', 'ô', 'ö', '÷', 'ú', 'ù', 'û', 'ü',
  ' ', '!', '"', '#', '$', '٪', '&', "'", '(', ')', '*', '+', '،', '-', '.', '/',
  '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', ':', '؛', '<', '=', '>', '؟',
  '❊', 'ء', 'آ', 'أ', 'ؤ', 'إ', 'ئ', 'ا', 'ب', 'ة', 'ت', 'ث', 'ج', 'ح', 'خ', 'د',
  'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', '[', '\\', ']', '^', '_',
  'ـ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ى', 'ي', 'ً', 'ٌ', 'ٍ', 'َ', 'ُ',
  'ِ', 'ّ', 'ْ', 'پ', 'ٹ', 'چ', 'ە', 'ڤ', 'گ', 'ڈ', 'ڑ', '{', '|', '}', 'ژ', 'ے',
];

function decodeMacArabic(bytes) {
  let output = '';
  for (const byte of bytes) output += byte < 0x80 ? String.fromCharCode(byte) : MAC_ARABIC_HIGH[byte - 0x80];
  return output;
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

function decodeUtf32(bytes, littleEndian, offset = 0) {
  const end = bytes.length - ((bytes.length - offset) % 4);
  let output = '';
  for (let index = offset; index < end; index += 4) {
    const code = littleEndian ? bytes.readUInt32LE(index) : bytes.readUInt32BE(index);
    output += code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  }
  return output;
}

function detectBomlessUtf32(bytes) {
  const sampleLength = Math.min(bytes.length - (bytes.length % 4), 8_192);
  if (sampleLength < 32) return null;
  const groups = sampleLength / 4;
  const zeros = [0, 0, 0, 0];
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) zeros[index % 4] += 1;
  }
  const high = groups * 0.85;
  const low = groups * 0.35;
  if (zeros[2] >= high && zeros[3] >= high && zeros[0] <= low) return 'utf-32le';
  if (zeros[0] >= high && zeros[1] >= high && zeros[3] <= low) return 'utf-32be';
  return null;
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

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function normalizedEncodingHint(value) {
  const hint = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  if (/^(?:windows-|win|cp)?1256$/.test(hint)) return 'windows-1256';
  if (/^(?:iso-?)?8859-?6$/.test(hint) || hint === 'arabic') return 'iso-8859-6';
  if (/^(?:ibm|cp)?-?864$/.test(hint)) return 'cp864';
  if (/^(?:ibm|dos|cp)?-?720$/.test(hint)) return 'cp720';
  if (/^(?:x-)?mac-?arabic$/.test(hint)) return 'mac-arabic';
  if (/^utf-?8$/.test(hint)) return 'utf-8';
  if (/^utf-?16le$/.test(hint)) return 'utf-16le';
  if (/^utf-?16be$/.test(hint)) return 'utf-16be';
  if (/^utf-?32le$/.test(hint)) return 'utf-32le';
  if (/^utf-?32be$/.test(hint)) return 'utf-32be';
  return null;
}

function decodeLegacy(bytes, encoding) {
  if (encoding === 'mac-arabic') return decodeMacArabic(bytes);
  return normalizeArabicPresentationForms(iconv.decode(bytes, encoding));
}

export function normalizeArabicPresentationForms(value) {
  return String(value || '').replace(/[\uFB50-\uFDFF\uFE70-\uFEFC]+/gu, run => run.normalize('NFKC'));
}

function candidateScore(text, preference) {
  const source = String(text || '');
  const value = source.length <= 320_000
    ? source
    : `${source.slice(0, 128_000)}${source.slice(Math.floor(source.length / 2) - 32_000, Math.floor(source.length / 2) + 32_000)}${source.slice(-128_000)}`;
  const arabic = (value.match(ARABIC_SCRIPT_RE) || []).length;
  const bases = (value.match(ARABIC_BASE_RE) || []).length;
  const marks = (value.match(ARABIC_MARK_RE) || []).length;
  const letters = (value.match(/\p{L}/gu) || []).length;
  const mojibake = (value.match(LATIN_MOJIBAKE_RE) || []).length;
  const replacements = (value.match(/�/g) || []).length;
  const controls = [...value].filter(character => {
    const code = character.codePointAt(0);
    return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
  }).length;
  const structure = (value.match(SUBTITLE_STRUCTURE_RE) || []).length;
  const common = (value.match(/(?<!\p{L})(?:من|في|على|هذا|هذه|لا|ما|أنا|أنت|هو|هي|كان|إلى|مرحبا|أهلا|ترجمة|عربية|بك|ربما)(?!\p{L})/gu) || []).length;
  return bases * 4 + arabic * 1.5 + common * 12 + Math.min(80, structure * 5)
    + (arabic / Math.max(1, letters)) * 60 - marks * 0.4 - mojibake * 5 - replacements * 20 - controls * 14 + preference;
}

function decodeHinted(bytes, hint) {
  if (hint === 'utf-8') return bytes.toString('utf8');
  if (hint === 'utf-16le') return bytes.subarray(0, bytes.length - (bytes.length % 2)).toString('utf16le');
  if (hint === 'utf-16be') return decodeUtf16Be(bytes);
  if (hint === 'utf-32le') return decodeUtf32(bytes, true);
  if (hint === 'utf-32be') return decodeUtf32(bytes, false);
  return decodeLegacy(bytes, hint);
}

export function decodeSubtitleBuffer(buffer, options = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.slice(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return { text: decodeUtf32(bytes, true, 4), encoding: 'utf-32le' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) {
    return { text: decodeUtf32(bytes, false, 4), encoding: 'utf-32be' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.slice(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16Be(bytes, 2), encoding: 'utf-16be' };
  }

  const bomlessUtf32 = detectBomlessUtf32(bytes);
  if (bomlessUtf32 === 'utf-32le') return { text: decodeUtf32(bytes, true), encoding: bomlessUtf32 };
  if (bomlessUtf32 === 'utf-32be') return { text: decodeUtf32(bytes, false), encoding: bomlessUtf32 };

  const bomlessUtf16 = detectBomlessUtf16(bytes);
  if (bomlessUtf16 === 'utf-16le') {
    return { text: bytes.subarray(0, bytes.length - (bytes.length % 2)).toString('utf16le'), encoding: bomlessUtf16 };
  }
  if (bomlessUtf16 === 'utf-16be') return { text: decodeUtf16Be(bytes), encoding: bomlessUtf16 };

  const hint = normalizedEncodingHint(options.encodingHint);
  if (hint) return { text: decodeHinted(bytes, hint), encoding: hint };
  if (isValidUtf8(bytes)) return { text: bytes.toString('utf8'), encoding: 'utf-8' };

  const candidates = [
    { encoding: 'windows-1256', preference: 3 },
    { encoding: 'iso-8859-6', preference: 2 },
    { encoding: 'cp864', preference: 1 },
    { encoding: 'cp720', preference: 0.5 },
    { encoding: 'mac-arabic', preference: 0 },
  ];
  let best = null;
  for (const candidate of candidates) {
    const text = decodeLegacy(bytes, candidate.encoding);
    const decoded = { ...candidate, text, score: candidateScore(text, candidate.preference) };
    if (!best || decoded.score > best.score) best = decoded;
  }
  return { text: best.text, encoding: best.encoding };
}
