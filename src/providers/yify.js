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

function directDownloadUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const target = new URL(normalized);
    const trusted = new URL(config.yify.baseUrl);
    if (target.origin !== trusted.origin || target.username || target.password) return null;
    const details = target.pathname.match(/^\/subtitles\/([^/]+)\/?$/i);
    if (details) target.pathname = `/subtitle/${details[1]}.zip`;
    else if (!/^\/subtitle\/[^/]+\.zip$/i.test(target.pathname)) return null;
    target.search = '';
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

export function parseYifyRows(html, imdbId) {
  const rows = [];
  const blocks = String(html || '').split(/<tr\b/i).slice(1);
  for (const block of blocks) {
    if (!/Arabic|\bAR\b|العربية|arab/i.test(block)) continue;
    const anchor = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const href = anchor?.[1];
    const download = directDownloadUrl(href);
    if (!download) continue;
    const providerId = block.match(/\bdata-id=["']?(\d{1,20})/i)?.[1] || `${rows.length}`;
    const name = decodeHtml(String(anchor?.[2] || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\bsubtitle\b/i, ' ')
      .replace(/\s+/g, ' ')
      .trim()).slice(0, 180);
    rows.push({
      provider: 'yify',
      id: `yify-${imdbId}-${providerId}`,
      providerId,
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
      const html = await fetchText(url, {
        timeoutMs: config.providers.timeoutMs,
        signal: variant.signal,
        trustedOrigin: config.yify.baseUrl,
      });
      const rows = parseYifyRows(html, imdbId).slice(0, config.yify.maxItems);
      if (rows.length) return rows;
    } catch (error) {
      if (variant.signal?.aborted || error?.name === 'AbortError') throw error;
      // Try next shape. YIFY is a lightweight fallback and must never break the main provider flow.
    }
  }
  return [];
}
