# Resolver V5 — Proof-First Architecture

## Objective

V5 is designed for **precision before availability**. Its default behavior is to withhold a subtitle when the resolver cannot prove enough about it, rather than returning the highest-scoring guess.

The quality target is measured across separate failure classes:

1. media identity — correct movie / correct series season and episode;
2. language — genuinely Arabic subtitle content, not merely Arabic-script text or a provider label;
3. timing — evidence that the subtitle timeline matches the actual playback version;
4. delivery — the returned asset can be fetched now;
5. integrity — the subtitle parses, has usable cues, sane coverage, encoding and structure.

A single aggregate score is not allowed to compensate for a failed proof dimension.

## Decisions

- **CERTIFIED** — eligible for default V5 output. All proof floors cleared.
- **SAFE** — strong result, but at least one dimension is below certified proof. May be exposed as clearly marked fallback.
- **RECOVERY** — plausible but not proven. Never allowed to outrank CERTIFIED or SAFE.
- **WITHHOLD** — insufficient evidence. Not shown in strict mode.
- **REJECT** — hard contradiction such as wrong episode, Persian content, terminal delivery failure, or invalid subtitle structure.

## Core pipeline

### 1. Canonical Media Identity

Build one immutable target identity from Stremio + metadata + Companion hints:

- IMDb / TMDB IDs;
- media type;
- season / episode;
- year;
- edition;
- filename and release fingerprint;
- OpenSubtitles/video hash and video size;
- FPS, duration, source family, service, codec and audio hints when available.

Provider results never redefine the target identity.

### 2. Broad Retrieval, Zero Trust

Providers are retrieval adapters only. Provider popularity, download count and a provider's language label are not proof.

Every raw candidate is normalized into a common candidate record before ranking.

### 3. Hard Identity Gate

Immediate rejection for explicit contradictions:

- wrong IMDb/TMDB identity;
- wrong season;
- wrong episode;
- incompatible year/edition where explicit;
- conflicting exact hash.

Unknown is not treated as equivalent to verified.

### 4. Content Verification

The subtitle is fetched before it becomes eligible for strict output.

Verification includes:

- Arabic vs Persian/Farsi discrimination;
- parsing and cue validation;
- encoding normalization;
- cue count / duplicate / coverage / reading-speed checks;
- subtitle content fingerprint.

### 5. Timeline Proof

Timing confidence uses a hierarchy:

1. exact timeline / exact video-hash reference;
2. exact saved version-registry or Personal Vault mapping;
3. multiple independent subtitle sources with near-identical temporal fingerprints plus strong release evidence;
4. strong release-family + FPS match;
5. weak release-name inference.

Only levels 1–3 can normally produce certified timing.

### 6. Independent Consensus

V5 groups candidates by normalized subtitle-content and temporal fingerprints. Independent providers that converge on the same subtitle/timeline strengthen evidence; duplicate mirrors from the same upstream family do not count as independent votes.

Consensus cannot override a hard identity or language conflict.

### 7. Live Delivery Proof

A remote candidate must pass a fresh fetch/preflight before output. Wrapped upstream terminal statuses remain terminal. A stale successful check cannot certify current delivery.

### 8. Proof Certificate

Each candidate carries machine-readable evidence:

```json
{
  "decision": "certified",
  "proofFloor": 0.995,
  "confidence": {
    "identity": 0.999,
    "language": 0.999,
    "timing": 0.9999,
    "delivery": 0.9999,
    "integrity": 0.999
  }
}
```

The Stremio label should derive from this certificate, not from a legacy aggregate score.

## 99% target: what it means

V5 can target >99% precision on **returned certified subtitles** only if strict mode is allowed to return zero results when evidence is insufficient.

It is not technically honest to promise >99% availability and >99% timing correctness simultaneously when the addon has no exact hash, no exact timeline reference, and no direct access to the playback audio/video bytes.

For the highest possible timing coverage, the Companion path should eventually provide stronger local playback evidence (duration/FPS today; optional audio/timeline landmarks in a later V5 phase).

## Rollout

V5 should not replace production ranking in one step.

1. implement proof collection and certificates;
2. run V5 in shadow mode beside v4 and log disagreements;
3. build a regression corpus from real failures (The Mummy 2026, Spider-Man: Brand New Day 2026, series episode cases, dead upstream links, Persian false-Arabic cases);
4. measure false-positive rate by dimension;
5. only switch default output to V5 after the certified precision target is demonstrated;
6. retain v4 as temporary recovery fallback until V5 coverage is acceptable.
