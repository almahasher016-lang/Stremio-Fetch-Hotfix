## 5.1.5 - 2026-09-09

- Add the public Stremio OpenSubtitles v3 provider as a credential-free availability fallback.
- Normalize only the requested language and bind every result to the exact requested IMDb/episode identity.
- Restrict provider download URLs to HTTPS hosts under `strem.io` before Accuracy Preflight.
- Update the default SubSource API base URL to the documented `/api/v1` path.

## 5.1.4 - 2026-09-09

- تمرير هوية Cinemeta المثرية إلى تقييم V5 بدل تقييم معرّف IMDb كعنوان خام.
- إضافة إنقاذ توفر محدود في `balanced`: مرشح `RECOVERY` واحد فقط عند غياب النتائج الأقوى.
- إبقاء المرشحين `WITHHOLD` و`REJECT` محجوبين دون استثناء.

## 5.1.3 - 2026-09-09

- منع فشل تقييم V5 من إرجاع قائمة فارغة عند وجود مرشحين اجتازوا مسار Accuracy Preflight.
- إبقاء الترجمات ذات الحالة `rejected` وروابط `deliveryFailure` خارج مسار fallback الآمن.
- تشغيل V5 في Railway بوضع `balanced` مع تعطيل وضع `shadow`.

## 5.1.2 - 2026-09-09

- Harden V5 identity authority after production smoke exposed a cross-title `Supergirl.2026` result for `Spider-Man: Brand New Day 2026`.
- Require strong work-title agreement before exact-metadata provenance can stand in for a provider row that does not echo IMDb/TMDb/hash identity.
- Separate work-title matching from technical release-family similarity so year/source/resolution cannot promote the wrong movie.
- Preserve creator-prefixed/canonical-title compatibility while keeping explicit catalog mismatches as hard rejects.
- Add regressions for cross-title leakage, correct metadata fallback, creator-prefixed titles, and explicit wrong catalog IDs.

## 5.1.1 - 2026-09-09

- Add post-preflight deep recovery so mislabeled/non-Arabic/Persian/broken first candidates trigger a broader provider search instead of terminating recovery early.
- Paginate OpenSubtitles safely across advertised pages with bounded deduplication and `MAX_PROVIDER_ITEMS` enforcement.
- Make Accuracy Preflight adaptive across candidate batches and never treat uninspected rows as survivors.
- Keep multiple same-release candidates through deep recovery until content inspection identifies the actually valid Arabic file.
- Persist only live-verified valid candidates into Final LKG and revalidate fallback availability before reuse.
- Treat movie-specific YIFY 404/410 as authoritative empty results instead of provider outages or stale-LKG triggers.
- Add regressions for deep candidate inspection, OpenSubtitles pagination, YIFY not-found handling, and uninspected-candidate leakage.

## 5.1.0 - 2026-09-08

- Add Universal Video Identity + Timeline Matcher with format-agnostic container and release normalization.
- Treat resolution, codec, HDR and container differences as visual diagnostics rather than timing conflicts.
- Use exact video hash, measured duration, FPS, edition/cut, normalized source family, service, and release group as independent timeline evidence.
- Normalize WEB/BluRay/REMUX/HDTV/DVD/CAM families and major streaming-service aliases while keeping unknown formats neutral.
- Derive clean fallback titles from technical filenames and add a normalized timeline LKG cache key across compatible visual encodes.
- Revalidate Last-Known-Good subtitle candidates with live Accuracy Preflight before V5 proof evaluation.
- Add regressions for The Devil Wears Prada 2, Euphoria, exact hash, format variants, unknown containers, and hard FPS/edition/duration conflicts.

## 5.0.1 - 2026-09-08

- Restore valid Arabic subtitle availability by separating timing-family evidence from visual resolution/codec metadata.
- Normalize BluRay/UHD-BluRay REMUX timing families while preserving WEB/BluRay separation and hard edition/FPS conflicts.
- Treat conflict-free exact-metadata catalog search provenance as strong identity evidence when providers do not echo IMDb/TMDb per result.
- Add detailed V5 proof telemetry and regressions for The Devil Wears Prada 2, same-episode WEB-DL resolution variants, title fallback, edition conflicts, and FPS conflicts.

## 4.6.6 - 2026-09-08

## 5.0.0

