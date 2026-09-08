import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUniversalVideoProfile,
  compareUniversalVideoProfiles,
  detectVideoContainer,
} from '../utils/universalVideoIdentity.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';

test('universal profile understands UHD BluRay REMUX scene names', () => {
  const profile = buildUniversalVideoProfile({
    filename: 'The.Devil.Wears.Prada.2.2026.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HDR10P.HEVC.HYBRID.REMUX-FraMeSToR.mkv',
    fps: 23.976,
    durationMs: 7_012_345,
    videoHash: '8b9821a5bf6dd20a',
  });
  assert.equal(profile.container, 'matroska');
  assert.equal(profile.sourceFamily, 'bluray');
  assert.equal(profile.sourceDetail, 'uhd-bluray-remux');
  assert.equal(profile.resolution, '2160p');
  assert.equal(profile.codec, 'hevc');
  assert.equal(profile.releaseGroup, 'FRAMESTOR');
  assert.equal(profile.fps, 23.976);
  assert.equal(profile.durationMs, 7_012_345);
  assert.equal(profile.videoHash, '8b9821a5bf6dd20a');
});

test('container, resolution, codec and HDR differences never create timing conflicts', () => {
  const target = buildUniversalVideoProfile({
    filename: 'Movie.2026.2160p.UHD.BluRay.REMUX.DV.HEVC-FraMeSToR.mkv',
    fps: 23.976,
    durationMs: 7_200_000,
  });
  const candidate = buildUniversalVideoProfile({
    releaseName: 'Movie.2026.1080p.BluRay.AVC-FraMeSToR.srt',
    fps: 23.976,
    durationMs: 7_200_900,
  });
  const compared = compareUniversalVideoProfiles(target, candidate);
  assert.equal(compared.hardConflict, false);
  assert.equal(compared.sourceMatch, true);
  assert.equal(compared.releaseGroupMatch, true);
  assert.equal(compared.fpsMatch, true);
  assert.equal(compared.durationMatch, true);
  assert.ok(compared.tier >= 7);
  assert.equal(compared.formatDifferences.container, null);
  assert.equal(compared.formatDifferences.resolution, true);
  assert.equal(compared.formatDifferences.codec, true);
});

test('WEB-DL timing family survives 1080p/2160p and x264/x265 changes', () => {
  const compared = compareUniversalVideoProfiles(
    { filename: 'Euphoria.S01E02.2160p.AMZN.WEB-DL.HEVC-FLUX.mkv', fps: 23.976 },
    { releaseName: 'Euphoria.S01E02.1080p.AMZN.WEB-DL.x264-FLUX.srt', fps: 23.976 },
    { mediaType: 'series' },
  );
  assert.equal(compared.sourceMatch, true);
  assert.equal(compared.serviceMatch, true);
  assert.equal(compared.releaseGroupMatch, true);
  assert.equal(compared.hardConflict, false);
  assert.equal(compared.compatibility, 'high');
  assert.ok(compared.tier >= 7);
});

test('explicit edition mismatch is a hard timing conflict', () => {
  const compared = compareUniversalVideoProfiles(
    { filename: 'Movie.2026.Extended.2160p.BluRay.REMUX-GROUP.mkv' },
    { releaseName: 'Movie.2026.Theatrical.1080p.BluRay-GROUP.srt' },
  );
  assert.equal(compared.hardConflict, true);
  assert.ok(compared.conflicts.includes('edition'));
  assert.equal(compared.compatibility, 'incompatible');
});

test('explicit FPS mismatch is a hard timing conflict', () => {
  const compared = compareUniversalVideoProfiles(
    { filename: 'Movie.2026.1080p.BluRay-GROUP.mkv', fps: 23.976 },
    { releaseName: 'Movie.2026.1080p.BluRay-GROUP.srt', fps: 25 },
  );
  assert.equal(compared.hardConflict, true);
  assert.ok(compared.conflicts.includes('fps'));
});

test('large measured duration mismatch is a hard timing conflict', () => {
  const compared = compareUniversalVideoProfiles(
    { filename: 'Movie.2026.1080p.WEB-DL-GROUP.mkv', durationMs: 7_200_000 },
    { releaseName: 'Movie.2026.1080p.WEB-DL-GROUP.srt', durationMs: 7_260_000 },
  );
  assert.equal(compared.hardConflict, true);
  assert.ok(compared.conflicts.includes('duration'));
});

test('unknown format stays neutral instead of becoming wrong', () => {
  const target = buildUniversalVideoProfile({ filename: 'Movie.2026.1080p.WEB-DL-GROUP.xyzvideo' });
  const candidate = buildUniversalVideoProfile({ releaseName: 'Movie.2026.1080p.WEB-DL-GROUP.srt' });
  const compared = compareUniversalVideoProfiles(target, candidate);
  assert.equal(target.container, 'xyzvideo');
  assert.equal(candidate.container, null);
  assert.equal(compared.hardConflict, false);
  assert.equal(compared.sourceMatch, true);
});

test('container detector is format-agnostic across common and legacy containers', () => {
  const fixtures = new Map([
    ['a.mkv', 'matroska'], ['a.mk3d', 'matroska'], ['a.mp4', 'mp4'], ['a.m4v', 'mp4'],
    ['a.avi', 'avi'], ['a.mov', 'quicktime'], ['a.webm', 'webm'], ['a.ts', 'mpeg-ts'],
    ['a.m2ts', 'mpeg-ts'], ['a.mts', 'mpeg-ts'], ['a.mpg', 'mpeg-ps'], ['a.vob', 'mpeg-ps'],
    ['a.wmv', 'asf'], ['a.flv', 'flash-video'], ['a.3gp', '3gpp'], ['a.mxf', 'mxf'],
    ['a.rmvb', 'realmedia'], ['a.ogv', 'ogg-video'], ['a.iso', 'disc-image'],
  ]);
  for (const [name, expected] of fixtures) assert.equal(detectVideoContainer(name), expected, name);
});

test('subtitle/archive extensions are never mistaken for video containers', () => {
  for (const name of ['a.srt', 'a.ass', 'a.ssa', 'a.vtt', 'a.zip', 'a.rar', 'a.7z']) {
    assert.equal(detectVideoContainer(name), null, name);
  }
});

test('buildVideoIdentity attaches one normalized timeline profile independent of file format', () => {
  const identity = buildVideoIdentity({
    type: 'movie',
    id: 'tt33612209',
    filename: 'The.Devil.Wears.Prada.2.2026.UHD.BluRay.2160p.REMUX-FraMeSToR.m2ts',
    videoHash: '8b9821a5bf6dd20a',
    videoSize: 55_444_604_787,
    fps: 23.976,
    durationMs: 7_012_345,
  });
  assert.equal(identity.imdbId, 'tt33612209');
  assert.equal(identity.videoProfile.container, 'mpeg-ts');
  assert.equal(identity.videoProfile.sourceFamily, 'bluray');
  assert.equal(identity.videoProfile.releaseGroup, 'FRAMESTOR');
  assert.equal(identity.videoProfile.fps, 23.976);
  assert.ok(identity.timingFingerprint);
});

test('exact video hash is the highest universal timeline evidence', () => {
  const compared = compareUniversalVideoProfiles(
    { filename: 'Movie.2026.2160p.WEB-DL.mkv', videoHash: '0123456789abcdef' },
    { releaseName: 'Movie.2026.1080p.BluRay.srt', movieHash: '0123456789abcdef' },
  );
  assert.equal(compared.exactHash, true);
  assert.equal(compared.compatibility, 'exact');
  assert.equal(compared.tier, 10);
});
