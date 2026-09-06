import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { parseYifyRows, searchYify } from '../providers/yify.js';
import { buildRemoteSubtitleHeaders } from '../utils/encodingProxy.js';

test('YIFY rows point to downloadable ZIP archives instead of detail pages', () => {
  const html = `<table><tbody>
    <tr data-id="392064">
      <td><span class="sub-lang">Arabic</span></td>
      <td><a href="/subtitles/inception-2010-arabic-yify-392064">
        <span class="text-muted">subtitle</span> Inception.2010.1080p.BrRip.x264.YIFY
      </a></td>
    </tr>
  </tbody></table>`;
  const rows = parseYifyRows(html, 'tt1375666');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'yify-tt1375666-392064');
  assert.equal(rows[0].name, 'Inception.2010.1080p.BrRip.x264.YIFY');
  assert.equal(rows[0].download, `${config.yify.baseUrl}/subtitle/inception-2010-arabic-yify-392064.zip`);
});

test('YIFY rows ignore unrelated anchors before the subtitle detail link', () => {
  const html = `<table><tbody>
    <tr data-id="392064">
      <td><a href="/movie/inception-2010"><img src="poster.jpg" alt="Inception"></a></td>
      <td><span class="sub-lang">Arabic</span></td>
      <td><a href="/subtitles/inception-2010-arabic-yify-392064">
        <span class="text-muted">subtitle</span> Inception.2010.1080p.BrRip.x264.YIFY
      </a></td>
    </tr>
  </tbody></table>`;
  const rows = parseYifyRows(html, 'tt1375666');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'yify-tt1375666-392064');
  assert.equal(rows[0].name, 'Inception.2010.1080p.BrRip.x264.YIFY');
  assert.equal(rows[0].download, `${config.yify.baseUrl}/subtitle/inception-2010-arabic-yify-392064.zip`);
});

test('YIFY archive requests include the detail-page referrer required by its CDN', () => {
  const url = `${config.yify.baseUrl}/subtitle/inception-2010-arabic-yify-392064.zip`;
  const headers = buildRemoteSubtitleHeaders(url, 'yify');
  assert.match(headers['user-agent'], /^Mozilla\/5\.0/);
  assert.equal(headers.referer, `${config.yify.baseUrl}/subtitles/inception-2010-arabic-yify-392064`);

  const external = buildRemoteSubtitleHeaders('https://example.com/subtitle.srt', 'yify');
  assert.equal(external['user-agent'], config.app.userAgent);
  assert.equal(external.referer, undefined);
});

test('YIFY propagates a real outage when every endpoint fails', async () => {
  await assert.rejects(
    searchYify(
      { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
      { fetchTextImpl: async () => { throw new Error('network unavailable'); } },
    ),
    /network unavailable/,
  );
});

test('YIFY distinguishes a valid empty page from a broken Arabic layout', async () => {
  const empty = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => '<html><body>No subtitles for this movie</body></html>',
    },
  );
  assert.deepEqual(empty, []);

  await assert.rejects(
    searchYify(
      { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
      { fetchTextImpl: async () => '<tr><td><span class="sub-lang">Arabic</span></td><td>new layout</td></tr>' },
    ),
    /layout is no longer supported/,
  );
});

test('YIFY stores parsed last-known-good rows and reuses them during a later outage', async () => {
  const html = `<table><tbody>
    <tr data-id="392064">
      <td><span class="sub-lang">Arabic</span></td>
      <td><a href="/subtitles/inception-2010-arabic-yify-392064">Inception.2010.1080p.BrRip.x264.YIFY</a></td>
    </tr>
  </tbody></table>`;
  let cachedRows = null;
  let cachedTtl = null;
  const live = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => html,
      cacheSetImpl: async (_key, value, ttl) => {
        cachedRows = value;
        cachedTtl = ttl;
      },
      cacheGetEntryImpl: async () => null,
    },
  );
  assert.equal(live.length, 1);
  assert.equal(cachedRows.length, 1);
  assert.equal(cachedTtl, 3600);

  const fallback = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => { throw new Error('upstream unavailable'); },
      cacheGetEntryImpl: async () => ({ value: cachedRows, stale: true, source: 'redis' }),
      cacheSetImpl: async () => {},
    },
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].lastKnownGood, true);
  assert.equal(fallback[0].sourceType, 'fallback-cache');
  assert.equal(fallback[0].searchReason, 'yify-last-known-good');
});

test('YIFY can fall back to last-known-good rows when an anti-bot challenge appears', async () => {
  const cached = [{
    provider: 'yify',
    id: 'yify-tt1375666-1',
    providerId: '1',
    name: 'Inception.2010.BluRay',
    releaseName: 'Inception.2010.BluRay',
    lang: 'ara',
    imdbId: 'tt1375666',
    download: `${config.yify.baseUrl}/subtitle/inception.zip`,
  }];
  const rows = await searchYify(
    { type: 'movie', imdbId: 'tt1375666', language: 'ar' },
    {
      fetchTextImpl: async () => '<html><title>Just a moment...</title><form id="challenge-form"></form></html>',
      cacheGetEntryImpl: async () => ({ value: cached, stale: true }),
      cacheSetImpl: async () => {},
    },
  );
  assert.equal(rows[0].lastKnownGood, true);
});

