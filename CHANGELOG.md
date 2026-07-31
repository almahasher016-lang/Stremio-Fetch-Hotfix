# Changelog

## 3.5.3 - Audited Stremio Subtitle Delivery
- Restored deterministic Arabic punctuation stabilization in a plaintext-safe response stage.
- Applied `Cache-Control: no-transform` before compression to SRT, ASS, SSA, VTT, and late-mutated HTML responses.
- Placed the direct Original subtitle before Auto Sync and Reference Sync options for faster, safer selection.
- Versioned Stremio subtitle option IDs to invalidate client-side cached entries after delivery fixes.
- Disabled stale search-result delivery by default so expired provider URLs are not returned unless explicitly enabled.
- Added regression tests for option ordering, ID cache busting, and response transformation policy.

## 3.5.2 - Emergency Response-Corruption Hotfix
- Removed unsafe SRT mutation from the generic response interceptor after it could encounter compressed response bytes.
- Kept Railway service availability while the end-to-end subtitle path was audited.

## 3.5.1 - Deterministic Arabic Punctuation Anchoring
- Added dual right-to-left anchors around every Arabic-dominant SRT cue line.
- Stabilized terminal punctuation, leading dialogue marks, paired brackets, braces, and quotation marks.
- Preserved mixed Latin release names and numbers inside an isolated Arabic paragraph.
- Reprocessed outgoing SRT responses so previously cached subtitles receive the correction immediately.
- Added deterministic, idempotent regression coverage for punctuation, brackets, mixed scripts, timings, indexes, and numeric dialogue.

## 3.5.0 - Modern Distributed Production Stack
- Added Redis-backed distributed rate limiting with graceful local fallback.
- Added local and distributed singleflight around subtitle searches.
- Preserved the proven resolver and runtime as immutable Core modules behind modern wrappers.
- Pinned the Node container and every GitHub Action by immutable digest or commit SHA.
- Hardened containers with a non-root user, read-only filesystem support, dropped capabilities, and no-new-privileges.
- Added ESLint, TypeScript checking, CodeQL, CycloneDX SBOM generation, Trivy scanning, and Dependabot.
- Added optional OpenTelemetry OTLP/HTTP tracing with trace IDs exposed in responses.
- Added per-request CSP nonces and automatic nonce injection for every HTML style and script block.
- Kept the stable Stremio add-on ID so installed clients update in place.

## Previous releases
The complete changelog through v3.4.3 is preserved in `CHANGELOG-archive-through-3.4.3.md`.