- Resolver V5 Proof-First with independent identity, Arabic-language, timing, delivery, and integrity proof dimensions.
- Hard rejection for wrong media identity, Persian/Farsi content, terminal dead links, and invalid subtitle files.
- Exact-hash/exact-timeline authority plus provenance-aware multi-source temporal consensus with absolute-bound validation.
- Strict/balanced/recovery output policies, V5 proof badges, and legacy disagreement shadow telemetry.
- Regression corpus covering The Mummy, Spider-Man Persian misclassification, unverified Spider-Man timing, wrong episodes, and exact-hash certification.
- Statistical 99% precision gate requiring at least 500 audited CERTIFIED cases and a Wilson 95% lower bound >= 99%.

- Distinguish Persian/Farsi from Arabic using lexical and orthographic evidence instead of Arabic-script Unicode alone.
- Hard-reject Persian subtitle content in Accuracy Preflight and ZIP entry selection.
- Stop treating Persian language labels/codes as Arabic.
- Rename Q badges to Text Q and label weak timing/release evidence as Timing Unverified.
- Add Spider-Man: Brand New Day shaped regressions for Persian-vs-Arabic selection.

## 4.6.5 - 2026-09-08

- Preserve upstream HTTP status metadata when remote subtitle downloads are wrapped as proxy 502 errors.
- Treat wrapped upstream 403/404/410 as terminal delivery failures during accuracy preflight instead of temporary fail-open failures.
- Add a production-shaped regression for the observed The Mummy 2026 failure (proxy 502 carrying upstream 404).

## 4.6.4 - 2026-09-08

- Require fresh reachability validation for remote subtitle sources even when stored quality is already valid.
- Add timestamped preflight outcomes and revalidate remote cached results after a two-minute freshness window.
- Expand default accuracy preflight coverage from five to ten candidates so every default Stremio result is checked.
- Preserve local Personal Vault shortcuts and temporary-network fail-open behavior while keeping terminal 403/404/410 sources excluded.

## 4.6.3 - 2026-09-08

- Add identity-authority gating so explicit episode/catalog evidence outranks generic title fallbacks.
- Remove subtitle candidates whose live preflight proves terminal HTTP 403/404/410 delivery failure.
- Keep fail-open behavior for uncertain network outages while never resurrecting terminally unreachable sources.
- Add regression coverage for identity-unknown series/movie candidates and dead subtitle delivery sources.

## 4.6.2 - 2026-09-08

- Prefer confirmed Arabic subtitle content before ZIP release-match tiers, while preserving release-family preference between Arabic candidates.
- Accept multi-file episode ZIP archives with generic subtitle filenames and reject only explicit season/episode conflicts.
- Add regression coverage for Arabic-vs-English ZIP selection and generic exact-episode variants, and synchronize corrected release identifiers to 4.6.2.

## 4.6.1 - 2026-09-08

- Reject conflicting catalog IDs, media types, and structured or filename season/episode identities before ranking and deduplication; normalize OpenSubtitles episode IDs to their parent series scope.
- Parse filenames independently of technical hints, retain release groups, and use provider FPS when selecting duplicate candidates.
- Recompute saved fallback rankings for the current release and discard hash/timeline evidence belonging to other videos.
- Carry season zero through identities, provider queries, vault/registry lookup and signed playback context.
- Select ZIP entries using playback episode and release information in both preflight and delivery; reject archives containing only mismatched episodes.
- Scope search/preflight caches to technical and archive-selection context, and add focused identity, remake, archive and stale-evidence regressions.

## 4.6.0 - 2026-09-07

- Rank Arabic subtitles by measured cue-timeline compatibility when an English reference is proven by the exact video hash.
- Measure every candidate in the configured timing-evidence window (default 10), so a correct subtitle cannot be lost merely because metadata ranked it lower initially.
- Classify measured candidates as aligned, repairable, or incompatible using DTW/temporal anchors, cue ratio, coverage, and residuals.
- Keep exact Arabic hash authority and hard identity conflicts above timing evidence; keep transient preflight/reference failures fail-open.
- Preserve v4.5.0 exact-hash delivery sync as the correction stage after measured selection rather than replacing it.

## 4.5.0 - 2026-09-07

- Add a hard identity gate for explicit year/season/episode/edition conflicts while preserving exact-hash authority.
- Qualify strict movie title/alias fallback searches with the target year to prevent remake/title collisions.
- Promote exact-video-hash English timeline references to a stable delivery path independent of generic experimental Reference Sync.
- Automatically derive conservative DTW + piecewise timing correction for exact-hash references only, requiring >=92 confidence, >=0.72 anchor coverage, and >=0.84 temporal agreement.
- Carry stable timing references through original Stremio options and fallback candidates while keeping generic metadata reference sync opt-in.
- Add regression coverage for remake disambiguation, identity conflicts, and exact-hash timeline token delivery.

