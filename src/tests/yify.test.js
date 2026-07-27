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
