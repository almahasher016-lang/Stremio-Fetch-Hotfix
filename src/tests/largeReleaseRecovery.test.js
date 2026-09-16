import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSubdl } from '../providers/subdl.js';
import { searchOpenSubtitles, normalizeOpenSubtitlesItem } from '../providers/openSubtitles.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';
import { needsTimingDiscovery } from '../services/timingDiscovery.js';
import { searchCore } from '../services/subtitleService.js';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';
import { createExhaustiveCoveragePlan } from '../services/coverageEngine.js';

const search = buildVideoIdentity({
  type: 'series', id: 'tt11198330:2:2', title: 'House of the Dragon',
  filename: 'House of the Dragon (2022) S02E02 (2160p UHD BluRay x265 DV HDR DDP 7.1 English - DarQ HONE).mkv',
  videoSize: 71643817396, videoHash: 'ca18664798074933',
});
const quality = { valid: true, score: 100, reasons: [], detectedLanguage: 'arabic', arabicRatio: 1, arabicWordHits: 500, cueCount: 600 };
const candidate = (source, id = source) => ({
  id, providerId: id, provider: 'subdl', lang: 'ara', imdbId: search.imdbId, season: 2, episode: 2,
  releaseName: `House.of.the.Dragon.S02E02.${source}`, download: `https://example.test/${id}.srt`,
  quality, accuracyPreflight: { state: 'valid', quality, checkedAt: Date.now() },
});
const alignedTiming = {
  measured: true, exactVideoHash: true, verdict: 'aligned',
  offsetMs: 100, residualMedianMs: 100, residualP90Ms: 200, anchorCoverage: 0.9,
};
const subdlConfig = {
  subdl: { apiKey: 'test', baseUrl: 'https://api.subdl.test/subtitles', downloadBaseUrl: 'https://dl.subdl.test' },
  providers: { maxProviderItems: 60, searchFullSeason: true },
};

test('SubDL retains a BluRay result if a later search shape fails', async () => {
  const calls = [];
  const result = await searchSubdl(search, { configImpl: subdlConfig, fetchJsonImpl: async url => {
    const params = new URL(url).searchParams;
    calls.push(params);
    if (!params.has('imdb_id')) throw Object.assign(new Error('upstream unavailable'), { statusCode: 503 });
    return { status: true, results: [{ imdb_id: search.imdbId, type: 'tv' }], subtitles: [
      { id: 1, language: 'ar', release_name: 'House.of.the.Dragon.S02E02.BluRay', url: '/one.srt' },
    ] };
  } });
  assert.equal(result.length, 1);
  assert.equal(result[0].imdbId, search.imdbId);
  assert.equal(calls.at(-1).get('film_name'), 'House of the Dragon');
});

test('SubDL missing title is empty, but total authentication failure still surfaces', async () => {
  assert.deepEqual(await searchSubdl(search, { configImpl: subdlConfig, fetchJsonImpl: async () => ({ status: false, error: "can't find movie or tv" }) }), []);
  await assert.rejects(searchSubdl(search, { configImpl: subdlConfig, fetchJsonImpl: async () => ({ status: false, error: 'invalid api key' }) }), /invalid api key/);
});

test('SubDL catalog results cannot become subtitle downloads', async () => {
  assert.deepEqual(await searchSubdl(search, { configImpl: subdlConfig, fetchJsonImpl: async () => ({ results: [{ id: 1, url: '/catalog', language: 'ar' }] }) }), []);
});

test('SubDL season pack inherits returned catalog identity and selects only requested episode', async () => {
  const result = await searchSubdl(search, { configImpl: subdlConfig, fetchJsonImpl: async () => ({
    results: [{ imdb_id: search.imdbId, type: 'tv' }], subtitles: [{ language: 'ar', unpack_files: [
      { file_n_id: 'one', name: 'House.of.the.Dragon.S02E01.BluRay.srt', season: 2, episode: 1, url: '/one.srt' },
      { file_n_id: 'two', name: 'House.of.the.Dragon.S02E02.BluRay.srt', season: 2, episode: 2, url: '/two.srt' },
    ] }],
  }) });
  assert.equal(result.length, 1);
  assert.equal(result[0].providerId, 'two');
  assert.equal(result[0].imdbId, search.imdbId);
});

test('wrong 71GB stream size falls back to hash alone without truncating the number', async () => {
  const calls = [];
  const result = await searchOpenSubtitles(search, { fetchJsonImpl: async url => {
    const params = new URL(url).searchParams;
    calls.push(params);
    return { data: params.has('moviebytesize') ? [] : [{ id: 1, attributes: {
      language: 'ar', moviehash_match: true, moviehash: search.videoHash, files: [{ file_id: 5 }],
    } }] };
  } });
  assert.equal(calls[0].get('moviebytesize'), '71643817396');
  assert.equal(calls[1].has('moviebytesize'), false);
  assert.equal(calls[1].get('moviehash'), search.videoHash);
  assert.equal(result[0].matchedByHash, true);
});

