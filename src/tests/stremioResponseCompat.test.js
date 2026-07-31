import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStremioSubtitleResponse } from '../utils/stremioResponseCompat.js';

test('Stremio subtitle responses put the reliable original option first and bust old client IDs', () => {
  const source = {
    subtitles: [
      { id: 'one-refsync', url: 'https://example.com/ref.srt' },
      { id: 'one-sync-v3_5_2', url: 'https://example.com/sync.srt' },
      { id: 'one-orig-v3_5_1', url: 'https://example.com/orig.srt' },
      { id: 'one-styled-ass', url: 'https://example.com/styled.ass' },
    ],
  };
  const result = normalizeStremioSubtitleResponse(source, '3.5.4');
  assert.deepEqual(result.subtitles.map(item => item.id), [
    'one-orig-v3_5_4',
    'one-sync-v3_5_4',
    'one-refsync-v3_5_4',
    'one-styled-ass-v3_5_4',
  ]);
  assert.deepEqual(result.subtitles.map(item => item.url), [
    'https://example.com/orig.srt',
    'https://example.com/sync.srt',
    'https://example.com/ref.srt',
    'https://example.com/styled.ass',
  ]);
  assert.deepEqual(normalizeStremioSubtitleResponse(result, '3.5.4'), result);
});
