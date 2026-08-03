import { stabilizeArabicCueLine, stripBidiControls } from './arabicBidi.js';
import { repairLegacyArabicSrt } from './legacyArabicSrt.js';
import { decodeSubtitleBuffer, normalizeArabicPresentationForms } from './subtitleEncoding.js';
import { cleanSubtitleMarkup } from './subtitleMarkup.js';
import { convertTextSubtitleToSrt, detectSubtitleFormat } from './subtitleFormats.js';
import { msToTime, parseSrtTimingLine, timeToMs } from './subtitleTiming.js';

export { decodeSubtitleBuffer } from './subtitleEncoding.js';

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
    const milliseconds = timeToMs(value);
    return milliseconds === null ? null : msToTime(milliseconds);
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

function removeAssDrawingRuns(value) {
  let drawing = false;
  return String(value || '').split(/(\{[^}]*\})/g).map(token => {
    if (!token.startsWith('{')) return drawing ? '' : token;
    for (const match of token.matchAll(/\\p(-?\d+(?:\.\d+)?)/gi)) drawing = Number(match[1]) !== 0;
    return token;
  }).join('');
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
    cueText = removeAssDrawingRuns(cueText).replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
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
    const timeIndex = lines.findIndex(line => parseSrtTimingLine(line));
    if (timeIndex === -1) continue;
    const timing = parseSrtTimingLine(lines[timeIndex]);
    output.push(String(index++));
    output.push(`${timing.start} --> ${timing.end}`);
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
    const timeIndex = lines.findIndex(line => parseSrtTimingLine(line));
    if (timeIndex === -1) return block;
    return lines
      .map((line, index) => index > timeIndex ? stabilizeArabicCueLine(line) : line)
      .join('\n')
      .trimEnd();
  }).join('\n\n');
  return output ? `${output}\n` : '';
}

export function processSubtitleBuffer(buffer, options = {}) {
  const decoded = decodeSubtitleBuffer(buffer, options);
  let text = stripBidiControls(decoded.text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const detectedFormat = detectSubtitleFormat(text);
  const converted = convertTextSubtitleToSrt(text, options);
  if (detectedFormat === 'ass') text = assToSrt(text);
  else if (detectedFormat === 'vtt') text = vttToSrt(text);
  else if (converted.handled) text = converted.text;
  text = stripBidiControls(cleanSubtitleMarkup(normalizeArabicPresentationForms(text))).replace(/[ \t]{2,}/g, ' ');
  text = stripSdhLines(text, options);
  text = normalizeSrtIndexes(text);
  text = repairLegacyArabicSrt(text);
  text = applyArabicSubtitleDirection(text);
  return { text, encoding: decoded.encoding, format: detectedFormat === 'unknown' ? 'srt' : detectedFormat };
}
