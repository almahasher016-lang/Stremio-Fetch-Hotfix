# Changelog

## 3.5.4 - Route-Level Response Finalization
- Removed the global Express `use` and `res.end` interception that conflicted with `compression` and could reset SRT and HTML connections after headers were sent.
- Added explicit route-level senders for SRT, Vault SRT, ASS/SSA, and HTML responses.
- Stabilized Arabic SRT text before delivery and allowed compression only after a sensitive text body is finalized.
- Required HTML script and style nonces to match the exact nonce in `res.locals.cspNonce` and the CSP header.
- Added live Express and compression tests for small and large SRT, styled subtitles, and CSP-protected HTML.
- Preserved explicit `ADDON_NAME` values without appending the release number.
- Unified cache and rate limiting on one retryable singleflight Redis connection.
- Made telemetry shutdown idempotent and fixed Node signal typing.
- Fixed existing lint, typecheck, and Redis test failures.

## 3.5.3 - Delivery Audit Attempt
- Placed the direct Original subtitle before synchronization options and versioned Stremio option IDs.
- Disabled stale search-result delivery by default.
- Attempted response-level Arabic stabilization, but the global interception architecture conflicted with Express compression. Version 3.5.4 replaces it completely.

## 3.5.2 - Emergency Response-Corruption Hotfix
- Removed unsafe SRT mutation from the generic response interceptor after it could encounter compressed response bytes.

## 3.5.1 - Deterministic Arabic Punctuation Anchoring
- Added dual right-to-left anchors around Arabic-dominant SRT cue lines.
- Stabilized punctuation, paired brackets, braces, quotation marks, mixed Latin names, and numbers.
- Added deterministic and idempotent regression coverage.

## 3.5.0 - Modern Distributed Production Stack
- Added Redis-backed distributed rate limiting and distributed singleflight.
- Hardened the Node container and pinned GitHub Actions.
- Added ESLint, TypeScript, CodeQL, CycloneDX SBOM, Trivy, Dependabot, and optional OpenTelemetry.
- Added CSP nonces and kept the stable Stremio add-on ID.

## Previous releases
The complete changelog through v3.4.3 is preserved in `CHANGELOG-archive-through-3.4.3.md`.
