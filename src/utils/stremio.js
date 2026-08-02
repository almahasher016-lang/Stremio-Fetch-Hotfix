import { config } from '../config.js';
import { parseRelease } from './releaseParser.js';
import { detectSyncPlan } from './subtitleTiming.js';
import { proxiedSubtitleUrl } from './encodingProxy.js';
import { styledSubtitleFormatHint, styledSubtitleUrl } from './styledSubtitle.js';
import { buildVideoIdentity } from './videoIdentity.js';
import { httpError } from './httpError.js';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function boolish(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function getBaseUrl(req) {
  if (config.app.publicBaseUrl) return config.app.publicBaseUrl;
  const forwardedProto = Array.isArray(req.headers['x-forwarded-proto'])
    ? req.headers['x-forwarded-proto'][0]
    : req.headers['x-forwarded-proto'];
  const forwardedHost = Array.isArray(req.headers['x-forwarded-host'])
    ? req.headers['x-forwarded-host'][0]
    : req.headers['x-forwarded-host'];
  const proto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim().toLowerCase();
  const host = String(forwardedHost || req.headers.host || '').split(',')[0].trim();
  if (!['https', 'http'].includes(proto) || !host || host.length > 512) throw httpError(400, 'Invalid request origin');
  try {
    const parsed = new URL(`${proto}://${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('invalid origin');
    }
    return parsed.origin;
  } catch {
    throw httpError(400, 'Invalid request origin');
  }
}

export function createManifest() {
  return {
    id: config.app.id,
    version: config.app.version,
    name: config.app.name,
    description: config.app.description,
    logo: 'https://www.stremio.com/website/stremio-logo-small.png',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:', 'kitsu:', 'anidb:', 'mal:'],
    behaviorHints: {
      configurable: config.ui.configureEnabled,
      configurationRequired: false,
    },
    catalogs: [],
  };
}

export function parseExtra(extra = '') {
  const output = {};
  if (!extra) return output;
  const parts = String(extra).split('&');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.split('=');
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey);
      const value = decodeURIComponent(rawValue.join('=') || '');
      if (!key || key.length > 80 || value.length > 2_000 || FORBIDDEN_OBJECT_KEYS.has(key.toLowerCase())) {
        throw httpError(400, 'Invalid Stremio extra parameters');
      }
      output[key] = value;
    } catch {
      throw httpError(400, 'Invalid Stremio extra parameters');
    }
  }
  return output;
}

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractNumericId(prefix, id) {
  const str = String(id || '');
  if (!str.startsWith(`${prefix}:`)) return null;
  return str.slice(prefix.length + 1).split(':')[0] || null;
}

export function buildStremioSubtitleSearch({ type, id, extra = {} }) {
  return buildVideoIdentity({ type, id, extra });
}

function referenceForProxy(baseUrl, item) {
  const ref = item.referenceSubtitle;
  const download = ref?.download || ref?.url;
  if (!download) return null;
  return {
    url: download.startsWith('/') ? `${baseUrl}${download}` : download,
    provider: ref.provider,
    name: ref.name || ref.releaseName || ref.fileName || 'English reference',
  };
}

function styledModeFormat(mode) {
  const match = String(mode || '').match(/^styled-(ass|ssa)$/);
  return match ? match[1] : null;
}

function qualityBadges(item, mode) {
  if (!config.app.enableQualityBadges) return [];
  const badges = [];
  if (item.provider === 'vault') badges.push('💾 Personal');
  if (item.provider === 'registry') badges.push('📌 Verified Version');
  if (item.sourceType === 'version-registry-exact-hash') badges.push('🔒 Exact Version');
  if (item.sourceType === 'personal-vault-exact-hash') badges.push('🔑 Exact Hash');
  if (item.releaseMatchTier >= 5) badges.push('🎯 Strong Name Match');
  else if (item.releaseMatchTier >= 3) badges.push('✅ Name Match');
  if (item.trusted) badges.push('🏆 Verified');
  if (mode === 'reference') badges.push('🧪 Experimental RefSync');
  if (mode === 'sync') badges.push('⏱ Manual Timing');
  if (styledModeFormat(mode)) badges.push('🎨 Original Styles');
  if (item.searchReason === 'hash-first' || item.movieHash) badges.push('🔑 Hash');
  if (item.hearingImpaired || item.sdh) badges.push('👂 SDH');
  if (item.machineTranslated || item.automatedTranslated) badges.push('🤖 MT');
  if (item.quality?.score) badges.push(`✓ Q${item.quality.score}`);
  return badges;
}

function subtitleName(item, mode = 'original') {
  const parts = [config.app.subtitleDisplayName];
  const styledFormat = styledModeFormat(mode);
  if (mode === 'sync') parts.push('Manual Timing');
  else if (mode === 'reference') parts.push('Experimental Reference Sync');
  else if (styledFormat) parts.push(`Styled ${styledFormat.toUpperCase()}`);
  else parts.push('Original');
  parts.push(...qualityBadges(item, mode));
  if (item.parsedRelease?.quality) parts.push(item.parsedRelease.quality.toUpperCase());
  if (item.parsedRelease?.source) parts.push(item.parsedRelease.source.toUpperCase());
  if (item.provider) parts.push(item.provider);
  if (Number.isFinite(item.score)) parts.push(`score ${item.score}`);
  return parts.join(' · ');
}

export function subtitleDisplayName(item, mode = 'original') {
  return subtitleName(item, mode);
}

function subtitleOptionId(item, mode, index) {
  const base = item.id || item.providerId || `subtitle-${index}`;
  return `${base}-${mode}-v${config.app.version}`;
}

export function toStremioSubtitles(results, baseUrl, search = {}) {
  const output = [];
  const videoRelease = parseRelease(search.filename || search.query || '');
  const eligible = [];

  for (const [index, item] of results.entries()) {
    const rankedFallbacks = [
      ...results.slice(index + 1),
      ...results.slice(0, index),
    ].filter(candidate => candidate?.download || candidate?.url);
    const originalUrl = proxiedSubtitleUrl(baseUrl, item, null, null, search, rankedFallbacks);
    if (!originalUrl) continue;
    eligible.push({ item, index, rankedFallbacks, originalUrl });
  }

  let originalCount = 0;
  for (const { item, index, originalUrl } of eligible) {
    if (
      originalCount >= config.ranking.maxOriginalOptions
      || output.length >= config.ranking.maxStremioSubtitles
    ) break;
    output.push({
      id: subtitleOptionId(item, 'orig', index),
      url: originalUrl,
      lang: 'ara',
      name: subtitleName(item, 'original'),
    });
    originalCount += 1;
  }

  let styledCount = 0;
  for (const { item, index } of eligible) {
    if (output.length >= config.ranking.maxStremioSubtitles || styledCount >= 2) break;
    const styledFormat = styledSubtitleFormatHint(item);
    if (!styledFormat) continue;
    const url = styledSubtitleUrl(baseUrl, item, search);
    if (!url) continue;
    output.push({
      id: subtitleOptionId(item, `styled-${styledFormat}`, index),
      url,
      lang: 'ara',
      name: subtitleName(item, `styled-${styledFormat}`),
    });
    styledCount += 1;
  }

  if (config.ranking.enableAutoSyncOption) {
    let autoSyncCount = 0;
    for (const { item, index, rankedFallbacks } of eligible) {
      if (
        output.length >= config.ranking.maxStremioSubtitles
        || autoSyncCount >= config.ranking.maxAutoSyncOptions
      ) break;
      const syncPlan = detectSyncPlan({
        subtitleRelease: item.parsedRelease || parseRelease(item.releaseName || item.fileName || item.name),
        videoRelease,
        extra: search.extra || {},
      });
      if (
        !syncPlan.enabled
        || !syncPlan.verified
        || syncPlan.confidence < config.ranking.autoSyncMinConfidence
      ) continue;
      const autoSyncFallbacks = rankedFallbacks
        .map(candidate => ({
          ...candidate,
          syncPlan: detectSyncPlan({
            subtitleRelease: candidate.parsedRelease || parseRelease(candidate.releaseName || candidate.fileName || candidate.name),
            videoRelease,
            extra: search.extra || {},
          }),
        }))
        .filter(candidate => candidate.syncPlan.enabled && candidate.syncPlan.verified);
      output.push({
        id: subtitleOptionId(item, 'manual-sync', index),
        url: proxiedSubtitleUrl(baseUrl, item, syncPlan, null, search, autoSyncFallbacks),
        lang: 'ara',
        name: subtitleName(item, 'sync'),
      });
      autoSyncCount += 1;
    }
  }

  if (config.ranking.enableReferenceAutoSync) {
    let referenceCount = 0;
    for (const { item, index, rankedFallbacks } of eligible) {
      if (
        output.length >= config.ranking.maxStremioSubtitles
        || referenceCount >= config.ranking.maxReferenceOptions
      ) break;
      const reference = referenceForProxy(baseUrl, item);
      if (!reference) continue;
      const referenceFallbacks = rankedFallbacks
        .map(candidate => ({ ...candidate, reference: referenceForProxy(baseUrl, candidate) }))
        .filter(candidate => candidate.reference);
      output.push({
        id: subtitleOptionId(item, 'experimental-refsync', index),
        url: proxiedSubtitleUrl(baseUrl, item, null, reference, search, referenceFallbacks),
        lang: 'ara',
        name: subtitleName(item, 'reference'),
      });
      referenceCount += 1;
    }
  }

  return output;
}

export function queryOptionsFromRequest(query = {}) {
  return {
    stripSdh: boolish(query.stripSdh),
    stripMusicNotes: boolish(query.stripMusicNotes),
  };
}
