import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseMatch, rankAndFilter, scoreSubtitle } from '../utils/scoring.js';

test('scoreSubtitle rewards matching Arabic release', () => {
  const scored = scoreSubtitle({ lang: 'ara', releaseName: 'Movie.Name.2024.1080p.WEB-DL-GRP', downloads: 100, download: 'https://example.com/a.srt' }, { query: 'Movie Name', filename: 'Movie.Name.2024.1080p.WEB-DL-GRP.mkv' });
  assert.ok(scored.score > 500);
});

test('rankAndFilter removes machine translated results when requested', () => {
  const ranked = rankAndFilter([
    { lang: 'ara', releaseName: 'A.1080p.WEB-DL', download: 'https://example.com/a.srt' },
    { lang: 'ara', releaseName: 'B.1080p.WEB-DL', machineTranslated: true, download: 'https://example.com/b.srt' },
  ], { query: 'A', filename: 'A.1080p.WEB-DL.mkv' }, { excludeMachineTranslated: true, outputArabicOnly: true });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].releaseName, 'A.1080p.WEB-DL');
});

test('buildReleaseMatch assigns a higher tier to the exact streaming release', () => {
  const target = scoreSubtitle(
    { lang: 'ara', releaseName: 'Show.S01E02.2160p.AMZN.WEB-DL.HEVC.DDP.5.1.23.976fps-FLUX', download: 'https://example.com/a.srt' },
    { filename: 'Show.S01E02.2160p.AMZN.WEB-DL.HEVC.DDP.5.1.23.976fps-FLUX.mkv' },
  );
  const mismatch = scoreSubtitle(
    { lang: 'ara', releaseName: 'Show.S01E02.1080p.NF.WEBRip.x264.AAC.25fps-OTHER', download: 'https://example.com/b.srt' },
    { filename: 'Show.S01E02.2160p.AMZN.WEB-DL.HEVC.DDP.5.1.23.976fps-FLUX.mkv' },
  );
  assert.ok(target.releaseMatch.tier >= 5);
  assert.equal(mismatch.releaseMatch.tier, 1);
  assert.ok(target.releaseMatch.priority > mismatch.releaseMatch.priority);
});

test('rankAndFilter puts the matching video release first even when another provider has higher priority', () => {
  const ranked = rankAndFilter([
    {
      provider: 'vault',
      lang: 'ara',
      releaseName: 'Show.S01E02.1080p.NF.WEBRip.x264-AAC-OTHER',
      download: 'https://example.com/vault.srt',
    },
    {
      provider: 'yify',
      lang: 'ara',
      releaseName: 'Show.S01E02.2160p.AMZN.WEB-DL.HEVC.DDP.5.1.23.976fps-FLUX',
      download: 'https://example.com/exact.srt',
    },
  ], {
    type: 'series',
    season: 1,
    episode: 2,
    filename: 'Show.S01E02.2160p.AMZN.WEB-DL.HEVC.DDP.5.1.23.976fps-FLUX.mkv',
  }, {
    outputArabicOnly: true,
    maxReturnedPerRelease: 1,
    minRankScore: -1000,
  });

  assert.equal(ranked[0].provider, 'yify');
  assert.ok(ranked[0].releaseMatchTier >= 5);
});

test('buildReleaseMatch treats equivalent codec aliases as the same codec family', () => {
  const left = scoreSubtitle(
    { lang: 'ara', releaseName: 'Movie.1080p.WEB-DL.HEVC-GRP', download: 'https://example.com/a.srt' },
    { filename: 'Movie.1080p.WEB-DL.x265-GRP.mkv' },
  );
  assert.ok(left.releaseMatch.matched.includes('codecFamily'));
  assert.equal(buildReleaseMatch(left.target, left.release).criticalMismatches, 0);
});

test('rankAndFilter uses explicit Stremio quality hints when a filename is unavailable', () => {
  const ranked = rankAndFilter([
    { provider: 'subdl', lang: 'ara', releaseName: 'Movie.1080p.BluRay.x264-GRP', download: 'https://example.com/a.srt' },
    { provider: 'yify', lang: 'ara', releaseName: 'Movie.2160p.AMZN.WEB-DL.HEVC-GRP', download: 'https://example.com/b.srt' },
  ], {
    query: 'Movie',
    extra: { resolution: '2160p', source: 'WEB-DL', service: 'AMZN', codec: 'x265' },
  }, {
    outputArabicOnly: true,
    minRankScore: -1000,
  });
  assert.equal(ranked[0].provider, 'yify');
  assert.ok(ranked[0].releaseMatchTier >= 4);
});
