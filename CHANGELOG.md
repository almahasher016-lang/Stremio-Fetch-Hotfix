# Changelog

## 3.5.6 - Evidence-First Subtitle Ranking
- Changed subtitle ordering so exact and provider-confirmed hashes remain the strongest evidence.
- Reduced WEB-DL, BluRay, resolution, release-group, codec, service, audio, HDR, and FPS labels to secondary ranking signals.
- Removed release-name tier as a primary sort key and diversified plausible alternatives from different release families.
- Renamed release badges to avoid claiming synchronization from filename metadata alone.
- Bumped the public manifest version while preserving the stable add-on ID.

## Unreleased - Evidence-First Subtitle Ranking
- Stopped sorting release-name tiers ahead of the actual subtitle score.
- Reduced WEB-DL, BluRay, resolution, release group, codec, HDR, service, audio, and FPS labels to weak secondary signals.
- Preserved exact and provider-confirmed hash evidence as the strongest ordering signal.
- Added bounded release-family diversification and renamed misleading exact-release badges.
- Added regression coverage for Vault precedence, hash precedence, and useful alternative results.

## 3.5.5 - Production Administration Hardening
- Added a dedicated distributed limiter for failed administrative authentication attempts without charging successful requests.
- Made stale-while-revalidate disabled in the core configuration until short-lived download links are separated from long-lived search results.
- Disabled the test UI by default in production and required `ADMIN_TOKEN` to be configured explicitly instead of relying on legacy token aliases.
- Raised the Morgan dependency floor to 1.11.0 while preserving reproducible `npm ci` installs.
- Added a late graceful-shutdown connection drain, favicon handling, a consistent JSON 404 response, and a separate home-page UI module.
- Added `SECURITY.md` and regression coverage for production defaults, explicit token configuration, administrative auth limiting, favicon, and 404 behavior.

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