## 4.4.2 - 2026-09-07

- Reconcile degraded provider responses with the Final Arabic Last-Known-Good pool before returning the response to Stremio, not only before cache writes.
- Never promote a degraded first-ever partial result into the Final LKG when no prior good pool exists.
- Re-run current Accuracy Preflight and Accuracy-First ordering over the reconciled degraded pool.
- Add regression coverage for first-response partial-result poisoning.

## 4.4.1 - 2026-09-06

- Prevent partial non-empty provider cycles from replacing a richer cached timing-compatible candidate pool.
- Merge fresh and previous candidates, then re-run current Accuracy-First ordering before Redis search-cache writes.
- Preserve and re-rank prior candidates during background refresh and Final Arabic Last-Known-Good updates.
- Keep newly discovered exact-video-hash evidence authoritative over preserved heuristic candidates.
- Move `minRankScore` behind Accuracy-First and rescue candidates with strong timing evidence.
- Classify provider cycles as complete/degraded/failed and only merge prior pools on degraded cycles.
- Add a permanent timing regression corpus, including the House of the Dragon BluRay-vs-WEB incident.

## 4.4.0 - 2026-09-06

- Apply timing accuracy ordering to the full plausible candidate pool before TOP_N truncation.
- Make exact-hash provider searches hash/size authoritative instead of ANDing weaker filename and metadata constraints.
- Add passive exact-video-hash English timing-reference evidence for ranking without enabling generic auto-sync.
- Anchor reference lookup to the actual video identity and remove candidate-seeded circular confirmation bias.
- Harden source-family parsing for WEB Remux/WEBMux and BDRemux/BDMV/BluRay aliases.
- Keep final Arabic LKG as availability fallback rather than a fresh-ranking authority and shorten the default search-cache TTL.

## 4.3.0 - 2026-09-06

- Add a version-independent final Arabic Last-Known-Good cache after Accuracy Preflight.
- Prevent Accuracy Preflight from erasing the entire Arabic list when all inspected candidates hard-reject.
- Version Accuracy Preflight decision keys with the application release to invalidate stale false rejections on deploy.
- Reduce hard-rejection cache TTL to three minutes with no stale extension; valid quality decisions retain the normal cache TTL.
- Serve fresh exact/release LKG immediately, while catalog-level LKG remains fallback-only to avoid forcing a mismatched release.

## 4.2.0 - 2026-09-06

- Make Arabic subtitle availability resilient to transient provider failures.
- Never persist empty subtitle search results into Redis or replica-local memory.
- Prefer shared Redis before per-replica memory for subtitle-search cache reads.
- Preserve stale non-empty Last-Known-Good results when a fresh provider search returns empty.
- Prevent Stremio, CDN, and intermediary caches from caching subtitle-list responses; positive lists remain server-side cached.
- Prevent background refresh from overwriting a good cached subtitle list with an empty result.

## 4.1.0 - 2026-09-06

- Eliminate avoidable empty subtitle lists with deterministic strict-to-relaxed Arabic recovery.
- Stop over-constraining provider queries by separating ID-only, release-only, title-only, and alias search shapes.
- Allow OpenSubtitles HI/SDH candidates only when strict search returns nothing; machine translations remain excluded.
- Feed measured Accuracy Preflight content quality back into final ordering and inspect the top five candidates by default.
- Preserve hard season, episode, year, and edition conflict rejection during recovery.

# Changelog

## 4.0.0 - Enterprise Accuracy & SRE

- Add bounded, Redis-cached content preflight for top-ranked subtitle candidates.
- Reject only definitive content failures before Stremio ordering; preserve deterministic hash/release precedence for soft quality issues.
- Add structured ranking explainability to admin preview and `/api/explain`.
- Add runtime SLO evaluation plus preflight/runtime Prometheus metrics.
- Add deployable Prometheus alert rules and Grafana dashboard definitions.
- Preserve shared PostgreSQL/Redis state and horizontal Railway scaling.

## 3.9.0 - Provider Resilience 2.0

