# Changelog

## 3.1.2 - End-to-End Download Recovery
- Normalized outbound header names case-insensitively so OpenSubtitles receives exactly one required User-Agent value.
- Converted YIFY detail links into direct subtitle ZIP links instead of proxying HTML pages.
- Added the browser-compatible User-Agent and detail-page referrer required for YIFY archive downloads while retaining DNS-pinned URL validation.
- Added regression coverage for provider headers, YIFY link parsing, and provider-specific archive request headers.

## 3.1.1 - Live Provider Recovery
- Restored Railway provider connectivity by using normal platform DNS for fixed trusted API origins while retaining DNS-pinned SSRF protection for untrusted subtitle URLs and cross-origin redirects.
- Corrected SubSource availability detection so a missing API key cannot consume a provider slot.
- Restored the YIFY movie fallback when SubSource is not configured.
- Preserved the underlying provider failure in health metrics when the circuit breaker skips later requests.
- Bumped the resolver release key to invalidate cached empty v3.1.0 searches.

## 3.1.0 - Deterministic Hardening
- Added signature-based ZIP, GZIP, and XZ extraction with strict expanded-size and archive-entry limits.
- Added deterministic Arabic subtitle selection for multi-file ZIP archives, including ASS and SSA entries.
- Added WebVTT and ASS/SSA to normalized SRT conversion, BOM-less UTF-16 detection, and preservation of numeric dialogue lines.
- Added DNS-pinned SSRF protection across provider requests and subtitle redirects, private/reserved address blocking, bounded provider responses, and redacted sensitive request logging.
- Added real AbortSignal propagation so expired provider stages stop HTTP work and retry backoff.
- Made Personal Vault and version-registry persistence atomic and serialized, with graceful-shutdown draining.
- Added bounded deterministic DTW alignment, robust anchor outlier removal, and conservative strategy selection.
- Added weekly live provider search-contract checks without subtitle download calls.
- Upgraded the supported production runtime and CI to Node.js 24 LTS and the current Express 5, Undici 8, Helmet 8, and express-rate-limit 8 majors.
- Added and committed a reproducible npm lockfile and switched Docker/CI installs to `npm ci`.

## 3.0.1 - Direct Stremio Update
- Preserved the original Stremio addon ID so existing installations update in place.
- Removed the unsupported Docker volume instruction so Railway builds and deploys successfully.
- Bumped the public release version after the production deployment fixes.

## 3.0.0 - Exact Version Resolver
- Added video identity normalization for Stremio metadata, video hash, size, release, and episode IDs.
- Added staged provider search, hash-only exact matching, metadata resolution, and provider capability filtering.
- Added a persistent trusted version registry with verify, reject, suggestion, and local-media records.
- Added Arabic subtitle quality analysis and conservative piecewise reference synchronization.
- Added `/resolver.html`, registry APIs, and a Windows local companion that calculates the OpenSubtitles hash and can import embedded Arabic subtitle streams.
- Added persistent Docker volume support and focused v3 tests.
- Made Railway deployment zero-config: automatic Railway public-domain detection, automatic `PORT` handling, and no required `.env` file.

## 2.3.3 - Stremio Fetch/CORS Hotfix
- Fixed Stremio Desktop/Web `Failed to fetch` manifest issue by adding explicit unconditional cross-origin headers.
- Disabled Helmet cross-origin resource blocking for manifest/subtitle resources.
- Fixed wildcard origin handling so `ALLOWED_ORIGINS=*` remains a true wildcard instead of an array value.


## v2.3.3 — Fully Locked Private Ready

- نقل جميع أرقام التشغيل الخاصة بالمشروع إلى `src/config.js` داخل `PRIVATE_DEFAULTS`.
- تثبيت مفاتيح OpenSubtitles وSubDL وسر البروكسي وتوكن Personal Vault داخل المشروع كما طلب المستخدم.
- جعل `setting()` يرجع القيم الداخلية مباشرة بدل الاعتماد على Railway Variables.
- تثبيت ترتيب Stremio وعدد النتائج داخل المشروع: `TOP_N=5`, `MAX_PROVIDER_ITEMS=60`, `STREMIO_MAX_SUBTITLES=6`.
- تثبيت YIFY وPersonal Vault وReference Sync وCache وRate Limit داخل المشروع.
- تحديث اسم الإضافة والإصدار إلى `m7md Arabic Direct 2.3.3`.
- تنظيف `.env.example` ليؤكد أن Railway Variables غير مطلوبة لهذه النسخة الخاصة.
- لا يوجد `package-lock.json` داخل الحزمة.

## v2.3.1 — Ranking Precision Private Ready

- شد ترتيب النتائج حسب Hash/Release/Quality/Source/Synchronization.
- تقليل النتائج الظاهرة داخل Stremio.
- جعل Reference Sync يظهر فقط لأفضل النتائج.
