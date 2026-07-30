import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import subtitlesRoute from './api/routes/subtitles.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { adminWriteLimiter, apiLimiter } from './api/middleware/rateLimit.js';
import { requestId } from './api/middleware/requestId.js';
import {
  getBreakersStatus,
  getProviderLimitersStatus,
  getProvidersStatus,
  getProviderMetricsStatus,
  resetProviderBreaker,
} from './services/subtitleService.js';
import { clearCache, closeRedis, getCacheStatus } from './cache/redis.js';
import { createManifest, getBaseUrl } from './utils/stremio.js';
import { config, validateRuntimeConfig } from './config.js';
import { prometheusMetrics } from './utils/metrics.js';
import { redactRequestUrl } from './utils/logging.js';
import { flushVaultWrites } from './services/vaultService.js';
import { versionRegistry } from './services/versionRegistryService.js';
import { assertAdminAuth } from './api/middleware/adminAuth.js';
import { adminPageHtml } from './ui/adminHtml.js';

validateRuntimeConfig(config);
const app = express();
const manifestJson = createManifest();
const manifestBuf = Buffer.from(JSON.stringify(manifestJson));

if (config.server.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.disable('etag');

function publicStremioPath(pathname) {
  return /^\/(?:manifest(?:\.json)?|Manifest(?:\.json)?)$/.test(pathname)
    || /^\/(?:subtitles?|proxy\/(?:encoding|styled))\//.test(pathname);
}

function ownRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try {
    return host ? new URL(`${proto}://${host}`).origin : '';
  } catch {
    return '';
  }
}

// Stremio resources stay cross-origin public. Administrative APIs never use wildcard CORS.
app.use((req, res, next) => {
  if (publicStremioPath(req.path)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Origin, Range, Stremio-User-Agent, X-Request-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, X-Request-Id, X-Source-Encoding, X-Source-Format, X-Source-Archive, X-Source-Archive-Entry, X-Sync-Confidence, X-Subtitle-Fallback');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  } else {
    const origin = String(req.headers.origin || '');
    const allowed = new Set(config.admin.allowedOrigins);
    if (config.app.publicBaseUrl) allowed.add(new URL(config.app.publicBaseUrl).origin);
    const ownOrigin = ownRequestOrigin(req);
    if (ownOrigin) allowed.add(ownOrigin);
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'Origin is not allowed' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, X-Request-Id');
    }
  }
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

app.use(requestId);
app.use(compression({ threshold: 1024, level: 1 }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));
morgan.token('safe-url', req => redactRequestUrl(req.originalUrl || req.url));
morgan.token('safe-referrer', req => {
  const referrer = req.headers.referer || req.headers.referrer;
  return referrer ? redactRequestUrl(referrer) : '-';
});
const accessLogFormat = ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":safe-referrer" ":user-agent"';
app.use(morgan(config.server.isProd ? accessLogFormat : ':method :safe-url :status :response-time ms', {
  skip: req => req.path === '/health' || req.path === '/manifest.json',
}));
app.use(apiLimiter);
app.use(adminWriteLimiter);

const publicHomeHtmlBuf = Buffer.from(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:32px;line-height:1.8;max-width:900px}a{display:inline-block;margin:.25rem .5rem .25rem 0}footer{margin-top:2rem;color:#64748b}</style></head><body><h1>${config.app.name}</h1><p>إضافة ترجمات عربية مباشرة لـ Stremio، بفحص جودة حتمي وبدون ذكاء اصطناعي.</p><p><a href="/manifest.json">Manifest</a><a href="/health">Health</a><a href="/resolver.html">Resolver</a><a href="/vault.html">Vault</a><a href="/admin.html">Admin</a></p><footer><small>الإصدار ${config.app.version}</small></footer></body></html>`);

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function secureConfigureHtml(req) {
  const manifestUrl = `${getBaseUrl(req)}/manifest.json`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Configure ${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:24px;line-height:1.8;max-width:900px}input{direction:ltr;width:100%;padding:.6rem;box-sizing:border-box}footer{margin-top:2rem;color:#64748b}</style></head><body><h1>إعداد ${config.app.name}</h1><p>تم حفظ أسرار التشغيل في Railway. لا تضع رمز الإدارة أو مفاتيح المزودات داخل رابط Stremio.</p><label>رابط Stremio</label><input readonly value="${htmlEscape(manifestUrl)}" onclick="this.select()"><p><a href="/manifest.json">Manifest</a> · <a href="/health">Health</a> · <a href="/resolver.html">Resolver</a></p><footer><small>الإصدار ${config.app.version} · معالجة حتمية بدون ذكاء اصطناعي</small></footer></body></html>`;
}

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Length', publicHomeHtmlBuf.byteLength);
  res.end(publicHomeHtmlBuf);
});


app.get('/test.html', (req, res) => {
  if (!config.ui.testUiEnabled) return res.status(404).end('disabled');
  return res.redirect(302, '/resolver.html');
});

app.get('/configure', (req, res) => {
  if (!config.ui.configureEnabled) return res.redirect(302, '/manifest.json');
  const body = Buffer.from(secureConfigureHtml(req));
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

app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, max-age=5');
  res.json({ status: 'ok', version: config.app.version, ai: false });
});

app.get('/admin.html', (_req, res) => {
  const body = Buffer.from(adminPageHtml());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
});

app.get('/api/admin/health', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      status: 'ok',
      version: config.app.version,
      uptime: process.uptime(),
      ai: false,
      referenceSync: config.referenceSync,
      providers: await getProvidersStatus(),
      cache: getCacheStatus(),
      breakers: getBreakersStatus(),
      limiters: getProviderLimitersStatus(),
      metrics: getProviderMetricsStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/cache/clear', async (req, res, next) => {
  try {
    assertAdminAuth(req);
    const scope = String(req.query.scope || 'all').toLowerCase();
    if (!['all', 'search', 'encoding'].includes(scope)) {
      return res.status(400).json({ error: 'Unsupported cache scope' });
    }
    const result = await clearCache(scope);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, result });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/admin/breakers/:provider/reset', (req, res, next) => {
  try {
    assertAdminAuth(req);
    const provider = String(req.params.provider || '').toLowerCase();
    if (!resetProviderBreaker(provider)) return res.status(404).json({ error: 'Unknown provider' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, provider, breaker: getBreakersStatus()[provider] });
  } catch (error) {
    return next(error);
  }
});


app.get('/metrics', (req, res, next) => {
  try {
    assertAdminAuth(req);
    const wantsText = String(req.headers.accept || '').includes('text/plain') || req.query.format === 'prometheus';
    if (wantsText) {
      const body = Buffer.from(prometheusMetrics());
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', body.byteLength);
      return res.end(body);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      providers: getProviderMetricsStatus(),
      cache: getCacheStatus(),
      breakers: getBreakersStatus(),
      limiters: getProviderLimitersStatus(),
    });
  } catch (error) {
    return next(error);
  }
});

app.use(subtitlesRoute);
app.use(errorHandler);

const server = app.listen(config.server.port, () => {
  console.log(`[Server] ${config.app.name} running on port ${config.server.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Server] received ${signal} — shutting down gracefully`);
  server.close(async () => {
    try {
      await Promise.all([flushVaultWrites(), versionRegistry.flush(), closeRedis()]);
      console.log('[Server] closed');
      process.exit(0);
    } catch (error) {
      console.error('[Server] shutdown failed:', error.message);
      process.exit(1);
    }
  });
  setTimeout(() => {
    console.error('[Server] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