- Add Redis-backed YIFY Last-Known-Good parsed-result fallback for live scrape failures and anti-bot challenges.
- Propagate `Retry-After` from text/HTML upstream responses.
- Add deterministic adaptive provider limiting driven by overload and latency outcomes.
- Add regression coverage for YIFY fallback and adaptive limiter recovery.

## 3.8.0 - Shared Durable State

- Add private PostgreSQL-backed Personal Vault storage with local JSON migration fallback.
- Move Version Registry shared state to PostgreSQL transactions with `SELECT ... FOR UPDATE` serialization.
- Add PostgreSQL lifecycle and admin health visibility.
- Keep local-file storage as a development fallback when `DATABASE_URL` is absent.

## 3.7.0 - Enterprise Edge Foundation

- Emit deterministic signed `/assets/encoding/` URLs bound to the application version so identical subtitle recipes reuse a CDN cache key.
- Add an asset delivery fast path with immutable edge-cache headers for primary resolutions and conservative caching when a fallback source wins.
- Add HTTP p50/p95/p99 and event-loop delay Prometheus metrics.
- Enable shared Railway Redis as the distributed cache and refresh-lock layer.
- Preserve legacy `/proxy/encoding/` resolution for already-issued URLs.

## 3.6.4 - Source-Family Ranking Fix

- Prioritize the timing/source family (BluRay, WEB, HDTV, DVD, CAM) before resolution-only similarity.
- Preserve exact hash and hard episode/edition/year/FPS conflicts as stronger evidence.
- Add a regression based on the real House of the Dragon S01E07 BluRay Remux playback case.
- Keep the Stremio add-on ID unchanged so clients recognize this as an update.

## 3.6.3 - Accuracy-First Subtitle Ordering

- Preserved exact video-hash evidence as the strongest subtitle match.
- Prioritized release compatibility before provider score, popularity, or non-hash personal preferences.
- Used verified subtitle quality and trust as tie-breakers after release accuracy.
- Hardened YIFY row parsing by scanning all anchors for a valid subtitle detail link.
- Kept the Stremio add-on ID stable while bumping the public manifest and package version to 3.6.3.

## 3.6.2 - Provider Hygiene and Graceful Cache Refresh

- Rejected SubDL rows without a usable download URL and preserved extended Arabic script characters in provider queries.
- Tracked stale-while-revalidate tasks and drained them before Redis shutdown.
- Added explicit administrative CORS allow/deny coverage for the public base URL and configured admin origins.
- Preserved legitimate dialogue ending in a music note and prevented Latin-dominant lines from being direction-marked because of one leading Arabic letter.
- Reused the detected subtitle format, replaced quadratic output membership checks with a `Set`, and bumped processed caches to `encoding:v12` and `styled:v4`.

## 3.6.1 - Provider Contract and Episode Pack Hardening
- Extracted testable OpenSubtitles request, normalization, and response parsing functions without changing the production result schema.
- Filtered SubDL full-season unpack files to the requested season and episode using structured metadata first and exact release-name evidence only when metadata is absent.
- Added the `client=stremio` request identity and retained SubDL format, size, and MD5 metadata for safer validation and deduplication.
- Added deterministic provider contract coverage, provider start-interval state coverage, and Heap/RSS administration metrics.
- Added a bounded manual Podnapisi discovery probe that records response structure only and leaves the unverified provider outside the production registry.

## 3.6.0 - Safe Text Subtitle Compatibility Engine
- Added content-based conversion for TTML/DFXP, YouTube transcript XML, SAMI, MicroDVD, MPL2, SubViewer/SBV, LRC, and RealText alongside the existing SRT, WebVTT, ASS, and SSA paths.
- Added UTF-32 LE/BE handling and scored Arabic legacy decoding for Windows-1256, ISO-8859-6, DOS CP720, IBM CP864, and MacArabic while retaining UTF-8 and UTF-16 detection.
- Normalized optional-hour timestamps and one-to-nine fractional digits, propagated trusted video FPS to MicroDVD, and refused to guess an absent frame rate.
- Added safe named/numeric entity decoding, Arabic presentation-form normalization, broad text-tag cleanup, and rejection of XML DOCTYPE/ENTITY declarations.
- Expanded safe ZIP candidate extensions and content scoring while retaining archive traversal, expansion-size, entry-count, GZIP, and XZ protections.
- Retained the file-level legacy SRT repair gate and the established conservative punctuation policy, while preserving ASS/SSA headers, styles, tags, karaoke, positions, and drawing commands.
- Added format, encoding, timing, archive, entity, and security regression coverage; bumped caches to `encoding:v11` and `styled:v3` and the public release identity to 3.6.0.

