import { config } from '../config.js';

export function homePageHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${config.app.name}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:32px;line-height:1.8;max-width:900px}a{display:inline-block;margin:.25rem .5rem .25rem 0}footer{margin-top:2rem;color:#64748b}</style></head><body><h1>${config.app.name}</h1><p>إضافة ترجمات عربية مباشرة لـ Stremio، بفحص جودة حتمي وبدون ذكاء اصطناعي.</p><p><a href="/manifest.json">Manifest</a><a href="/health">Health</a><a href="/resolver.html">Resolver</a><a href="/vault.html">Vault</a><a href="/admin.html">Admin</a></p><footer><small>الإصدار ${config.app.version}</small></footer></body></html>`;
}
