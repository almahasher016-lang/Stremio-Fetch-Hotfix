import { config } from '../config.js';
import { fetchText } from '../utils/http.js';
import { isArabicLanguage, normalizeStremioLanguage } from '../utils/language.js';

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeUrl(value) {
  if (!value) return null;
  const raw = decodeHtml(value).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${config.yify.baseUrl}${raw}`;
  return `${config.yify.baseUrl}/${raw}`;
}

function parseRows(html, imdbId) {
  const rows = [];
  const blocks = String(html || '').split(/<tr\b/i).slice(1);
  for (const block of blocks) {
    if (!/Arabic|\bAR\b|العربية|arab/i.test(block)) continue;
    const href = block.match(/href=["']([^"']+(?:subtitle|download|subtitles)[^"']*)["']/i)?.[1]
      || block.match(/href=["']([^"']+\.srt[^"']*)["']/i)?.[1];
    const name = decodeHtml(block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180);
    const download = normalizeUrl(href);
    if (!download) continue;
    rows.push({
      provider: 'yify',
      id: `yify-${imdbId}-${rows.length}`,
      providerId: `${imdbId}-${rows.length}`,
      name: name || 'YIFY Arabic',
      releaseName: name || '',
      fileName: '',
      lang: normalizeStremioLanguage('ar'),
      imdbId,
      downloads: 0,
      rating: 0,
      trusted: false,
      hearingImpaired: /\b(sdh|hi|hearing impaired)\b/i.test(name),
      machineTranslated: false,
      download,
      sourceType: 'fallback',
    });
  }
  return rows;
}

export async function searchYify(variant) {
  if (!config.yify.enabled || variant.type === 'series') return [];
  const expectedArabic = !variant.language || isArabicLanguage(variant.language);
  if (!expectedArabic) return [];
  const imdbId = cleanImdb(variant.imdbId || variant.id || variant.query);
  if (!imdbId) return [];

  const urls = [
    `${config.yify.baseUrl}/movie-imdb/${encodeURIComponent(imdbId)}`,
    `${config.yify.baseUrl}/movie/${encodeURIComponent(imdbId)}`,
  ];

  for (const url of urls) {
    try {
      const html = await fetchText(url, { timeoutMs: config.providers.timeoutMs, signal: variant.signal });
      const rows = parseRows(html, imdbId).slice(0, config.yify.maxItems);
      if (rows.length) return rows;
    } catch (error) {
      if (variant.signal?.aborted || error?.name === 'AbortError') throw error;
      // Try next shape. YIFY is a lightweight fallback and must never break the main provider flow.
    }
  }
  return [];
}
