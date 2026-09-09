import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateV5Candidates } from '../v5/shadowResolver.js';
import { buildTitleIdentityEvidence } from '../v5/candidateEvidence.js';

const NOW = 1_800_000_000_000;

function quality() {
  return {
    valid: true,
    score: 100,
    reasons: [],
    cueCount: 950,
    coverageRatio: 0.99,
    arabicRatio: 1,
    detectedLanguage: 'arabic',
    arabicWordHits: 600,
    persianWordHits: 0,
    persianDistinctiveRatio: 0,
  };
}

function candidate(releaseName, overrides = {}) {
  return {
    provider: 'subdl',
    id: `subdl-${releaseName}`,
    lang: 'ara',
    searchReason: 'exact-metadata',
    releaseName,
    releaseMatch: { matched: ['year'], missing: [], mismatched: [] },
    quality: quality(),
    accuracyPreflight: {
      state: 'valid',
      source: 'live-preflight',
      checkedAt: NOW - 1_000,
      quality: quality(),
    },
    ...overrides,
  };
}

const spiderManSearch = {
  type: 'movie',
  id: 'tt22084616',
  imdbId: 'tt22084616',
  title: 'Spider Man Brand New Day',
  query: 'Spider Man Brand New Day',
  filename: 'Spider.Man.Brand.New.Day.2026.4k.Th Rong.mkv',
  year: 2026,
};

test('V5.1.2 does not treat exact-metadata provenance as movie identity when the work title is different', () => {
  const wrong = candidate('Supergirl.2026.720p.WEBRip.x264.AAC.YTS.GG');
  const [entry] = evaluateV5Candidates([wrong], spiderManSearch, { now: NOW });

  assert.equal(entry.evidence.identity.catalogIdMatch, false);
  assert.equal(entry.evidence.identity.titleMatch, false);
  assert.equal(entry.evidence.identity.catalogSearchAnchored, false);
  assert.equal(entry.proof.confidence.identity, 0.55);
  assert.equal(entry.proof.decision, 'withhold');
});

test('V5.1.2 preserves exact-metadata fallback when the provider row strongly matches the requested work title', () => {
  const correct = candidate('Spider.Man.Brand.New.Day.2026.1080p.WEB-DL.x264-GROUP');
  const [entry] = evaluateV5Candidates([correct], spiderManSearch, { now: NOW });

  assert.equal(entry.evidence.identity.titleMatch, true);
  assert.equal(entry.evidence.identity.catalogSearchAnchored, true);
  assert.equal(entry.proof.confidence.identity, 0.997);
  assert.equal(entry.proof.decision, 'recovery');
});

test('V5.1.2 title identity accepts a shorter canonical title inside a creator-prefixed filename', () => {
  const evidence = buildTitleIdentityEvidence(
    { releaseName: 'The.Mummy.2026.1080p.WEBRip.x264' },
    { title: "Lee Cronin's The Mummy", filename: "Lee.Cronin's.The.Mummy.2026.2160p.UHD.BluRay.mkv" },
  );
  assert.equal(evidence.match, true);
  assert.ok(evidence.overlap >= 0.8);
});

test('explicit wrong catalog id remains a hard identity rejection regardless of title similarity', () => {
  const wrongId = candidate('Spider.Man.Brand.New.Day.2026.1080p.WEB-DL.x264-GROUP', {
    imdbId: 'tt99999999',
  });
  const [entry] = evaluateV5Candidates([wrongId], spiderManSearch, { now: NOW });

  assert.ok(entry.evidence.identity.conflicts.includes('imdb'));
  assert.equal(entry.proof.decision, 'reject');
});