test('a false string from a provider is never exact-hash proof', () => {
  assert.equal(normalizeOpenSubtitlesItem({ attributes: { language: 'ar', moviehash_match: 'false', files: [{ file_id: 1 }] } }).matchedByHash, false);
});

test('BluRay playback keeps searching past Arabic WEB and BluRay metadata without measured proof', () => {
  assert.equal(needsTimingDiscovery([candidate('WEB-DL')], search), true);
  assert.equal(needsTimingDiscovery([candidate('1080p.BluRay')], search), true);
  const movie = buildVideoIdentity({ type: 'movie', id: 'tt1375666', filename: 'Inception.2010.2160p.BluRay.REMUX.mkv', videoSize: 64_424_509_440 });
  const row = { ...candidate('WEB-DL'), imdbId: movie.imdbId, season: null, episode: null, releaseName: 'Inception.2010.WEB-DL' };
  assert.equal(needsTimingDiscovery([row], movie), true);
  assert.equal(needsTimingDiscovery([{ ...row, releaseName: 'Inception.2010.1080p.BluRay' }], movie), true);
});

test('wrong episode and incompatible FPS do not stop timing discovery', () => {
  assert.equal(needsTimingDiscovery([{ ...candidate('BluRay'), episode: 3 }], search), true);
  assert.equal(needsTimingDiscovery([{ ...candidate('BluRay'), fps: 25 }], buildVideoIdentity({ ...search, fps: 23.976 })), true);
});

test('source recovery query is early, episode-specific and retains catalog identity', () => {
  const provider = { name: 'os', configured: () => true, supports: { hash: true, series: true } };
  const plan = createExhaustiveCoveragePlan(search, { os: provider }, ['os']);
  const stage = plan[1];
  assert.equal(stage.name, 'coverage-source-family');
  assert.equal(stage.variants[0].query, 'House of the Dragon S02E02 BluRay');
  assert.equal(stage.variants[0].imdbId, search.imdbId);
});

test('preflight inspects beyond valid but mismatched Arabic candidates', async () => {
  const seen = [];
  const rows = Array.from({ length: 12 }, (_, i) => candidate('WEB-DL', String(i)));
  const result = await applyAccuracyPreflight(rows, search, {
    cacheGetImpl: async () => null, cacheSetImpl: async () => {},
    preflightImpl: async item => { seen.push(item.id); return { quality }; },
  });
  assert.equal(seen.length, 12);
  assert.equal(result.length, 12);
});

test('post-preflight searches beyond mismatched text, caches discovery and rechecks recovered files', async () => {
  const web = candidate('WEB-DL');
  const bluray = candidate('BluRay');
  let recoverCalls = 0;
  let cached;
  const checked = [];
  const deps = {
    coreSearch: async () => ({ results: [web], cycleStatus: 'complete' }),
    preflight: async rows => { checked.push(rows.map(row => row.id)); return rows; },
    recover: async (_search, options) => {
      recoverCalls++;
      assert.ok(options.signal);
      return Object.assign([bluray], { coverage: { status: 'complete' } });
    },
    readCache: async () => cached ? { hit: true, value: cached } : null,
    writeCache: async (_key, value) => { cached = value; },
  };
  for (let i = 0; i < 2; i++) {
    const result = await searchCore(search, deps);
    assert.ok(result.results.some(row => row.id === 'BluRay'));
  }
  assert.equal(recoverCalls, 1);
  assert.equal(checked.filter(ids => ids.includes('BluRay')).length, 2);
});

test('matching BluRay metadata without measured timing still triggers bounded deep recovery', async () => {
  let recovered = false;
  await searchCore(search, {
    coreSearch: async () => ({ results: [candidate('BluRay')], cycleStatus: 'complete' }),
    preflight: async rows => rows,
    recover: async (_search, options) => { assert.ok(options.signal); recovered = true; return []; },
  });
  assert.equal(recovered, true);
});

test('strongly measured BluRay timeline avoids unnecessary deep recovery', async () => {
  let recovered = false;
  await searchCore(search, {
    coreSearch: async () => ({ results: [{ ...candidate('BluRay'), actualTimingEvidence: alignedTiming }], cycleStatus: 'complete' }),
    preflight: async rows => rows,
    recover: async () => { recovered = true; return []; },
  });
  assert.equal(recovered, false);
});
