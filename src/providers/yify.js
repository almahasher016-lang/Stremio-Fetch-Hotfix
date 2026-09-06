import { config } from '../config.js';
import { cacheGetEntry, cacheSet } from '../cache/redis.js';
import { fetchText } from '../utils/http.js';
import { isArabicLanguage, normalizeStremioLanguage } from '../utils/language.js';

const YIFY_LKG_TTL_SECONDS = 60 * 60;
const YIFY_LKG_STALE_SECONDS = 7 * 24 * 60 * 60;

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

function findSubtitleAnchor(block) {
  const anchors = String(block || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const anchor of anchors) {
    const download = directDownloadUrl(anchor[1]);
    if (download) return { html: anchor[2], download };
  }
  return null;
}

export function parseYifyRows(html, imdbId) {
  const rows = [];
  const blocks = String(html || '').split(/<tr\b/i).slice(1);
  for (const block of blocks) {
    if (!/Arabic|\bAR\b|العربية|arab/i.test(block)) continue;
    const anchor = findSubtitleAnchor(block);
    if (!anchor) continue;
    const providerId = block.match(/\bdata-id=["']?(\d{1,20})/i)?.[1] || `${rows.length}`;
    const name = decodeHtml(String(anchor.html || '')
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
      machineTranslated: null,
      download: anchor.download,
      sourceType: 'fallback',
    });
  }
  return rows;
}

function lkgKey(imdbId) {
  return `provider:yify:last-good:${imdbId}`;
}

async function readLastKnownGood(imdbId, cacheGetEntryImpl) {
  try {
    const cached = await cacheGetEntryImpl(lkgKey(imdbId), { allowStale: true });
    const rows = cached?.value;
    if (!Array.isArray(rows) || !rows.length) return [];
    return rows.slice(0, config.yify.maxItems).map(row => ({
      ...row,
      provider: 'yify',
      sourceType: 'fallback-cache',
      searchReason: 'yify-last-known-good',
      lastKnownGood: true,
    }));
  } catch (error) {
    console.warn('[provider:yify:lkg-read]', error.message);
    return [];
  }
}

async function storeLastKnownGood(imdbId, rows, cacheSetImpl) {
  if (!rows.length) return;
  try {
    await cacheSetImpl(lkgKey(imdbId), rows, YIFY_LKG_TTL_SECONDS, YIFY_LKG_STALE_SECONDS);
  } catch (error) {
    console.warn('[provider:yify:lkg-write]', error.message);
  }
}

export async function searchYify(variant, {
  fetchTextImpl = fetchText,
  cacheGetEntryImpl = cacheGetEntry,
  cacheSetImpl = cacheSet,
} = {}) {
  if (!config.yify.enabled || variant.type === 'series') return [];
  const expectedArabic = !variant.language || isArabicLanguage(variant.language);
  if (!expectedArabic) return [];
  const imdbId = cleanImdb(variant.imdbId || variant.id || variant.query);
  if (!imdbId) return [];

  const urls = [
    `${config.yify.baseUrl}/movie-imdb/${encodeURIComponent(imdbId)}`,
  ];

  let anySuccessfulFetch = false;
  let lastError = null;
  for (const url of urls) {
    try {
      const html = await fetchTextImpl(url, {
        timeoutMs: config.providers.timeoutMs,
        signal: variant.signal,
        trustedOrigin: config.yify.baseUrl,
      });
      if (/<title[^>]*>\s*Just a moment|id=["']challenge-form["']|class=["'][^"']*cf-chl-/i.test(html)) {
        const error = new Error('YIFY returned an anti-bot challenge');
        error.code = 'YIFY_ANTI_BOT';
        throw error;
      }
      const rows = parseYifyRows(html, imdbId).slice(0, config.yify.maxItems);
      if (!rows.length && /sub-lang[^>]*>\s*Arabic|>\s*Arabic\s*</i.test(html)) {
        const error = new Error('YIFY Arabic page layout is no longer supported');
        error.code = 'YIFY_LAYOUT_CHANGED';
        throw error;
      }
      anySuccessfulFetch = true;
      if (rows.length) {
        await storeLastKnownGood(imdbId, rows, cacheSetImpl);
        return rows;
      }
    } catch (error) {
      if (variant.signal?.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }

  if (!anySuccessfulFetch && lastError) {
    const lastKnownGood = await readLastKnownGood(imdbId, cacheGetEntryImpl);
    if (lastKnownGood.length) return lastKnownGood;
    throw lastError;
  }
  return [];
}
