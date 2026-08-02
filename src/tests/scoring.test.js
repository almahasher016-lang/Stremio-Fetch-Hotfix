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

test('rankAndFilter does not let a release-name match override a stronger personal result', () => {
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

  assert.equal(ranked[0].provider, 'vault');
  assert.ok(ranked[1].releaseMatchTier >= 5);
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

test('rankAndFilter keeps edition evidence secondary to a saved personal result', () => {
  const ranked = rankAndFilter([
    {
      provider: 'vault',
      lang: 'ara',
      releaseName: 'Movie.2026.2160p.BluRay.REMUX-GROUP',
      download: 'https://example.com/normal.srt',
    },
    {
      provider: 'yify',
      lang: 'ara',
      releaseName: 'Movie.2026.Extended.IMAX.2160p.BluRay.REMUX-GROUP',
      download: 'https://example.com/extended.srt',
    },
  ], {
    filename: 'Movie.2026.Extended.IMAX.2160p.BluRay.REMUX-GROUP.mkv',
  }, {
    outputArabicOnly: true,
    minRankScore: -1000,
  });

  assert.equal(ranked[0].provider, 'vault');
  assert.ok(ranked[1].releaseMatch.matched.includes('edition'));
  assert.ok(ranked[1].releaseMatchTier >= 5);
  assert.equal(ranked[0].releaseMatchTier, 1);
});

test('rankAndFilter consumes Companion FPS, HDR, and audio hints without a release filename', () => {
  const ranked = rankAndFilter([
    {
      provider: 'subdl',
      lang: 'ara',
      releaseName: 'Movie.2160p.WEB-DL.HEVC.HDR10.DDP.5.1.23.976fps-GROUP',
      download: 'https://example.com/match.srt',
    },
    {
      provider: 'opensubtitles',
      lang: 'ara',
      releaseName: 'Movie.2160p.WEB-DL.HEVC.SDR.AAC.2.0.25fps-GROUP',
      download: 'https://example.com/mismatch.srt',
    },
  ], {
    query: 'Movie',
    extra: {
      resolution: '2160p',
      source: 'WEB-DL',
      videoCodec: 'HEVC',
      hdr: 'HDR10',
      audioCodec: 'EAC3',
      audioChannels: '5.1',
      fps: 23.976,
    },
  }, {
    outputArabicOnly: true,
    minRankScore: -1000,
  });

  assert.equal(ranked[0].provider, 'subdl');
  assert.ok(ranked[0].releaseMatch.matched.includes('fps'));
  assert.ok(ranked[0].releaseMatch.matched.includes('hdr'));
  assert.ok(ranked[0].releaseMatch.matched.includes('audioChannels'));
});


test('rankAndFilter keeps an exact video hash first even when its release label differs', () => {
  const ranked = rankAndFilter([
    { provider: 'yify', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', movieHash: 'abc123', download: 'https://example.com/hash.srt' },
    { provider: 'opensubtitles', lang: 'ara', releaseName: 'Movie.2160p.BluRay-OTHER', trusted: true, qualityScore: 100, download: 'https://example.com/name.srt' },
  ], { filename: 'Movie.2160p.BluRay-OTHER.mkv', videoHash: 'abc123' }, { outputArabicOnly: true, minRankScore: -1000 });
  assert.equal(ranked[0].movieHash, 'abc123');
  assert.ok(ranked[0].scoreReasons.some(reason => reason.reason === 'exact-video-hash-match'));
});

test('rankAndFilter surfaces plausible alternatives before repeated release families', () => {
  const ranked = rankAndFilter([
    { provider: 'opensubtitles', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/a.srt' },
    { provider: 'subdl', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/b.srt' },
    { provider: 'subsource', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/c.srt' },
    { provider: 'yify', lang: 'ara', releaseName: 'Movie.1080p.BluRay-OTHER', trusted: true, qualityScore: 80, download: 'https://example.com/d.srt' },
  ], { filename: 'Movie.1080p.WEB-DL-GROUP.mkv' }, { outputArabicOnly: true, minRankScore: -1000, maxReturnedPerRelease: 1 });
  assert.equal(ranked[0].provider, 'opensubtitles');
  assert.equal(ranked[1].parsedRelease.source, 'bluray');
});
