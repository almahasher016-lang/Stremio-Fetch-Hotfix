# Coverage Engine

The resolver follows a **coverage-first + proof-first** policy.

## Zero-result invariant

A final empty result is authoritative only when exhaustive recovery has attempted every configured provider that supports the requested media type, none of those attempts failed, and every safe identity lookup path has been exhausted.

Coverage summaries distinguish:

- `candidates-found`: at least one identity-safe Arabic candidate survived discovery/ranking.
- `confirmed-empty`: all eligible providers were attempted successfully and no candidate survived.
- `search-incomplete`: one or more required provider calls failed; this is not proof that subtitles do not exist.

Incomplete empty searches are not promoted to Last-Known-Good truth.

## Search waves

The normal resolver stays fast and uses its existing staged search. Exhaustive coverage runs only after the normal pool has no live verified subtitle.

The exhaustive pass includes:

1. exact hash where supported;
2. IMDb/TMDb metadata search;
3. release filename search;
4. relaxed title search;
5. alternate-title search;
6. metadata search without a year constraint;
7. title search without a year constraint;
8. catalog/release year variants when metadata and playback release years differ;
9. series episode forms such as `S01E02` and `1x02`, plus episode title when available.

All eligible providers are used in exhaustive recovery; the normal first-wave provider cap does not apply.

## Identity boundary

Hard rejection is reserved for evidence that the subtitle is for another work or episode:

- media type conflict;
- explicit IMDb conflict;
- explicit TMDb conflict;
- season conflict;
- episode conflict.

Release characteristics are compatibility evidence, not work identity. A mismatch in release year, source family, quality, release group, edition, codec or FPS lowers confidence/ranking but does not by itself erase an otherwise same-work subtitle.

## Availability tiers

V5 remains the proof authority and output policy. Returned rows expose a stable `availabilityTier`:

- `EXACT`: exact video/hash evidence;
- `CERTIFIED`: V5 certified proof;
- `SAFE`: same-work safe result with sufficient proof;
- `RECOVERY`: usable same-work fallback whose exact timeline is not proven.

A wrong-work or wrong-episode result is never converted into `RECOVERY` merely to avoid an empty response.

## Last-resort rescue

Hearing-impaired subtitles remain eligible during recovery and are penalized by ranking. Machine-translated Arabic remains excluded in the normal exhaustive pass, but may enter the final rescue candidate pool when it is otherwise the only Arabic option. It still has a large score penalty and must survive live delivery/content preflight and V5 proof policy.

Malformed files, non-Arabic content, dead delivery links and explicit identity conflicts remain rejected.

## Coverage ledger

Every exhaustive search records:

- eligible providers;
- attempted, completed and failed providers;
- provider call counts and candidate counts;
- attempted search stages;
- raw, unique and ranked candidate totals;
- coverage ratio;
- complete/degraded/failed status;
- confirmed-empty vs search-incomplete state;
- whether last-resort rescue was needed.

The ledger is logged as `[coverage]` for production diagnostics.

## Regression protection

The repository includes:

- a golden identity corpus covering movies, year drift, source/edition/FPS differences and series episode safety;
- deterministic fuzz tests that mutate hundreds of release names while preserving work identity and separately verify that wrong series episodes never cross the hard boundary;
- unit tests for all-provider coverage, coverage ledger semantics, last-resort filtering and candidate-pool preservation;
- a production smoke matrix that checks known-Arabic movie and series requests after pushes to `main`.

The smoke workflow is an external availability check; deployment identity is additionally verified through Railway deployment status/logs during release verification.
