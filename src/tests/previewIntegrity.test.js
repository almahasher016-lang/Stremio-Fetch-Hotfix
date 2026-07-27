import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicPreview } from '../api/routes/subtitles.js';
import { verifyEncodingToken } from '../utils/encodingProxy.js';

function tokenFromPreviewUrl(value) {
  const match = new URL(value).pathname.match(/^\/preview\/encoding\/(.+)\.json$/);
  assert.ok(match);
  return match[1];
}

test('each preview token points to the same asset and has no runtime fallback', () => {
  const results = [
    {
      id: 'first',
      provider: 'opensubtitles',
      providerId: 'one',
      name: 'First Arabic',
      lang: 'ara',
      download: 'https://example.com/first.srt',
      referenceSubtitle: {
        provider: 'opensubtitles',
        name: 'First English',
        download: 'https://example.com/first-en.srt',
      },
    },
    {
      id: 'second',
      provider: 'subdl',
      providerId: 'two',
      name: 'Second Arabic',
      lang: 'ara',
      download: 'https://example.com/second.srt',
      referenceSubtitle: {
        provider: 'subdl',
        name: 'Second English',
        download: 'https://example.com/second-en.srt',
      },
    },
  ];
  const previews = toPublicPreview(results, 'https://addon.example', { type: 'movie', id: 'tt1375666' });

  assert.equal(previews.length, 2);
  for (const preview of previews) {
    const payload = verifyEncodingToken(tokenFromPreviewUrl(preview.previewUrl));
    assert.equal(payload.candidate.providerId, preview.asset.providerId);
    assert.equal(payload.fallbacks.length, 0);
  }
});
