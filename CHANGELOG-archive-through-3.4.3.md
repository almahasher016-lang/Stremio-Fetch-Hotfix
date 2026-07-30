# Changelog

## 3.4.3 - Admin Gate and CI Hardening
- Required administrator authentication before parsing JSON or form bodies on Vault, version-registry, and Companion write routes.
- Added a separate configurable per-IP rate limit for administrative write requests.
- Removed unused duplicate Vault, home, test, and configuration HTML implementations.
- Added enforced coverage floors, package-signature verification, package-content inspection, and Docker builds to continuous integration.
- Corrected the Stremio update instructions so the stable add-on ID is updated in place without deleting the installed entry.

## 3.4.2 - Request-Safe Metadata and Stable RTL
- Cached raw Cinemeta payloads instead of request-specific video identities, preserving exact filenames and release hints on every lookup.
- Shared concurrent metadata fetches without leaking movie or episode identity between callers.
- Rebuilt each cached series episode independently, including its title, duration, season, episode, and release fingerprint.
- Canonicalized trailing bidi controls and whitespace so Arabic direction processing is exactly idempotent.
- Bumped search and processed-subtitle cache namespaces so stale ranking and punctuation results are not reused.
- Updated express-rate-limit to the latest compatible 8.6.1 maintenance release.
- Expanded deterministic coverage to 148 tests: 147 passing and one opt-in live provider contract skipped locally.

## 3.4.1 - Arabic Bidirectional Punctuation
- Added deterministic RLI/PDI isolation to Arabic-dominant normalized SRT cue lines.
- Added an RLM compatibility mark after terminal punctuation while preserving Latin-dominant and numeric-only lines.
- Continued stripping untrusted upstream bidi controls before inserting balanced resolver-owned controls.
- Bumped the processed-subtitle cache namespace so previously cached uncorrected cues are not reused.
- Expanded deterministic coverage to 141 tests with 140 passing and one opt-in live contract test skipped locally.

## 3.4.0 - Styled Subtitles and Media Identity
- Added optional native ASS/SSA delivery while preserving the normalized SRT path.
- Fixed public Stremio CORS handling and exposed archive-entry diagnostics for styled subtitle routes.
- Added deterministic edition matching for Extended, Director's Cut, Theatrical, Unrated, IMAX, and Remastered releases.
- Added ffprobe-derived FPS, resolution, video codec, pixel format, HDR, audio codec, channel layout, and container identity.
- Persisted Companion season, episode, and stream facts in the version registry and restored them during catalog-only requests.
- Added recursive media-library scans, polling watch mode, atomic local indexing, unchanged-file skipping, and explicit rescans.

## 3.3.0 - Release-First Ranking and Operations
- Added deterministic release-match tiers that take precedence over provider popularity and Vault preference whenever Stremio supplies release metadata.
- Added streaming-service, audio codec, channel layout, bit depth, frame-rate, codec-family, and stricter WEB-DL/WEBRip parsing.
- Added exact-release badges and release-match diagnostics to preview results.
- Added a real closed/open/half-open circuit breaker with one probe, bounded exponential recovery, cancellation handling, and manual reset.
- Added per-provider concurrency and request-spacing limits.
- Added Retry-After support and bounded exponential jitter to provider retries.
- Added provider P50/P95 latency, Prometheus histograms, L1/L2 cache counts, and aggregate cache hit ratio.
- Added an administrator dashboard, scoped cache clearing, and breaker reset endpoints.
- Added Vault file drag-and-drop, binary-safe base64 uploads, validated JSON export/import, and deletion controls.
- Expanded deterministic coverage to 124 tests with 123 passing and one opt-in live contract test skipped locally.

## 3.2.0 - Private Production Hardening
- Removed all embedded credentials and made runtime settings environment-first.
- Added production startup validation for distinct strong proxy and administrator secrets.
- Protected administrative search, Vault, registry, detailed health, and metrics endpoints while retaining public Stremio resources.
- Resolved Vault subtitles internally through signed proxy tokens instead of exposing direct storage paths.
- Added compressed, bounded signed tokens and source-specific fallback synchronization/reference plans.
- Fixed Arabic-ratio calculation, cue-count and duration-coverage enforcement, and fallback on every hard quality failure.
- Fixed preview-to-asset mapping and disabled fallbacks while an administrator previews a candidate.
- Enforced machine-translation exclusion at the final result boundary.
- Prevented credential-bearing HTTP headers from crossing origins on redirects and corrected redirect method semantics.
- Made complete YIFY outages observable while preserving valid empty-result behavior.

## 3.1.3 - Arabic Content Fallback
- Enforced the existing Arabic quality gate against provider files that are mislabeled as Arabic.
- Added a bounded, signed fallback chain so a bad or unavailable top result transparently falls through to the next ranked Arabic candidate.
- Automatically records low-Arabic provider assets as rejected for the matched movie or episode.
- Added fallback observability through `X-Subtitle-Fallback` and token-chain regression coverage.

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
