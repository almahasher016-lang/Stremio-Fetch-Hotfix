# m7md Arabic Direct v2.3.3 — Fully Locked Private Ready

إضافة Stremio عربية خاصة لجلب الترجمات العربية وترتيبها حسب دقة المطابقة والتوقيت، بدون ذكاء اصطناعي وبدون الاعتماد على بروكسي Stremio المحلي.

## الحالة

هذه نسخة خاصة ومقفلة الإعدادات. جميع أرقام المشروع ومفاتيح المزودات وتفضيلات Stremio موجودة مباشرة داخل:

```text
src/config.js
```

لا تحتاج إلى لصق أرقام المشروع داخل Railway Variables لهذه النسخة.

## القيم المقفلة داخل المشروع

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://pleasing-gentleness-production.up.railway.app
SUBTITLE_PROVIDERS=opensubtitles,subdl,subsource,yify
TOP_N=5
MAX_PROVIDER_ITEMS=60
STREMIO_MAX_SUBTITLES=6
STREMIO_REFERENCE_TOP=2
STREMIO_AUTOSYNC_TOP=1
STREMIO_ORIGINAL_TOP=5
MIN_RANK_SCORE=180
STRICT_RELEASE_MATCHING=true
PROVIDER_EXCLUDE_HEARING_IMPAIRED=true
PROVIDER_EXCLUDE_MACHINE_TRANSLATED=false
PROVIDER_TIMEOUT_MS=10000
PROVIDER_RETRIES=3
CACHE_TTL=3600
CACHE_STALE_SECONDS=21600
SEARCH_CACHE_TTL=3600
SUBTITLE_CACHE_TTL=86400
FAILURE_CACHE_TTL=120
CACHE_REFRESH_LOCK_TTL=60
MEMORY_CACHE_MAX_ITEMS=750
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=180
YIFY_ENABLED=true
YIFY_MAX_ITEMS=8
PERSONAL_VAULT_ENABLED=true
PERSONAL_VAULT_UPLOAD_ENABLED=true
PERSONAL_VAULT_PREFER=true
PERSONAL_VAULT_MAX_ITEMS=500
PERSONAL_VAULT_MAX_SUBTITLE_BYTES=2000000
REFERENCE_SYNC_MIN_CONFIDENCE=72
REFERENCE_SYNC_MIN_CUES=8
REFERENCE_SYNC_MIN_CUE_RATIO=0.55
REFERENCE_SYNC_MAX_ANCHORS=48
REFERENCE_SYNC_ATTACH_TOP=1
AUTO_SYNC_MIN_CONFIDENCE=70
ENCODING_PROXY_CACHE_TTL=86400
ENCODING_PROXY_LINK_TTL=604800
ENCODING_PROXY_MAX_BYTES=1500000
ENCODING_PROXY_MAX_REDIRECTS=4
```

## روابط بعد النشر

```text
https://pleasing-gentleness-production.up.railway.app/manifest.json
https://pleasing-gentleness-production.up.railway.app/health
https://pleasing-gentleness-production.up.railway.app/test.html
https://pleasing-gentleness-production.up.railway.app/vault.html
https://pleasing-gentleness-production.up.railway.app/metrics
```

## الرفع إلى GitHub

فك الضغط، ثم ارفع محتويات المجلد إلى جذر المستودع مباشرة:

```text
src/
package.json
Dockerfile
railway.json
README.md
CHANGELOG.md
.env.example
.gitignore
```

لا ترفع ملف ZIP نفسه، ولا ترفع `package-lock.json`.
