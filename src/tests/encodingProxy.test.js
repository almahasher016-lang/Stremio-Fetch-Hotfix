import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { createEncodingToken, verifyEncodingToken } from '../utils/encodingProxy.js';
import { toStremioSubtitles } from '../utils/stremio.js';

test('encoding tokens retain a bounded ordered Arabic fallback chain', () => {
  const token = createEncodingToken({
    url: 'https://example.com/primary.srt',
    provider: 'primary',
    candidate: { provider: 'primary', providerId: 'one', lang: 'ara' },
    fallbacks: Array.from({ length: config.encodingProxy.maxFallbacks + 2 }, (_value, index) => ({
      url: `https://example.com/fallback-${index}.srt`,
      provider: 'fallback',
      candidate: { provider: 'fallback', providerId: `fallback-${index}`, lang: 'ara' },
    })),
  });
  const payload = verifyEncodingToken(token);
  assert.equal(payload.fallbacks.length, config.encodingProxy.maxFallbacks);
  assert.equal(payload.fallbacks[0].candidate.providerId, 'fallback-0');
  assert.equal(payload.fallbacks[1].candidate.providerId, 'fallback-1');
});

test('the first Stremio result carries the next ranked candidate as fallback', () => {
  const results = [
    { id: 'first', provider: 'opensubtitles', providerId: 'one', lang: 'ara', download: 'https://example.com/first.srt' },
    { id: 'second', provider: 'subdl', providerId: 'two', lang: 'ara', download: 'https://example.com/second.srt' },
  ];
  const subtitles = toStremioSubtitles(results, 'https://addon.example', { type: 'movie', id: 'tt1375666' });
  const match = new URL(subtitles[0].url).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/);
  assert.ok(match);
  const payload = verifyEncodingToken(match[1]);
  assert.equal(payload.candidate.providerId, 'one');
  assert.equal(payload.fallbacks[0].candidate.providerId, 'two');
});
