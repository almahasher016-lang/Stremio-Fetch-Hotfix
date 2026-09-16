import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteTimelineBoundsCompatible, buildTimelineConsensus, temporalFingerprintSimilarity } from '../v5/consensusEngine.js';
import { evaluateV5Candidates } from '../v5/shadowResolver.js';

const NOW = 1_800_000_000_000;

function strongQuality(overrides = {}) {
  return {
    valid: true, score: 96, reasons: [], cueCount: 950, coverageRatio: 0.99,
    arabicRatio: 0.96, detectedLanguage: 'arabic', arabicWordHits: 600,
    persianWordHits: 0, persianDistinctiveRatio: 0,
    startMs: 42_000, endMs: 7_042_000, durationMs: 7_000_000,
    fingerprint: { hash: 'timeline-aaa', points: [], durationMs: 7_000_000 },
    ...overrides,
  };
}

function freshPreflight(overrides = {}) {
  return { state: 'valid', checkedAt: NOW - 1_000, source: 'live-preflight', ...overrides };
}

function measuredStrict(overrides = {}) {
  return {
    measured: true, exactVideoHash: true, verdict: 'aligned',
    offsetMs: 100, residualMedianMs: 100, residualP90Ms: 180,
    anchorCoverage: 0.9, ...overrides,
  };
}

function temporalPoints(delta = 0) {
  return Array.from({ length: 20 }, (_, index) => `${index * 50 + delta}:${20 + (index % 3)}:${5 + (index % 4)}`);
}

test('V5 certifies exact-hash Arabic subtitle only with measured aligned numeric residuals', () => {
  const search = { type: 'movie', imdbId: 'tt123', videoHash: 'abc123' };
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt123', movieHash: 'abc123', lang: 'ara',
    quality: strongQuality(), accuracyPreflight: freshPreflight(),
    actualTimingEvidence: measuredStrict(), releaseMatchTier: 5,
  }], search, { now: NOW });
  assert.equal(entry.proof.decision, 'certified');
  assert.equal(entry.proof.certified, true);
  assert.ok(entry.proof.proofFloor >= 0.995);
});

test('V5 hard-rejects Persian content even when provider labels it Arabic', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt123', movieHash: 'abc123', lang: 'ara',
    quality: strongQuality({ valid: false, detectedLanguage: 'persian',
      reasons: ['wrong-language-persian'], arabicWordHits: 0, persianWordHits: 900 }),
    accuracyPreflight: freshPreflight(),
  }], { type: 'movie', imdbId: 'tt123', videoHash: 'abc123' }, { now: NOW });
  assert.equal(entry.proof.decision, 'reject');
  assert.ok(entry.proof.hardFailures.some(failure => failure.dimension === 'language'));
});

test('V5 hard-rejects the wrong episode regardless of score or quality', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'subdl', imdbId: 'ttshow', season: 1, episode: 3,
    score: 99999, lang: 'ara', quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'series', imdbId: 'ttshow', season: 1, episode: 2 }, { now: NOW });
  assert.equal(entry.proof.decision, 'reject');
  assert.ok(entry.proof.hardFailures.some(failure => failure.reason === 'identity-conflict:episode'));
});

test('V5 recognizes independent providers with same temporal fingerprint as consensus, not sync', () => {
  const fingerprint = { hash: 'same', points: [], durationMs: 7_000_000 };
  const a = { provider: 'opensubtitles', quality: strongQuality({ fingerprint }) };
  const b = { provider: 'subdl', quality: strongQuality({ fingerprint }) };
  const c = { provider: 'opensubtitles', quality: strongQuality({ fingerprint }) };
  const consensus = buildTimelineConsensus([a, b, c]);
  assert.equal(consensus.get(a).independentConsensusCount, 2);
  assert.equal(consensus.get(b).timelineSimilarity, 1);
  assert.equal(consensus.get(c).independentConsensusCount, 2);
  assert.equal(consensus.get(a).absoluteBoundsMatched, true);
});

