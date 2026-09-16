import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { createSearchPlan } from '../services/searchPlanner.js';
import { searchStremioOpenSubtitles } from '../providers/stremioOpenSubtitles.js';

const config = {
  stremioOpenSubtitles: { enabled: true, baseUrl: 'https://opensubtitles-v3.strem.io' },
  providers: { maxProviderItems: 20 },
};
const video = buildVideoIdentity({
  type: 'series', id: 'tt11198330:2:2', title: 'House of the Dragon',
  filename: 'House.of.the.Dragon.S02E02.2160p.BluRay.REMUX-FraMeSToR.mkv',
  videoHash: 'cff4ef4781b1412a', videoSize: 37559489003,
});
const definition = { stremio: {
  name: 'stremio', configured: () => true,
  supports: { series: true, movie: true, hash: false, reference: true },
} };
const exact = createSearchPlan(video, definition, ['stremio'])
  .find(stage => stage.name === 'exact-metadata').variants[0];
const candidate = (id, releaseName = 'House.of.the.Dragon.S02E02.2160p.BluRay') => ({
  id, lang: 'ar', movieReleaseName: releaseName,
  url: `https://opensubtitles-v3.strem.io/subtitles/${id}.srt`,
});

test('metadata stage keeps original playback hints while clearing generic search fields', () => {
  assert.equal(exact.filename, '');
  assert.equal(exact.videoHash, null);
  assert.equal(exact.videoSize, null);
  assert.equal(exact.playbackFilename, video.filename);
  assert.equal(exact.playbackHash, video.videoHash);
  assert.equal(exact.playbackSize, video.videoSize);
});

test('Stremio requests a specific BluRay filename and video hash for the real episode', async () => {
  const calls = [];
  const result = await searchStremioOpenSubtitles({ ...exact, language: 'ar' }, {
    configImpl: config,
    fetchJsonImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.trustedOrigin, config.stremioOpenSubtitles.baseUrl);
      return { subtitles: [candidate('bluray')] };
    },
  });
  assert.equal(calls.length, 1);
  const requested = new URL(calls[0]);
  assert.match(requested.pathname, /\/subtitles\/series\/tt11198330%3A2%3A2\//i);
  const extras = requested.pathname.slice(requested.pathname.lastIndexOf('/') + 1, -5);
  const params = new URLSearchParams(extras);
  assert.equal(params.get('filename'), video.filename);
  assert.equal(params.get('videoHash'), video.videoHash);
  assert.equal(params.has('videoSize'), false);
  assert.equal(result.length, 1);
  assert.match(result[0].releaseName, /BluRay/);
  assert.equal(result[0].matchedByHash, undefined, 'request hints are not match proof');
});

test('empty targeted search falls back to the original IMDb-based route', async () => {
  const calls = [];
  const result = await searchStremioOpenSubtitles(exact, {
    configImpl: config,
    fetchJsonImpl: async url => {
      calls.push(url);
      return url.includes('/filename=') || url.includes('/videoHash=')
        ? { subtitles: [] }
        : { subtitles: [candidate('web', 'House.of.the.Dragon.S02E02.WEB-DL')] };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://opensubtitles-v3.strem.io/subtitles/series/tt11198330%3A2%3A2.json');
  assert.equal(result.length, 1);
  assert.match(result[0].releaseName, /WEB-DL/);
});

test('upstream extra-route errors fall back to the original working catalog route', async () => {
  let calls = 0;
  const result = await searchStremioOpenSubtitles(exact, {
    configImpl: config,
    fetchJsonImpl: async url => {
      calls += 1;
      if (url.includes('/filename=') || url.includes('/videoHash=')) throw new Error('extra route unavailable');
      return { subtitles: [candidate('generic')] };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
});

test('metadata search without playback hints stays on the original catalog route', async () => {
  const calls = [];
  const result = await searchStremioOpenSubtitles({ ...exact, playbackFilename: '', playbackHash: null }, {
    configImpl: config,
    fetchJsonImpl: async url => { calls.push(url); return { subtitles: [candidate('plain')] }; },
  });
  assert.deepEqual(calls, ['https://opensubtitles-v3.strem.io/subtitles/series/tt11198330%3A2%3A2.json']);
  assert.equal(result.length, 1);
});

test('broad recovery never repeats targeted requests and does not pass guessed hash as proof', async () => {
  const calls = [];
  const result = await searchStremioOpenSubtitles({ ...exact, reason: 'title-fallback' }, {
    configImpl: config,
    fetchJsonImpl: async url => { calls.push(url); return { subtitles: [candidate('broad')] }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('filename='), false);
  assert.equal(result[0].matchedByHash, undefined);
});
