import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDegradedAvailability } from '../services/subtitleService.js';

test('degraded response merges the current partial pool with Final LKG before returning', async () => {
  const search = { filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.Remux.mkv' };
  const fresh = [
    { id:'web', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.2160p.WEB-DL-GRP', score:1326, lang:'ara', releaseMatch:{targetFields:3,tier:2,priority:21000,criticalMismatches:0,mismatched:['source']} },
  ];
  const lkg = { hit:true, value:[
    { id:'bluray', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.720p.BluRay.x264-BLOODY', score:1298, lang:'ara', releaseMatch:{targetFields:3,tier:2,priority:18000,criticalMismatches:0,mismatched:['quality']} },
    { id:'webrip', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.WEBRIP-GRP', score:1210, lang:'ara', releaseMatch:{targetFields:3,tier:1,priority:10000,criticalMismatches:0,mismatched:['source']} },
  ]};
  const results = await reconcileDegradedAvailability(search, { results:fresh, cycleStatus:'degraded' }, lkg);
  assert.equal(results.length, 3);
  assert.equal(results[0].id, 'bluray');
});

test('complete response does not merge old LKG', async () => {
  const search = { filename: 'Movie.2026.2160p.BluRay.Remux.mkv' };
  const fresh = [{ id:'new', provider:'opensubtitles', releaseName:'Movie.2026.2160p.BluRay.Remux-GRP', score:1000, lang:'ara' }];
  const lkg = { hit:true, value:[{ id:'old', provider:'subdl', releaseName:'Movie.2026.720p.BluRay-OLD', score:900, lang:'ara' }]};
  const results = await reconcileDegradedAvailability(search, { results:fresh, cycleStatus:'complete' }, lkg);
  assert.deepEqual(results.map(item => item.id), ['new']);
});