test('V5 does not count mirrored upstream families as independent consensus', () => {
  const fingerprint = { hash: 'mirror-timeline', points: [], durationMs: 7_000_000 };
  const a = { provider: 'opensubtitles', upstreamFamily: 'shared-origin', quality: strongQuality({ fingerprint }) };
  const b = { provider: 'subdl', upstreamFamily: 'shared-origin', quality: strongQuality({ fingerprint }) };
  const c = { provider: 'subsource', upstreamFamily: 'independent-origin', quality: strongQuality({ fingerprint }) };
  const consensus = buildTimelineConsensus([a, b, c]);
  assert.equal(consensus.get(a).independentConsensusCount, 2);
  assert.equal(consensus.get(b).independentConsensusCount, 2);
  assert.equal(consensus.get(c).independentConsensusCount, 2);
});

test('V5 detects near-identical temporal fingerprints without requiring identical hashes', () => {
  const left = { hash: 'a', points: temporalPoints(0), durationMs: 7_000_000 };
  const right = { hash: 'b', points: temporalPoints(0.2), durationMs: 7_002_000 };
  const similarity = temporalFingerprintSimilarity(left, right);
  assert.ok(similarity >= 0.985);
});

test('V5 refuses consensus when relative fingerprints match but subtitles are globally offset', () => {
  const fingerprint = { hash: 'same-relative-timeline', points: temporalPoints(0), durationMs: 7_000_000 };
  const left = { provider: 'opensubtitles', quality: strongQuality({ fingerprint, startMs: 40_000, endMs: 7_040_000 }) };
  const right = { provider: 'subdl', quality: strongQuality({ fingerprint, startMs: 75_000, endMs: 7_075_000 }) };
  assert.equal(absoluteTimelineBoundsCompatible(left, right), false);
  const consensus = buildTimelineConsensus([left, right]);
  assert.equal(consensus.get(left).independentConsensusCount, 1);
  assert.equal(consensus.get(left).absoluteBoundsMatched, false);
});

test('V5 cannot certify three-source consensus without a synchronized video reference', () => {
  const fingerprint = { hash: 'episode-timeline', points: temporalPoints(0), durationMs: 3_500_000 };
  const base = {
    imdbId: 'ttshow', season: 1, episode: 2, lang: 'ara', releaseMatchTier: 5,
    releaseMatch: { tier: 5, matched: ['fps'], mismatched: [], missing: [] },
    quality: strongQuality({ fingerprint, startMs: 35_000, endMs: 3_535_000, durationMs: 3_500_000 }),
    accuracyPreflight: freshPreflight(),
  };
  const evaluated = evaluateV5Candidates([
    { ...base, provider: 'opensubtitles', providerId: 'a' },
    { ...base, provider: 'subdl', providerId: 'b' },
    { ...base, provider: 'subsource', providerId: 'c' },
  ], { type: 'series', imdbId: 'ttshow', season: 1, episode: 2 }, { now: NOW });
  assert.ok(evaluated.every(entry => entry.proof.decision === 'recovery'));
  assert.ok(evaluated[0].evidence.timing.independentConsensusCount >= 3);
  assert.equal(evaluated[0].evidence.timing.absoluteBoundsMatched, true);
});

test('V5 does not certify Arabic text when timing remains unverified', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt123', lang: 'ara', releaseMatchTier: 1,
    quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'movie', imdbId: 'tt123' }, { now: NOW });
  assert.notEqual(entry.proof.decision, 'certified');
  assert.ok(entry.proof.confidence.timing < 0.94);
});

test('V5 hard-rejects terminal delivery failure despite measured timing', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt123', movieHash: 'abc123', lang: 'ara',
    quality: strongQuality(),
    accuracyPreflight: freshPreflight({ state: 'rejected', deliveryFailure: true, upstreamStatus: 404 }),
    actualTimingEvidence: measuredStrict(),
  }], { type: 'movie', imdbId: 'tt123', videoHash: 'abc123' }, { now: NOW });
  assert.equal(entry.proof.decision, 'reject');
  assert.ok(entry.proof.hardFailures.some(failure => failure.dimension === 'delivery'));
});

