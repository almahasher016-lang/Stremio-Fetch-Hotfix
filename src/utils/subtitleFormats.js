import { SaxesParser } from 'saxes';
import { decodeHTML } from 'entities';
import { msToTime, timeToMs } from './subtitleTiming.js';

const XML_DECLARATION_RE = /<!DOCTYPE|<!ENTITY/i;
const ARABIC_RE = /\p{Script_Extensions=Arabic}/gu;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cueText(value) {
  return decodeHTML(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\\[Nn]|\|/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function cuesToSrt(cues) {
  const ordered = cues
    .filter(cue => Number.isFinite(cue.startMs) && cueText(cue.text))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .map((cue, index, values) => ({
      ...cue,
      endMs: Number.isFinite(cue.endMs)
        ? cue.endMs
        : (values[index + 1]?.startMs > cue.startMs ? values[index + 1].startMs : cue.startMs + 4_000),
    }));
  return ordered
    .filter(cue => cue.endMs > cue.startMs)
    .map((cue, index) => `${index + 1}\n${msToTime(cue.startMs)} --> ${msToTime(cue.endMs)}\n${cueText(cue.text)}`)
    .join('\n\n');
}

function attrValues(node) {
  return Object.fromEntries(Object.entries(node?.attributes || {}).map(([name, value]) => [
    name.split(':').at(-1).toLowerCase(),
    typeof value === 'object' ? value.value : value,
  ]));
}

function localName(value) {
  return String(typeof value === 'object' ? value.name : value || '').split(':').at(-1).toLowerCase();
}

function parseTtmlTime(value, rates = {}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const offset = text.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/i);
  if (offset) {
    const amount = Number(offset[1]);
    const unit = offset[2].toLowerCase();
    const scale = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1, f: 1_000 / rates.frameRate, t: 1_000 / rates.tickRate }[unit];
    return Number.isFinite(scale) ? amount * scale : null;
  }
  const clock = text.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:[.](\d+)|:(\d{1,3})(?:[.](\d+))?)?$/);
  if (!clock) return null;
  const base = (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000;
  if (clock[4] !== undefined) return base + Number(`0.${clock[4]}`) * 1000;
  if (clock[5] !== undefined) {
    const frames = Number(clock[5]) + Number(`0.${clock[6] || '0'}`) / rates.subFrameRate;
    return base + frames * 1000 / rates.frameRate;
  }
  return base;
}

export function ttmlToSrt(text) {
  if (XML_DECLARATION_RE.test(text)) return '';
  const cues = [];
  const stack = [];
  const rates = { frameRate: 30, subFrameRate: 1, tickRate: 1 };
  let activeCue = null;
  const parser = new SaxesParser({ xmlns: false, fragment: false });
  parser.on('opentag', node => {
    const name = localName(node);
    const attrs = attrValues(node);
    if (name === 'tt') {
      const multiplier = String(attrs.frameratemultiplier || '1 1').trim().split(/\s+/).map(Number);
      const multiplierValue = multiplier.length === 2 && multiplier[0] > 0 && multiplier[1] > 0
        ? multiplier[0] / multiplier[1] : 1;
      rates.frameRate = positiveNumber(attrs.framerate, 30) * multiplierValue;
      rates.subFrameRate = positiveNumber(attrs.subframerate, 1);
      rates.tickRate = positiveNumber(attrs.tickrate, rates.frameRate * rates.subFrameRate);
    }
    const parent = stack.at(-1) || { beginMs: 0, endMs: null };
    const ownBegin = parseTtmlTime(attrs.begin, rates);
    const parentBegin = parent.beginMs ?? 0;
    const beginMs = ownBegin === null ? parentBegin : parentBegin + ownBegin;
    const ownEnd = parseTtmlTime(attrs.end, rates);
    const duration = parseTtmlTime(attrs.dur, rates);
    const endMs = ownEnd === null
      ? (duration === null ? parent.endMs : beginMs + duration)
      : parentBegin + ownEnd;
    const frame = { name, beginMs, endMs };
    stack.push(frame);
    if (name === 'p') {
      activeCue = { startMs: beginMs, endMs, text: '' };
      cues.push(activeCue);
    } else if (name === 'br' && activeCue) activeCue.text += '\n';
  });
  parser.on('text', value => {
    if (activeCue) activeCue.text += value;
  });
  parser.on('cdata', value => {
    if (activeCue) activeCue.text += value;
  });
  parser.on('closetag', tag => {
    if (localName(tag) === 'p') activeCue = null;
    stack.pop();
  });
  try {
    parser.write(String(text || '')).close();
  } catch {
    return '';
  }
  return cuesToSrt(cues);
}

export function youtubeXmlToSrt(text) {
  if (XML_DECLARATION_RE.test(text)) return '';
  const cues = [];
  let current = null;
  const parser = new SaxesParser({ xmlns: false, fragment: false });
  parser.on('opentag', node => {
    if (localName(node) !== 'text') return;
    const attrs = attrValues(node);
    const startMs = Number(attrs.start) * 1000;
    const durationMs = Number(attrs.dur) * 1000;
    current = { startMs, endMs: startMs + durationMs, text: '' };
    cues.push(current);
  });
  parser.on('text', value => {
    if (current) current.text += value;
  });
  parser.on('closetag', tag => {
    if (localName(tag) === 'text') current = null;
  });
  try {
    parser.write(String(text || '')).close();
  } catch {
    return '';
  }
  return cuesToSrt(cues);
}

