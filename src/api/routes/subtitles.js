import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { searchSubtitles } from '../../services/subtitleService.js';
import { addVaultSubtitle, deleteVaultSubtitle, getVaultSubtitle, listVaultSubtitles } from '../../services/vaultService.js';
import { getOpenSubtitlesDownloadLink } from '../../providers/openSubtitles.js';
import { getSubsourceDownloadLink } from '../../providers/subsource.js';
import { fetchRemoteSubtitleBuffer, resolveProxiedSubtitle, previewProxiedSubtitle } from '../../utils/encodingProxy.js';
import { buildStremioSubtitleSearch, getBaseUrl, parseExtra, toStremioSubtitles, subtitleDisplayName } from '../../utils/stremio.js';
import { httpError } from '../../utils/httpError.js';
import { config } from '../../config.js';
import { buildVideoIdentity } from '../../utils/videoIdentity.js';
import { versionRegistry } from '../../services/versionRegistryService.js';
import { resolverHtml } from '../../ui/resolverHtml.js';

const router = express.Router();
const EMPTY_SUBTITLES_BUF = Buffer.from('{"subtitles":[]}');
const QUERY_PARAM_KEYS = new Set(['q', 'type', 'token', 'vault_token', 'registry_token']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const vaultBodyParser = [express.urlencoded({ extended: false, limit: '3mb' }), express.json({ limit: '3mb' })];

function validateQuery(query) {
  if (!query || query.length < 2) throw httpError(400, 'Query must be at least 2 characters');
  if (query.length > 240) throw httpError(400, 'Query is too long');
}

function tokensMatch(supplied, expected) {
  const actualBytes = Buffer.from(String(supplied || ''));
  const expectedBytes = Buffer.from(String(expected || ''));
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function requireVaultAuth(req) {
  if (!config.vault.authToken) return;
  const supplied = req.headers['x-vault-token'] || req.query.token || req.body?.token;
  if (!tokensMatch(supplied, config.vault.authToken)) throw httpError(401, 'Vault token is required');
}

function requireRegistryAuth(req) {
  const expected = config.versionRegistry.authToken || config.vault.authToken;
  if (!expected) return;
  const supplied = req.headers['x-vault-token'] || req.headers['x-registry-token'] || req.query.token || req.body?.token;
  if (!tokensMatch(supplied, expected)) throw httpError(401, 'Registry token is required');
}

function vaultHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Personal Vault · ${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:24px;line-height:1.7;max-width:980px}input,textarea,button{font:inherit;padding:.55rem;margin:.25rem 0;width:100%;box-sizing:border-box}textarea{height:260px;direction:ltr;unicode-bidi:embed}code{direction:ltr;unicode-bidi:embed}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.45rem;text-align:right}footer{margin-top:2rem;color:#64748b}</style></head><body><h1>مخزن الترجمات الشخصي · ${config.app.name}</h1><p>ارفع ترجمة عربية مضبوطة واربطها بـ IMDb أو hash. ستظهر قبل كل المزودات في Stremio.</p><form id="f"><input name="name" placeholder="اسم الترجمة"><input name="imdbId" placeholder="tt11198330 أو tt1375666"><input name="season" placeholder="الموسم للمسلسلات"><input name="episode" placeholder="الحلقة للمسلسلات"><input name="videoHash" placeholder="videoHash اختياري للمطابقة الدقيقة"><input name="releaseName" placeholder="Release name اختياري"><textarea name="text" placeholder="الصق محتوى SRT هنا"></textarea><input name="token" placeholder="Vault token إذا فعلته"><button>حفظ</button></form><pre id="status"></pre><div id="list"></div><footer><small>الإصدار ${config.app.version} · معالجة حتمية بدون ذكاء اصطناعي</small></footer><script>const f=document.getElementById('f'),status=document.getElementById('status'),list=document.getElementById('list');async function refresh(){const r=await fetch('/api/vault');const j=await r.json();list.innerHTML='<h2>الموجود</h2><table><thead><tr><th>الاسم</th><th>IMDb</th><th>الحلقة</th><th>Hash</th><th>الحجم</th></tr></thead><tbody>'+j.items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.imdbId||'')+'</td><td>'+esc((x.season||'')+':'+(x.episode||''))+'</td><td>'+esc(x.videoHash||'')+'</td><td>'+esc(x.bytes||'')+'</td></tr>').join('')+'</tbody></table>';}
f.onsubmit=async e=>{e.preventDefault();status.textContent='جار الحفظ...';const body=Object.fromEntries(new FormData(f).entries());const r=await fetch('/api/vault',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();status.textContent=JSON.stringify(j,null,2);if(j.success){f.text.value='';refresh();}};function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}refresh();</script></body></html>`;
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

function toPublicPreview(results, baseUrl, search = {}) {
  const subtitles = toStremioSubtitles(results, baseUrl, search);
  return results.slice(0, config.ui.previewMaxItems).map((item, index) => ({
    id: item.id || item.providerId || index,
    name: subtitleDisplayName(item, item.referenceSubtitle ? 'reference' : 'original'),
    provider: item.provider,
    score: item.score,
    releaseQuality: item.parsedRelease?.quality || null,
    source: item.parsedRelease?.source || null,
    trusted: Boolean(item.trusted),
    hearingImpaired: Boolean(item.hearingImpaired || item.sdh),
    searchReason: item.searchReason,
    url: subtitles[index]?.url || null,
    previewUrl: subtitles[index]?.url ? subtitles[index].url.replace('/proxy/encoding/', '/preview/encoding/').replace(/\.srt$/, '.json') : null,
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
  }));
}


router.get('/vault.html', (_req, res) => {
  if (!config.vault.enabled) return res.status(404).end('disabled');
  const body = Buffer.from(vaultHtml());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
});

router.get('/resolver.html', (_req, res) => {
  const body = Buffer.from(resolverHtml());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
});

router.get('/api/versions', async (req, res, next) => {
  try {
    requireRegistryAuth(req);
    const [items, status] = await Promise.all([versionRegistry.list({ limit: req.query.limit }), versionRegistry.status()]);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ success: true, status, items });
  } catch (err) { next(err); }
});

router.post('/api/versions/:action', vaultBodyParser, async (req, res, next) => {
  try {
    requireRegistryAuth(req);
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

router.post('/api/companion/media', vaultBodyParser, async (req, res, next) => {
  try {
    requireRegistryAuth(req);
    const identity = await versionRegistry.recordMedia(buildVideoIdentity(req.body || {}));
    res.json({ success: true, identity });
  } catch (err) { next(err); }
});

router.get('/api/vault', async (_req, res, next) => {
  try {
    const items = await listVaultSubtitles();
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ success: true, count: items.length, items });
  } catch (err) { next(err); }
});

router.post('/api/vault', vaultBodyParser, async (req, res, next) => {
  try {
    if (!config.vault.uploadEnabled) throw httpError(403, 'Vault upload is disabled');
    requireVaultAuth(req);
    const item = await addVaultSubtitle(req.body || {});
    res.json({ success: true, item });
  } catch (err) { next(err); }
});

router.delete('/api/vault/:id', vaultBodyParser, async (req, res, next) => {
  try {
    requireVaultAuth(req);
    const deleted = await deleteVaultSubtitle(req.params.id);
    res.json({ success: true, deleted });
  } catch (err) { next(err); }
});

router.get('/vault/subtitles/:id.srt', async (req, res, next) => {
  try {
    const item = await getVaultSubtitle(req.params.id);
    if (!item) throw httpError(404, 'Vault subtitle not found');
    const text = item.text.replace(/\r\n/g, '\n');
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.end(text);
  } catch (err) { next(err); }
});

router.get('/api/subtitles', async (req, res, next) => {
  try {
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
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');
    res.json({ success: true, count: results.length, results: toPublicResults(results, getBaseUrl(req)) });
  } catch (err) {
    next(err);
  }
});


router.get('/api/preview', async (req, res, next) => {
  try {
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
    res.setHeader('Cache-Control', 'no-cache');
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
    res.json({ subtitles: toStremioSubtitles(results, getBaseUrl(req), search) });
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
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Cache-Control', result.cache === 'hit' ? 'public, max-age=604800, immutable' : 'public, max-age=86400');
    res.setHeader('X-Source-Encoding', result.encoding || 'utf-8');
    res.setHeader('X-Source-Format', result.format || 'srt');
    if (result.archive) res.setHeader('X-Source-Archive', result.archive);
    if (result.sync) res.setHeader('X-Sync-Confidence', String(result.sync.confidence));
    res.end(result.text);
  } catch (err) {
    next(err);
  }
});


router.get('/preview/encoding/:token.json', async (req, res, next) => {
  try {
    const requestedCues = Number.parseInt(req.query.maxCues, 10);
    const maxCues = Number.isFinite(requestedCues) ? Math.min(20, Math.max(1, requestedCues)) : 6;
    const result = await previewProxiedSubtitle(req.params.token, { maxCues });
    res.setHeader('Cache-Control', 'no-cache');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

async function streamRemoteSubtitle(downloadUrl, res) {
  const body = await fetchRemoteSubtitleBuffer(downloadUrl);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
}

router.get('/downloads/opensubtitles/:fileId.srt', async (req, res, next) => {
  try {
    if (!/^[1-9]\d{0,19}$/.test(req.params.fileId)) throw httpError(400, 'Invalid OpenSubtitles file ID');
    const link = await getOpenSubtitlesDownloadLink(req.params.fileId);
    await streamRemoteSubtitle(link, res);
  } catch (err) {
    next(err);
  }
});

router.get('/downloads/subsource/:subtitleId', async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.subtitleId)) throw httpError(400, 'Invalid SubSource subtitle ID');
    const link = await getSubsourceDownloadLink(req.params.subtitleId);
    await streamRemoteSubtitle(link, res);
  } catch (err) {
    next(err);
  }
});

export default router;