## 3.5.12 - Legacy Arabic SRT Bracket Repair
- Added a subtitle-level detector for repeated legacy Arabic parenthesis layouts found in `Person of Interest S01E01` releases.
- Repaired only deterministic two-parenthesis imbalances and relocated leading terminal punctuation only after the file-level legacy gate succeeds.
- Kept healthy subtitles, isolated malformed lines, balanced brackets, timings, indexes, and mixed-script text unchanged.
- Added regression coverage from the real HDTV subtitle pattern, negative safety cases, processor integration, and exact idempotence.
- Bumped the processed SRT cache namespace to `encoding:v10` and the public release identity to 3.5.12.

## 3.5.11 - Styled ASS/SSA Arabic BiDi Stabilization
- Applied Arabic direction stabilization to the dedicated Styled ASS and SSA delivery path.
- Parsed `[Events]` and its `Format` declaration, then changed only the `Text` field of valid `Dialogue` rows.
- Stabilized each `\\N`/`\\n` visual line independently while preserving override, position, color, karaoke, and HTML tags.
- Preserved ASS drawing commands between nonzero `\\p` mode and `\\p0` without injecting directional controls into vector data.
- Added integration coverage for both `/proxy/styled/*.ass` and `/proxy/styled/*.ssa`, and bumped the Styled cache namespace to `styled:v2`.
- Bumped the public manifest, package, lockfile, and release identity to 3.5.11.

## 3.5.10 - Paired Arabic Bracket Isolation
- Fixed the TV-visible case where a balanced Arabic parenthesis pair was split across the rendered line.
- Wrapped Arabic-dominant cue lines containing a matched bracket pair with Arabic content in exactly one `RLI…PDI` isolate.
- Kept the selective trailing-RLM policy for bracket-free terminal punctuation and avoided injecting marks beside individual brackets.
- Ignored unmatched opening brackets and Latin-only bracket contents while retaining the existing terminal treatment for unmatched closing punctuation.
- Added screenshot-derived, nested-pair, processor-integration, mixed-script, and idempotence regression coverage.
- Bumped the public manifest, package, lockfile, and subtitle cache identity to 3.5.10.

## 3.5.9 - Selective Terminal BiDi Anchoring
- Replaced the broad terminal `\p{P}|\p{S}` policy with an explicit set of sentence-ending marks plus Unicode closing punctuation.
- Stopped adding RLM after generic symbols, mathematical operators, copyright symbols, and opening punctuation.
- Centralized bidi cleanup and cue stabilization in `arabicBidi.js`; `subtitleProcessor.js` now imports the shared implementation.
- Preserved removal of untrusted provider bidi controls before conversion and added regression tests for punctuation, closing brackets, mixed text, and idempotence.
- Bumped the public manifest and subtitle cache identity to 3.5.9.

## 3.5.8 - Terminal Arabic Punctuation Direction
- Fixed terminal Arabic punctuation rendering on Stremio by adding exactly one trailing RLM after a neutral punctuation or closing symbol on Arabic-dominant cue lines.
- Kept internal punctuation and visible character order unchanged, without wrapping full lines in embeddings or isolates.
- Added regression tests based on the user-visible `ربما أنك حلمت بهذا الحدث،` failure and retained idempotent cleanup of upstream bidi controls.
- Bumped the encoding cache namespace and public manifest version while preserving the stable add-on ID.

## 3.5.7 - Conservative Text and Search Reliability
- Removed both layers of resolver-injected RLM/RLI/PDI controls; SRT delivery now strips untrusted bidi controls while preserving every visible bracket, quote, ellipsis, and punctuation mark in source order.
- Disabled metadata-only FPS synchronization and placed all original subtitle candidates before any explicitly enabled experimental transform.
- Added a new `ALLOW_EXPERIMENTAL_SYNC` master gate so legacy Railway flags cannot silently re-enable structural reference sync.
- Expanded the default result pool to ten originals, searched all configured provider stages before truncation, and allowed SubDL metadata, filename, and title search shapes to contribute together.
- Raised reference-sync thresholds and disabled DTW/piecewise warping by default.
- Added regression coverage for paired Arabic punctuation, hidden-control removal, idempotence, safe sync defaults, and explicit manual offsets.

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
