import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPlan } from '../services/searchPlanner.js';
import { hasHardIdentityConflict } from '../services/subtitleServiceCore.js';
import { providerDefinitions } from '../providers/registry.js';
import { toStremioSubtitles } from '../utils/stremio.js';
import { verifyEncodingToken } from '../utils/encodingProxy.js';

test('strict movie title fallback includes year to disambiguate remakes', () => {
  const plan = createSearchPlan({ type:'movie', title:'The Mummy', year:2026 }, providerDefinitions, ['opensubtitles'], { language:'ar' });
  const stage = plan.find(item => item.name === 'title-fallback');
  assert.equal(stage?.variants?.[0]?.query, 'The Mummy 2026');
});

test('relaxed recovery may use bare title after strict year-qualified search', () => {
  const plan = createSearchPlan({ type:'movie', title:'The Mummy', year:2026 }, providerDefinitions, ['opensubtitles'], { language:'ar', relaxed:true });
  const stage = plan.find(item => item.name === 'title-fallback');
  assert.equal(stage?.variants?.[0]?.query, 'The Mummy');
});

test('explicit wrong year is a hard identity conflict unless exact hash proves the video', () => {
  const search = { videoHash:'abc123' };
  const wrong = { releaseMatch:{ mismatched:['year'] } };
  assert.equal(hasHardIdentityConflict(wrong, search), true);
  const exact = { ...wrong, movieHash:'abc123' };
  assert.equal(hasHardIdentityConflict(exact, search), false);
});

const referenceCandidate = {
  id:'ar-1', provider:'opensubtitles', providerId:'123',
  download:'/downloads/opensubtitles/123.srt', lang:'ara', score:1000,
  timingReferenceEvidence:{ exactVideoHash:true, matchScore:900 },
  referenceSyncMode:'exact-hash-stable',
  referenceSubtitle:{
    id:'en-1', provider:'opensubtitles', providerId:'456',
    download:'/downloads/opensubtitles/456.srt', lang:'eng', releaseName:'Movie.2026.WEB-DL',
  },
};

function originalToken(item) {
  const [option] = toStremioSubtitles([item], 'https://example.test', { type:'movie', videoHash:'abc', filename:'Movie.2026.WEB-DL.mkv' });
  assert.ok(option?.url?.includes('/assets/encoding/'));
  const token = option.url.split('/assets/encoding/')[1].replace(/\.srt$/, '');
  return { payload: verifyEncodingToken(token), name: option.name };
}

test('unmeasured reference never enters an original subtitle delivery token or hides warning', () => {
  const { payload, name } = originalToken(referenceCandidate);
  assert.equal(payload.reference, null);
  assert.match(name, /Timing Unverified/);
});

test('normal original option carries exact-hash reference after V5 verifies measured alignment', () => {
  const measured = { ...referenceCandidate,
    v5Proof: { decision: 'certified', confidence: { timing: 0.9999 } },
    actualTimingEvidence: {
      measured: true, exactVideoHash: true, verdict: 'aligned',
      offsetMs: 50, residualMedianMs: 80, residualP90Ms: 120, anchorCoverage: 0.9,
    },
  };
  const { payload, name } = originalToken(measured);
  assert.equal(payload.reference?.exactVideoHash, true);
  assert.doesNotMatch(name, /Timing Unverified/);
});
