import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import subtitlesRoute from './api/routes/subtitles.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { apiLimiter } from './api/middleware/rateLimit.js';
import { requestId } from './api/middleware/requestId.js';
import { getBreakersStatus, getProvidersStatus, getProviderMetricsStatus } from './services/subtitleService.js';
import { closeRedis, getCacheStatus } from './cache/redis.js';
import { createManifest } from './utils/stremio.js';
import { config } from './config.js';
import { prometheusMetrics } from './utils/metrics.js';

const app = express();
const manifestJson = createManifest();
const manifestBuf = Buffer.from(JSON.stringify(manifestJson));

if (config.server.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.disable('etag');

// Stremio Desktop/Web fetches manifest and subtitle resources cross-origin.
// Keep this explicit and unconditional; do not rely on a wildcard array in the cors package.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, User-Agent, Range, Stremio-User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
});

app.use(requestId);
app.use(compression({ threshold: 1024, level: 1 }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(config.server.isProd ? morgan('combined', { skip: req => req.path === '/health' || req.path === '/manifest.json' }) : morgan('dev'));
app.use(apiLimiter);

const homeHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:32px;line-height:1.8;max-width:900px}a{display:inline-block;margin:.25rem .5rem .25rem 0}</style></head><body><h1>${config.app.name}</h1><p>إضافة ترجمات عربية مباشرة لـ Stremio بدون ذكاء اصطناعي مع Reference Sync وSmart Cache.</p><p><a href="/manifest.json">Manifest</a><a href="/health">Health</a><a href="/metrics">Metrics</a><a href="/test.html">Test UI</a><a href="/configure">Configure</a><a href="/vault.html">Vault</a></p></body></html>`;
const homeHtmlBuf = Buffer.from(homeHtml);

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function testHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>اختبار ${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:24px;line-height:1.7}input,select,button{font:inherit;padding:.55rem;margin:.25rem}table{border-collapse:collapse;width:100%;margin-top:1rem}td,th{border:1px solid #ddd;padding:.5rem;text-align:right}code{direction:ltr;unicode-bidi:embed}</style></head><body><h1>اختبار الإضافة</h1><p>اكتب IMDb أو حلقة مثل <code>tt11198330:1:1</code>، ويمكن إضافة اسم ملف لتحسين المطابقة.</p><form id="f"><input id="q" value="tt1375666" placeholder="tt1375666 أو tt11198330:1:1" size="28"><select id="type"><option value="movie">movie</option><option value="series">series</option></select><br><input id="filename" placeholder="filename اختياري" size="70"><button>اختبار</button></form><pre id="status"></pre><div id="out"></div><script>const f=document.getElementById('f'),out=document.getElementById('out'),status=document.getElementById('status');f.onsubmit=async e=>{e.preventDefault();out.innerHTML='';status.textContent='جار الاختبار...';const q=document.getElementById('q').value.trim();const type=document.getElementById('type').value;const filename=document.getElementById('filename').value.trim();const params=new URLSearchParams({q,type});if(filename)params.set('filename',filename);const r=await fetch('/api/preview?'+params.toString());const j=await r.json();status.textContent=JSON.stringify({success:j.success,count:j.count,ms:j.ms},null,2);out.innerHTML='<table><thead><tr><th>الاسم</th><th>المزود</th><th>Score</th><th>الجودة</th><th>الرابط</th></tr></thead><tbody>'+j.results.map(x=>'<tr><td>'+esc(x.name||'')+'</td><td>'+esc(x.provider||'')+'</td><td>'+esc(x.score??'')+'</td><td>'+esc(x.quality||'')+'</td><td><a href="'+esc(x.previewUrl||x.url||'#')+'" target="_blank">Preview/Subtitle</a></td></tr>').join('')+'</tbody></table>';};function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}</script></body></html>`;
}

function configureHtml(req) {
  const baseUrl = config.app.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Configure ${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:24px;line-height:1.8;max-width:900px}code,input{direction:ltr;unicode-bidi:embed}input{width:100%;padding:.6rem}</style></head><body><h1>إعداد ${config.app.name}</h1><p>هذه نسخة خاصة. الإعدادات الفعلية تُدار من Railway Variables، وهذه الصفحة تعرض روابط التشغيل والفحص.</p><label>رابط Stremio</label><input readonly value="${htmlEscape(baseUrl)}/manifest.json" onclick="this.select()"><p><a href="/manifest.json">Manifest</a> · <a href="/health">Health</a> · <a href="/test.html">Test UI</a></p><h2>الحالة المختصرة</h2><pre>${htmlEscape(JSON.stringify({version: config.app.version, providers: config.providers.enabled, referenceSync: config.referenceSync.enabled, cache: {redis: Boolean(config.cache.redisUrl), staleWhileRevalidate: config.cache.staleWhileRevalidate}}, null, 2))}</pre></body></html>`;
}

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Length', homeHtmlBuf.byteLength);
  res.end(homeHtmlBuf);
});


app.get('/test.html', (req, res) => {
  if (!config.ui.testUiEnabled) return res.status(404).end('disabled');
  const body = Buffer.from(testHtml());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
});

app.get('/configure', (req, res) => {
  if (!config.ui.configureEnabled) return res.redirect(302, '/manifest.json');
  const body = Buffer.from(configureHtml(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
});

app.get('/manifest.json', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Length', manifestBuf.byteLength);
  res.end(manifestBuf);
});

app.get(['/manifest', '/Manifest', '/Manifest.json'], (_req, res) => {
  res.redirect(301, '/manifest.json');
});

let cachedHealthBuf = null;
let healthCacheTime = 0;
app.get('/health', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (!cachedHealthBuf || now - healthCacheTime > 5000) {
      cachedHealthBuf = Buffer.from(JSON.stringify({
        status: 'ok',
        version: config.app.version,
        uptime: process.uptime(),
        ai: false,
        referenceSync: config.referenceSync,
        providers: await getProvidersStatus(),
        cache: getCacheStatus(),
        breakers: getBreakersStatus(),
        metrics: getProviderMetricsStatus(),
      }));
      healthCacheTime = now;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=5');
    res.setHeader('Content-Length', cachedHealthBuf.byteLength);
    res.end(cachedHealthBuf);
  } catch (err) {
    next(err);
  }
});


app.get('/metrics', (req, res) => {
  const wantsText = String(req.headers.accept || '').includes('text/plain') || req.query.format === 'prometheus';
  if (wantsText) {
    const body = Buffer.from(prometheusMetrics());
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Length', body.byteLength);
    return res.end(body);
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ providers: getProviderMetricsStatus(), cache: getCacheStatus(), breakers: getBreakersStatus() });
});

app.use(subtitlesRoute);
app.use(errorHandler);

const server = app.listen(config.server.port, () => {
  console.log(`[Server] ${config.app.name} running on port ${config.server.port}`);
});

async function shutdown(signal) {
  console.log(`\n[Server] received ${signal} — shutting down gracefully`);
  server.close(async () => {
    await closeRedis();
    console.log('[Server] closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[Server] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
