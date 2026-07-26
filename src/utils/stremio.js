import { config } from '../config.js';
import { parseRelease } from './releaseParser.js';
import { detectSyncPlan } from './subtitleTiming.js';
import { proxiedSubtitleUrl } from './encodingProxy.js';
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

function qualityBadges(item, mode) {
  if (!config.app.enableQualityBadges) return [];
  const badges = [];
  if (item.provider === 'vault') badges.push('💾 Personal');
  if (item.provider === 'registry') badges.push('📌 Verified Version');
  if (item.sourceType === 'version-registry-exact-hash') badges.push('🔒 Exact Version');
  if (item.sourceType === 'personal-vault-exact-hash') badges.push('🔑 Exact Hash');
  if (item.trusted) badges.push('🏆 Verified');
  if (mode === 'reference') badges.push('⚡ RefSync');
  if (mode === 'sync') badges.push('⏱ AutoSync');
  if (item.searchReason === 'hash-first' || item.movieHash) badges.push('🔑 Hash');
  if (item.hearingImpaired || item.sdh) badges.push('👂 SDH');
  if (item.machineTranslated || item.automatedTranslated) badges.push('🤖 MT');
  if (item.quality?.score) badges.push(`✓ Q${item.quality.score}`);
  return badges;
}

function subtitleName(item, mode = 'original') {
  const parts = [config.app.subtitleDisplayName];
  if (mode === 'sync') parts.push('Auto Sync');
  else if (mode === 'reference') parts.push('Reference Sync');
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

export function toStremioSubtitles(results, baseUrl, search = {}) {
  const output = [];
  const videoRelease = parseRelease(search.filename || search.query || '');
  let referenceCount = 0;
  let autoSyncCount = 0;
  let originalCount = 0;

  for (const [index, item] of results.entries()) {
    if (output.length >= config.ranking.maxStremioSubtitles) break;
    const fallbackItems = [
      ...results.slice(index + 1),
      ...results.slice(0, index),
    ].filter(candidate => candidate?.download || candidate?.url).slice(0, config.encodingProxy.maxFallbacks);
    const originalUrl = proxiedSubtitleUrl(baseUrl, item, null, null, search, fallbackItems);
    if (!originalUrl) continue;

    const reference = referenceForProxy(baseUrl, item);
    const syncPlan = detectSyncPlan({
      subtitleRelease: item.parsedRelease || parseRelease(item.releaseName || item.fileName || item.name),
      videoRelease,
      extra: search.extra || {},
    });

    const canAddReference = config.ranking.enableReferenceAutoSync
      && reference
      && referenceCount < config.ranking.maxReferenceOptions
      && output.length < config.ranking.maxStremioSubtitles;

    if (canAddReference) {
      output.push({
        id: `${item.id || item.providerId || output.length}-refsync`,
        url: proxiedSubtitleUrl(baseUrl, item, null, reference, search, fallbackItems),
        lang: 'ara',
        name: subtitleName(item, 'reference'),
      });
      referenceCount++;
    }

    const canAddAutoSync = config.ranking.enableAutoSyncOption
      && syncPlan.enabled
      && syncPlan.confidence >= config.ranking.autoSyncMinConfidence
      && autoSyncCount < config.ranking.maxAutoSyncOptions
      && output.length < config.ranking.maxStremioSubtitles;

    if (canAddAutoSync) {
      output.push({
        id: `${item.id || item.providerId || output.length}-sync`,
        url: proxiedSubtitleUrl(baseUrl, item, syncPlan, null, search, fallbackItems),
        lang: 'ara',
        name: subtitleName(item, 'sync'),
      });
      autoSyncCount++;
    }

    const canAddOriginal = originalCount < config.ranking.maxOriginalOptions
      && output.length < config.ranking.maxStremioSubtitles;

    if (canAddOriginal) {
      output.push({
        id: `${item.id || item.providerId || output.length}-orig`,
        url: originalUrl,
        lang: 'ara',
        name: subtitleName(item, 'original'),
      });
      originalCount++;
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
