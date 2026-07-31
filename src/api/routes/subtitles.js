import express from 'express';
import { searchSubtitles } from '../../services/subtitleService.js';
import {
  addVaultSubtitle,
  deleteVaultSubtitle,
  exportVaultSnapshot,
  getVaultSubtitle,
  importVaultSnapshot,
  listVaultSubtitles,
} from '../../services/vaultService.js';
import { getOpenSubtitlesDownloadLink } from '../../providers/openSubtitles.js';
import { getSubsourceDownloadLink } from '../../providers/subsource.js';
import { fetchRemoteSubtitleBuffer, resolveProxiedSubtitle, previewProxiedSubtitle } from '../../utils/encodingProxy.js';
import { resolveStyledSubtitle } from '../../utils/styledSubtitle.js';
import { buildStremioSubtitleSearch, getBaseUrl, parseExtra, toStremioSubtitles, subtitleDisplayName } from '../../utils/stremio.js';
import { httpError } from '../../utils/httpError.js';
import { config } from '../../config.js';
import { buildVideoIdentity } from '../../utils/videoIdentity.js';
import { versionRegistry } from '../../services/versionRegistryService.js';
import { resolverHtml } from '../../ui/resolverHtml.js';
import { vaultPageHtml } from '../../ui/vaultHtml.js';
import { assertAdminAuth, requireAdminAuth } from '../middleware/adminAuth.js';
import { normalizeStremioSubtitleResponse } from '../../utils/stremioResponseCompat.js';
import {
  sendHtmlResponse,
  sendSrtResponse,
  sendStyledSubtitleResponse,
} from '../../utils/responseSenders.js';

const router = express.Router();
const EMPTY_SUBTITLES_BUF = Buffer.from('{"subtitles":[]}');
const QUERY_PARAM_KEYS = new Set(['q', 'type', 'token', 'vault_token', 'registry_token']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const vaultBodyParser = [express.urlencoded({ extended: false, limit: '3mb' }), express.json({ limit: '3mb' })];

function validateQuery(query) {
  if (!query || query.length < 2) throw httpError(400, 'Query must be at least 2 characters');
  if (query.length > 240) throw httpError(400, 'Query is too long');
}

function mergeExtras(routeExtra = {}, queryExtra = {}) {
  const output = { ...routeExtra };
  for (const key of Object.keys(queryExtra || {})) {
    if (QUERY_PARAM_KEYS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key.toLowerCase()) || key.length > 80) continue;
    const value = queryExtra[key];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (String(normalized ?? '').length <= 2_000) output[key] = normalized;
  }
  return output;
}

function toPublicResults(results, baseUrl) {
  return results.map(item => ({
    ...item,
    download: item.download?.startsWith('/') ? `${baseUrl}${item.download}` : item.download,
  }));
}

export function toPublicPreview(results, baseUrl, search = {}) {
  return results.slice(0, config.ui.previewMaxItems).map((item, index) => {
    const subtitle = toStremioSubtitles([item], baseUrl, search)[0];
    const url = subtitle?.url || null;
    const previewUrl = url?.includes('/proxy/encoding/') && url.endsWith('.srt')
      ? url.replace('/proxy/encoding/', '/preview/encoding/').replace(/\.srt$/, '.json')
      : null;
    return {
      id: item.id || item.providerId || index,
      name: subtitle?.name || subtitleDisplayName(item, 'original'),
      provider: item.provider,
      score: item.score,
      releaseMatchTier: item.releaseMatchTier || 0,
      releaseMatch: item.releaseMatch || null,
      releaseQuality: item.parsedRelease?.quality || null,
      source: item.parsedRelease?.source || null,
      trusted: Boolean(item.trusted),
      hearingImpaired: Boolean(item.hearingImpaired || item.sdh),
      searchReason: item.searchReason,
      url,
      previewUrl,
      quality: item.quality || null,
      asset: {
        provider: item.originalProvider || item.provider,
        originalProvider: item.originalProvider || '',
        providerId: item.providerId || item.fileId || item.id,
        id: item.id,
        name: item.name,
        releaseName: item.releaseName,
        fileName: item.fileName,
        lang: item.lang,
        download: item.download,
        movieHash: item.movieHash,
        score: item.score,
        quality: item.quality || null,
      },
    };
  });
}