export function samiToSrt(text) {
  const matches = [...String(text || '').matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+(?:\.\d+)?)["']?[^>]*>([\s\S]*?)(?=<sync\b|<\/body|<\/sami|$)/gi)];
  const starts = matches.map(match => Number(match[1]));
  const cues = matches.map((match, index) => {
    const alternatives = [...match[2].matchAll(/<p\b[^>]*>([\s\S]*?)(?=<p\b|$)/gi)].map(item => cueText(item[1]));
    const candidates = alternatives.length ? alternatives : [cueText(match[2])];
    const selected = candidates.sort((left, right) => (right.match(ARABIC_RE) || []).length - (left.match(ARABIC_RE) || []).length)[0];
    return { startMs: starts[index], endMs: starts[index + 1] ?? starts[index] + 4_000, text: selected };
  });
  return cuesToSrt(cues);
}

export function microDvdToSrt(text, frameRate = null) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let fps = Number(frameRate);
  const header = lines.map(line => line.match(/^\{([01])\}\{\1\}(\d+(?:\.\d+)?)\s*$/)).find(Boolean);
  if (header) fps = Number(header[2]);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) return '';
  const cues = [];
  for (const line of lines) {
    const match = line.match(/^\{(\d+)\}\{(\d+)\}([\s\S]*)$/);
    if (!match || (['0', '1'].includes(match[1])) && match[1] === match[2] && /^\d+(?:\.\d+)?$/.test(match[3].trim())) continue;
    cues.push({
      startMs: Number(match[1]) * 1000 / fps,
      endMs: Number(match[2]) * 1000 / fps,
      text: match[3].replace(/\{[YyFfSsCcPp]:[^}]*\}/g, ''),
    });
  }
  return cuesToSrt(cues);
}

export function mpl2ToSrt(text) {
  const cues = [...String(text || '').matchAll(/^\[(\d+)\]\[(\d+)\]([\s\S]*?)$/gm)].map(match => ({
    startMs: Number(match[1]) * 100,
    endMs: Number(match[2]) * 100,
    text: match[3].replace(/(^|\|)\//g, '$1'),
  }));
  return cuesToSrt(cues);
}

export function subViewerToSrt(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const cues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index].match(/^\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d+)\s*,\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d+)\s*$/);
    if (!timing) continue;
    const content = [];
    while (++index < lines.length && lines[index].trim()) content.push(lines[index]);
    cues.push({ startMs: timeToMs(timing[1]), endMs: timeToMs(timing[2]), text: content.join('\n') });
  }
  return cuesToSrt(cues);
}

export function lrcToSrt(text) {
  const entries = [];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = line.replace(/\[[^\]]+\]/g, '').trim();
    for (const stamp of stamps) {
      const fraction = (stamp[3] || '0').padEnd(3, '0').slice(0, 3);
      entries.push({ startMs: (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + Number(fraction), text: content });
    }
  }
  entries.sort((left, right) => left.startMs - right.startMs);
  return cuesToSrt(entries.map((entry, index) => ({
    ...entry,
    endMs: entries[index + 1]?.startMs ?? entry.startMs + 4_000,
  })));
}

export function realTextToSrt(text) {
  const cues = [...String(text || '').matchAll(/<time\b([^>]*)>([\s\S]*?)(?=<time\b|<\/window|$)/gi)].map(match => {
    const begin = match[1].match(/\bbegin\s*=\s*["']([^"']+)["']/i)?.[1];
    const end = match[1].match(/\bend\s*=\s*["']([^"']+)["']/i)?.[1];
    const realTime = value => timeToMs(value) ?? (/^\d+(?:\.\d+)?$/.test(value || '') ? Number(value) * 1000 : null);
    return { startMs: realTime(begin), endMs: realTime(end), text: match[2] };
  });
  return cuesToSrt(cues);
}

export function detectSubtitleFormat(text, options = {}) {
  const value = String(text || '');
  if (/^\s*\[(?:Script Info|Events)]/im.test(value) && /^\s*Dialogue\s*:/im.test(value)) return 'ass';
  if (/^\s*WEBVTT/i.test(value)) return 'vtt';
  if (/<(?:\w+:)?tt\b/i.test(value) && /<(?:\w+:)?p\b/i.test(value)) return 'ttml';
  if (/<transcript\b/i.test(value) && /<text\b[^>]*\bstart=/i.test(value)) return 'youtube-xml';
  if (/<sami\b/i.test(value) || /<sync\b[^>]*\bstart=/i.test(value)) return 'sami';
  if (/^\{\d+\}\{\d+\}/m.test(value)) return 'microdvd';
  if (/^\[\d+\]\[\d+\]/m.test(value)) return 'mpl2';
  if (/^\s*(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d+\s*,\s*(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d+\s*$/m.test(value)) return 'subviewer';
  if (/<window\b/i.test(value) && /<time\b[^>]*\bbegin=/i.test(value)) return 'realtext';
  if (/^\[(?:\d{1,3}):\d{2}(?:[.:]\d{1,3})?\]/m.test(value)) return 'lrc';
  if (/(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[,.]\d{1,9})?\s*-->/.test(value)) return /^\s*WEBVTT/i.test(value) ? 'vtt' : 'srt';
  return options.fallback || 'unknown';
}

export function convertTextSubtitleToSrt(text, options = {}) {
  const format = options.detectedFormat || detectSubtitleFormat(text);
  const converters = {
    ttml: () => ttmlToSrt(text),
    'youtube-xml': () => youtubeXmlToSrt(text),
    sami: () => samiToSrt(text),
    microdvd: () => microDvdToSrt(text, options.frameRate),
    mpl2: () => mpl2ToSrt(text),
    subviewer: () => subViewerToSrt(text),
    lrc: () => lrcToSrt(text),
    realtext: () => realTextToSrt(text),
  };
  if (!converters[format]) return { text: String(text || ''), format, converted: false, handled: false };
  const convertedText = converters[format]();
  return { text: convertedText, format, converted: Boolean(convertedText), handled: true };
}