test('V5 retains catalog-search movie identity but marks BluRay name-only timing as RECOVERY', () => {
  const search = { type: 'movie', imdbId: 'tt33612209',
    filename: 'The.Devil.Wears.Prada.2.2026.UHD.BluRay.2160p.REMUX-FraMeSToR.mkv' };
  const [entry] = evaluateV5Candidates([{
    provider: 'yify', searchReason: 'exact-metadata',
    fileName: 'The.Devil.Wears.Prada.2.2026.1080p.BluRay.x264-FraMeSToR.srt',
    lang: 'ara', quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], search, { now: NOW });
  assert.equal(entry.evidence.identity.catalogSearchAnchored, true);
  assert.equal(entry.evidence.timing.stableReleaseFamily, true);
  assert.equal(entry.proof.decision, 'recovery');
  assert.ok(entry.proof.reasons.includes('identity:catalog-search-anchored'));
  assert.ok(entry.proof.reasons.includes('timing:unverified'));
});

test('V5 does not promote title fallback to catalog-anchored identity', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'yify', searchReason: 'title-fallback',
    fileName: 'The.Devil.Wears.Prada.2.2026.1080p.BluRay.x264-FraMeSToR.srt',
    lang: 'ara', quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'movie', imdbId: 'tt33612209',
    filename: 'The.Devil.Wears.Prada.2.2026.UHD.BluRay.2160p.REMUX-FraMeSToR.mkv',
  }, { now: NOW });
  assert.equal(entry.evidence.identity.catalogSearchAnchored, false);
  assert.notEqual(entry.proof.decision, 'safe');
  assert.notEqual(entry.proof.decision, 'certified');
});

test('V5 accepts resolution and codec differences as discovery hints, not timing proof', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt8772296', season: 1, episode: 2,
    fileName: 'Euphoria.S01E02.2160p.WEB-DL.DDP5.1.H.265.mkv', lang: 'ara',
    quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'series', imdbId: 'tt8772296', season: 1, episode: 2,
    filename: 'Euphoria.S01E02.1080p.WEB-DL.DDP5.1.H.264.mkv',
  }, { now: NOW });
  assert.equal(entry.evidence.timing.sourceMatch, true);
  assert.equal(entry.evidence.timing.stableReleaseFamily, true);
  assert.equal(entry.proof.decision, 'recovery');
  assert.ok(entry.proof.reasons.includes('timing:unverified'));
});

test('V5 keeps edition conflicts as hard rejects despite exact-metadata search', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', searchReason: 'exact-metadata',
    fileName: 'Movie.2026.1080p.BluRay.Directors.Cut-GROUP.srt', lang: 'ara',
    releaseMatch: { tier: 1, matched: ['source'], mismatched: ['edition'], missing: [] },
    quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'movie', imdbId: 'tt12345', filename: 'Movie.2026.2160p.BluRay.Theatrical-GROUP.mkv' }, { now: NOW });
  assert.equal(entry.proof.decision, 'reject');
  assert.ok(entry.proof.hardFailures.some(failure => failure.reason === 'identity-conflict:edition'));
});

test('V5 keeps FPS mismatches as hard timing rejects for the same episode', () => {
  const [entry] = evaluateV5Candidates([{
    provider: 'opensubtitles', imdbId: 'tt8772296', season: 1, episode: 2,
    fileName: 'Euphoria.S01E02.2160p.WEB-DL.mkv', fps: 25, lang: 'ara',
    quality: strongQuality(), accuracyPreflight: freshPreflight(),
  }], { type: 'series', imdbId: 'tt8772296', season: 1, episode: 2,
    filename: 'Euphoria.S01E02.1080p.WEB-DL.mkv', fps: 23.976,
  }, { now: NOW });
  assert.equal(entry.proof.decision, 'reject');
  assert.ok(entry.proof.hardFailures.some(failure => failure.reason === 'timing:hard-conflict'));
});