router.get('/vault.html', (_req, res) => {
  if (!config.vault.enabled) return res.status(404).end('disabled');
  return sendHtmlResponse(res, vaultPageHtml(), { cacheControl: 'no-cache' });
});

router.get('/resolver.html', (_req, res) => sendHtmlResponse(res, resolverHtml(), {
  cacheControl: 'no-cache',
}));

router.get('/api/versions', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const [items, status] = await Promise.all([versionRegistry.list({ limit: req.query.limit }), versionRegistry.status()]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, status, items });
  } catch (err) { next(err); }
});

router.post('/api/versions/:action', requireAdminAuth, vaultBodyParser, async (req, res, next) => {
  try {
    const action = String(req.params.action || '').toLowerCase();
    if (!['verify', 'reject', 'suggest'].includes(action)) throw httpError(400, 'Unsupported version action');
    const result = await versionRegistry.recordDecision({
      action,
      search: req.body?.search || {},
      candidate: req.body?.candidate?.asset || req.body?.candidate || {},
      note: req.body?.note || '',
    });
    res.json({ success: true, result });
  } catch (err) { next(err); }
});

router.post('/api/companion/media', requireAdminAuth, vaultBodyParser, async (req, res, next) => {
  try {
    const identity = await versionRegistry.recordMedia(buildVideoIdentity(req.body || {}));
    res.json({ success: true, identity });
  } catch (err) { next(err); }
});

router.get('/api/vault', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const items = await listVaultSubtitles();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, count: items.length, items });
  } catch (err) { next(err); }
});

router.get('/api/vault/export', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const snapshot = await exportVaultSnapshot();
    const body = Buffer.from(JSON.stringify(snapshot, null, 2));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="m7md-vault-backup.json"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', body.byteLength);
    res.end(body);
  } catch (err) { next(err); }
});

router.post('/api/vault/import', requireAdminAuth, express.json({ limit: '15mb' }), async (req, res, next) => {
  try {
    const result = await importVaultSnapshot(req.body, { mode: req.query.mode || 'merge' });
    res.json({ success: true, result });
  } catch (err) { next(err); }
});

router.post('/api/vault', requireAdminAuth, vaultBodyParser, async (req, res, next) => {
  try {
    if (!config.vault.uploadEnabled) throw httpError(403, 'Vault upload is disabled');
    const item = await addVaultSubtitle(req.body || {});
    res.json({ success: true, item });
  } catch (err) { next(err); }
});

router.delete('/api/vault/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const deleted = await deleteVaultSubtitle(req.params.id);
    res.json({ success: true, deleted });
  } catch (err) { next(err); }
});

router.get('/vault/subtitles/:id.srt', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const item = await getVaultSubtitle(req.params.id);
    if (!item) throw httpError(404, 'Vault subtitle not found');
    return sendSrtResponse(res, item.text.replace(/\r\n/g, '\n'), {
      cacheControl: 'private, no-store',
      filename: `vault-${req.params.id}.srt`,
    });
  } catch (err) { next(err); }
});

router.get('/api/subtitles', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const query = String(req.query.q || '').trim();
    validateQuery(query);
    const extra = mergeExtras({}, req.query);
    const search = {
      query,
      type: req.query.type || 'movie',
      id: req.query.id || query,
      imdbId: req.query.imdbId || req.query.imdb_id || null,
      tmdbId: req.query.tmdbId || req.query.tmdb_id || null,
      season: Number(req.query.season || 0) || null,
      episode: Number(req.query.episode || 0) || null,
      filename: req.query.filename || '',
      videoHash: req.query.videoHash || req.query.hash || null,
      videoSize: req.query.videoSize || req.query.size || null,
      durationMs: req.query.durationMs || req.query.duration || null,
      extra,
    };
    const results = await searchSubtitles(search);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, count: results.length, results: toPublicResults(results, getBaseUrl(req)) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/preview', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const started = Date.now();
    const query = String(req.query.q || '').trim();
    validateQuery(query);
    const extra = mergeExtras({}, req.query);
    const search = {
      query,
      type: req.query.type || 'movie',
      id: req.query.id || query,
      imdbId: req.query.imdbId || req.query.imdb_id || null,
      tmdbId: req.query.tmdbId || req.query.tmdb_id || null,
      season: Number(req.query.season || 0) || null,
      episode: Number(req.query.episode || 0) || null,
      filename: req.query.filename || '',
      videoHash: req.query.videoHash || req.query.hash || null,
      videoSize: req.query.videoSize || req.query.size || null,
      extra,
    };
    const results = await searchSubtitles(search);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, ms: Date.now() - started, count: results.length, results: toPublicPreview(results, getBaseUrl(req), search) });
  } catch (err) {
    next(err);
  }
});

