# Changelog

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
