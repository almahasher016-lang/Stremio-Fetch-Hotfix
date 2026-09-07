import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prioritizeAccurateSubtitles, applyPostAccuracyScoreFloor } from '../utils/accuracyFirst.js';
import { classifyProviderCycle } from '../services/subtitleServiceCore.js';

const corpus = JSON.parse(await readFile(new URL('./fixtures/timing-regressions.json', import.meta.url), 'utf8'));
for (const item of corpus) {
  test(`timing regression: ${item.name}`, () => {
    const ranked = prioritizeAccurateSubtitles(item.candidates, item.search);
    assert.equal(ranked[0].id, item.expected);
  });
}

test('post-accuracy score floor rescues a strong source-family match', () => {
  const search = { filename: 'Show.S01E07.2160p.BluRay.Remux-GRP.mkv' };
  const results = [
    { id:'bluray-low', provider:'subdl', releaseName:'Show.S01E07.720p.BluRay.x264-BLOODY', score:-500, releaseMatch:{targetFields:3,tier:2,priority:12000,criticalMismatches:0,mismatched:['quality']} },
    { id:'unknown-low', provider:'yify', releaseName:'Show.S01E07.Unknown.Release', score:-600, releaseMatch:{targetFields:0,tier:0,priority:0,criticalMismatches:0,mismatched:[]} },
    { id:'web-high', provider:'opensubtitles', releaseName:'Show.S01E07.2160p.WEB-DL-GRP', score:1600, releaseMatch:{targetFields:3,tier:2,priority:22000,criticalMismatches:0,mismatched:['source']} },
  ];
  const ranked = applyPostAccuracyScoreFloor(results, search, -250);
  assert.equal(ranked[0].id, 'bluray-low');
  assert.ok(ranked.some(item => item.id === 'bluray-low'));
  assert.equal(ranked.some(item => item.id === 'unknown-low'), false);
});

test('provider cycle completeness distinguishes complete, degraded and failed', () => {
  assert.equal(classifyProviderCycle({attempted:3,succeeded:3,failed:0}), 'complete');
  assert.equal(classifyProviderCycle({attempted:3,succeeded:2,failed:1}), 'degraded');
  assert.equal(classifyProviderCycle({attempted:2,succeeded:0,failed:2}), 'failed');
});
