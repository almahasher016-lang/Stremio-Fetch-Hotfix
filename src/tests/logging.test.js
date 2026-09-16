import test from 'node:test';
import assert from 'node:assert/strict';
import { redactRequestUrl } from '../utils/logging.js';

test('request logging redacts signed subtitle paths and administrative query tokens', () => {
  assert.equal(
    redactRequestUrl('/proxy/encoding/secret.payload.srt?token=my-vault-token&q=test'),
    '/proxy/encoding/[redacted]?token=%5Bredacted%5D&q=test',
  );
  assert.equal(
    redactRequestUrl('/preview/encoding/secret.payload.json'),
    '/preview/encoding/[redacted]',
  );
  assert.equal(
    redactRequestUrl('https://subtitles.example/proxy/encoding/secret.srt?q=1'),
    '/proxy/encoding/[redacted]?q=1',
  );
});

test('Stremio path metadata and ordinary query strings never expose playback hashes or API credentials', () => {
  const playbackHash = 'e9893332dc323e8d';
  const providerKey = 'secret-subdl-api-key';
  const inputs = [
    `/subtitles/movie/tt33296751/filename=Tuner.2025.BluRay.mkv&videoHash=${playbackHash}.json`,
    `/subtitles/movie/tt33296751/filename=Tuner.mkv&movie_hash=${playbackHash}&api_key=${providerKey}.json`,
    `/subtitles/movie/tt33296751?videoHash=${playbackHash}&api_key=${providerKey}&q=ok`,
    `https://example.test/subtitles/movie/tt33296751?fileHash=${playbackHash}&subdl_api_key=${providerKey}`,
  ];
  for (const input of inputs) {
    const output = redactRequestUrl(input);
    assert.doesNotMatch(output, /e9893332dc323e8d|secret-subdl-api-key/);
    assert.match(output, /redacted/);
  }
  assert.match(redactRequestUrl('/subtitles/movie/tt33296751?videoHash=abc&q=ok'), /q=ok/);
});