async function stremioHandler(req, res, next) {
  try {
    const routeExtra = parseExtra(req.params.extra);
    const extra = mergeExtras(routeExtra, req.query);
    const search = buildStremioSubtitleSearch({ type: req.params.type, id: req.params.id, extra });
    const results = await searchSubtitles(search);
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');
    const body = normalizeStremioSubtitleResponse({
      subtitles: toStremioSubtitles(results, getBaseUrl(req), search),
    }, config.app.version);
    res.json(body);
  } catch (err) {
    if (err.status === 503) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, max-age=0');
      return res.end(EMPTY_SUBTITLES_BUF);
    }
    next(err);
  }
}

router.get('/subtitles/:type/:id.json', stremioHandler);
router.get('/subtitles/:type/:id/:extra.json', stremioHandler);
router.get('/subtitle/:type/:id.json', stremioHandler);
router.get('/subtitle/:type/:id/:extra.json', stremioHandler);

router.get('/proxy/encoding/:token.srt', async (req, res, next) => {
  try {
    const result = await resolveProxiedSubtitle(req.params.token);
    res.setHeader('X-Source-Encoding', result.encoding || 'utf-8');
    res.setHeader('X-Source-Format', result.format || 'srt');
    if (result.archive) res.setHeader('X-Source-Archive', result.archive);
    if (result.sync) res.setHeader('X-Sync-Confidence', String(result.sync.confidence));
    if (result.fallbackIndex > 0) res.setHeader('X-Subtitle-Fallback', String(result.fallbackIndex));
    return sendSrtResponse(res, result.text, {
      cacheControl: result.cache === 'hit'
        ? 'public, max-age=604800, immutable'
        : 'public, max-age=86400',
    });
  } catch (err) {
    next(err);
  }
});

async function styledSubtitleHandler(req, res, next) {
  try {
    const result = await resolveStyledSubtitle(req.params.token);
    res.setHeader('X-Source-Encoding', result.encoding || 'utf-8');
    res.setHeader('X-Source-Format', result.format || 'ass');
    if (result.archive) res.setHeader('X-Source-Archive', result.archive);
    if (result.archiveEntry) res.setHeader('X-Source-Archive-Entry', result.archiveEntry);
    return sendStyledSubtitleResponse(res, result.text, {
      format: result.format || 'ass',
      cacheControl: result.cache === 'hit'
        ? 'public, max-age=604800, immutable'
        : 'public, max-age=86400',
    });
  } catch (err) {
    next(err);
  }
}

router.get('/proxy/styled/:token.ass', styledSubtitleHandler);
router.get('/proxy/styled/:token.ssa', styledSubtitleHandler);

router.get('/preview/encoding/:token.json', async (req, res, next) => {
  try {
    const requestedCues = Number.parseInt(req.query.maxCues, 10);
    const maxCues = Number.isFinite(requestedCues) ? Math.min(20, Math.max(1, requestedCues)) : 6;
    const result = await previewProxiedSubtitle(req.params.token, { maxCues });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

async function streamRemoteSubtitle(downloadUrl, res) {
  const body = await fetchRemoteSubtitleBuffer(downloadUrl);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
}

router.get('/downloads/opensubtitles/:fileId.srt', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    if (!/^[1-9]\d{0,19}$/.test(req.params.fileId)) throw httpError(400, 'Invalid OpenSubtitles file ID');
    const link = await getOpenSubtitlesDownloadLink(req.params.fileId);
    await streamRemoteSubtitle(link, res);
  } catch (err) {
    next(err);
  }
});

router.get('/downloads/subsource/:subtitleId', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.subtitleId)) throw httpError(400, 'Invalid SubSource subtitle ID');
    const link = await getSubsourceDownloadLink(req.params.subtitleId);
    await streamRemoteSubtitle(link, res);
  } catch (err) {
    next(err);
  }
});

export default router;
