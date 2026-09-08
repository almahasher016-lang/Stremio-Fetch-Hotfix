import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identityAuthorityRank,
  preferIdentityAuthority,
  prioritizeAccurateSubtitles,
} from '../utils/accuracyFirst.js';

function match({ tier = 0, priority = 0, matched = [], targetFields = 4 } = {}) {
  return {
    tier,
    priority,
    matched,
    mismatched: [],
    criticalMismatches: 0,
    targetFields,
  };
}

test('explicit requested episode removes a higher-scoring identity-unknown series candidate', () => {
  const search = {
    type: 'series',
    imdbId: 'tt8772296',
    season: 1,
    episode: 2,
    filename: 'Euphoria.S01E02.1080p.WEB-DL-GROUP.mkv',
  };
  const unknown = {
    id: 'unknown',
    provider: 'subdl',
    releaseName: 'Arabic subtitle',
    fileName: 'Arabic.srt',
    searchReason: 'title-fallback',
    score: 5000,
    downloads: 100000,
    releaseMatch: match(),
    scoreReasons: [],
  };
  const exactEpisode = {
    id: 'exact-episode',
    provider: 'opensubtitles',
    releaseName: 'Euphoria.S01E02.1080p.WEB-DL-GROUP',
    season: 1,
    episode: 2,
    searchReason: 'release-fallback',
    score: 250,
    releaseMatch: match({ tier: 3, priority: 32000, matched: ['season', 'episode', 'source', 'quality'] }),
    scoreReasons: [],
  };

  assert.equal(identityAuthorityRank(exactEpisode, search), 4);
  assert.equal(identityAuthorityRank(unknown, search), 0);
  const filtered = preferIdentityAuthority(
    prioritizeAccurateSubtitles([unknown, exactEpisode], search),
    search,
  );
  assert.deepEqual(filtered.map(item => item.id), ['exact-episode']);
});

test('catalog-anchored movie metadata result removes generic title fallback', () => {
  const search = {
    type: 'movie',
    imdbId: 'tt32612507',
    year: 2026,
    filename: 'The.Mummy.2026.2160p.UHD.BluRay.REMUX-CiNEPHiLES.mkv',
  };
  const generic = {
    id: 'generic-title',
    provider: 'subdl',
    releaseName: 'The Mummy Arabic',
    searchReason: 'title-fallback',
    score: 3000,
    releaseMatch: match(),
    scoreReasons: [],
  };
  const metadataAnchored = {
    id: 'metadata-anchored',
    provider: 'opensubtitles',
    releaseName: 'The.Mummy.2026.1080p.BluRay',
    searchReason: 'exact-metadata',
    score: 200,
    releaseMatch: match({ tier: 2, priority: 22000, matched: ['year', 'source'] }),
    scoreReasons: [],
  };

  assert.equal(identityAuthorityRank(metadataAnchored, search), 4);
  assert.equal(identityAuthorityRank(generic, search), 0);
  const filtered = preferIdentityAuthority(
    prioritizeAccurateSubtitles([generic, metadataAnchored], search),
    search,
  );
  assert.deepEqual(filtered.map(item => item.id), ['metadata-anchored']);
});

test('unknown-only pool remains available when no stronger identity evidence exists', () => {
  const search = { type: 'series', imdbId: 'tt1234567', season: 1, episode: 2 };
  const items = [
    { id: 'a', provider: 'subdl', releaseName: 'Arabic A', score: 500, releaseMatch: match(), scoreReasons: [] },
    { id: 'b', provider: 'subsource', releaseName: 'Arabic B', score: 400, releaseMatch: match(), scoreReasons: [] },
  ];
  const filtered = preferIdentityAuthority(prioritizeAccurateSubtitles(items, search), search);
  assert.deepEqual(filtered.map(item => item.id), ['a', 'b']);
});
