import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendNoTransform,
  normalizeStremioSubtitleResponse,
  shouldPreserveBodyEncoding,
} from '../utils/stremioResponseCompat.js';

test('Stremio subtitle responses put the reliable original option first and bust old client IDs', () => {
  const source = {
    subtitles: [
      { id: 'one-refsync', url: 'https://example.com/ref.srt' },
      { id: 'one-sync-v3_5_2', url: 'https://example.com/sync.srt' },
      { id: 'one-orig-v3_5_1', url: 'https://example.com/orig.srt' },
      { id: 'one-styled-ass', url: 'https://example.com/styled.ass' },
    ],
  };
  const result = normalizeStremioSubtitleResponse(source, '3.5.3');
  assert.deepEqual(result.subtitles.map(item => item.id), [
    'one-orig-v3_5_3',
    'one-sync-v3_5_3',
    'one-refsync-v3_5_3',
    'one-styled-ass-v3_5_3',
  ]);
  assert.deepEqual(result.subtitles.map(item => item.url), [
    'https://example.com/orig.srt',
    'https://example.com/sync.srt',
    'https://example.com/ref.srt',
    'https://example.com/styled.ass',
  ]);
  assert.deepEqual(normalizeStremioSubtitleResponse(result, '3.5.3'), result);
});

test('no-transform policy is appended exactly once', () => {
  assert.equal(appendNoTransform('public, max-age=86400'), 'public, max-age=86400, no-transform');
  assert.equal(appendNoTransform('public, no-transform, max-age=86400'), 'public, no-transform, max-age=86400');
  assert.equal(appendNoTransform(''), 'no-transform');
});

test('only response bodies modified late are protected from compression', () => {
  for (const path of ['/', '/configure', '/admin.html', '/proxy/encoding/token.srt', '/proxy/styled/token.ass']) {
    assert.equal(shouldPreserveBodyEncoding(path), true, path);
  }
  for (const path of ['/manifest.json', '/health', '/subtitles/movie/tt123.json']) {
    assert.equal(shouldPreserveBodyEncoding(path), false, path);
  }
});
