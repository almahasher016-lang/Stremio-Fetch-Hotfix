import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAndFilter, scoreSubtitle } from '../utils/scoring.js';

test('scoreSubtitle rewards matching Arabic release', () => {
  const scored = scoreSubtitle({ lang: 'ara', releaseName: 'Movie.Name.2024.1080p.WEB-DL-GRP', downloads: 100, download: 'https://example.com/a.srt' }, { query: 'Movie Name', filename: 'Movie.Name.2024.1080p.WEB-DL-GRP.mkv' });
  assert.ok(scored.score > 500);
});

test('rankAndFilter removes machine translated results when requested', () => {
  const ranked = rankAndFilter([
    { lang: 'ara', releaseName: 'A.1080p.WEB-DL', download: 'https://example.com/a.srt' },
    { lang: 'ara', releaseName: 'B.1080p.WEB-DL', machineTranslated: true, download: 'https://example.com/b.srt' },
  ], { query: 'A', filename: 'A.1080p.WEB-DL.mkv' }, { excludeMachineTranslated: true, outputArabicOnly: true });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].releaseName, 'A.1080p.WEB-DL');
});
