import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';
import { buildTimingProfile } from '../utils/referenceSync.js';

function srt(starts) {
  return starts.map((start, i) => {
    const end = start + 1200 + (i % 3) * 180;
    const time = ms => { const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000), s=Math.floor((ms%60000)/1000), x=ms%1000; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(x).padStart(3,'0')}`; };
    return `${i+1}\n${time(start)} --> ${time(end)}\nسطر عربي رقم ${i+1}`;
  }).join('\n\n');
}

const baseStarts = Array.from({ length: 60 }, (_, i) => i * 3700 + (i % 7) * 190);
const referenceProfile = buildTimingProfile(srt(baseStarts));
const reference = { provider:'opensubtitles', providerId:'999', download:'/downloads/opensubtitles/999.srt', exactVideoHash:true, releaseName:'Exact.Hash.Reference' };
function candidate(id, score=500) { return { id, provider:'opensubtitles', providerId:id==='aligned'?'101':'102', fileId:id==='aligned'?'101':'102', download:`/downloads/opensubtitles/${id==='aligned'?'101':'102'}.srt`, lang:'ara', score, releaseName:`Movie.2026.2160p.BluRay.${id}`, releaseMatch:{targetFields:3,criticalMismatches:0,tier:3,priority:30000,mismatched:[]}, exactTimingReference:reference }; }
const noCache={cacheGetImpl:async()=>null,cacheSetImpl:async()=>{}};

test('actual cue timing outranks a higher textual score when both use the same exact-hash reference', async () => {
  const profiles={
    aligned: buildTimingProfile(srt(baseStarts)),
    shifted: buildTimingProfile(srt(baseStarts.map(v=>v+9000))),
  };
  const results=await applyAccuracyPreflight([candidate('shifted',900),candidate('aligned',400)],{filename:'Movie.2026.2160p.BluRay.Remux.mkv',videoHash:'abc'}, {
    ...noCache,
    preflightImpl:async item=>({quality:{valid:true,score:90,reasons:[]},timingProfile:profiles[item.id]}),
    referencePreflightImpl:async()=>({timingProfile:referenceProfile}),
  });
  assert.equal(results[0].id,'aligned');
  assert.equal(results[0].actualTimingEvidence.verdict,'aligned');
  assert.equal(results[1].actualTimingEvidence.verdict,'repairable');
});

test('high-confidence shifted timing receives a safe exact-hash correction plan', async () => {
  const shifted=buildTimingProfile(srt(baseStarts.map(v=>v+6000)));
  const results=await applyAccuracyPreflight([candidate('shifted')],{filename:'Movie.2026.2160p.BluRay.Remux.mkv',videoHash:'abc'}, {
    ...noCache,
    preflightImpl:async()=>({quality:{valid:true,score:90,reasons:[]},timingProfile:shifted}),
    referencePreflightImpl:async()=>({timingProfile:referenceProfile}),
  });
  assert.equal(results[0].actualTimingEvidence.verdict,'repairable');
  assert.equal(results[0].safeTimingSyncPlan?.enabled,true);
  assert.equal(results[0].safeTimingSyncPlan?.exactVideoHash,true);
});

test('a clearly different cut is marked incompatible rather than trusted by BluRay metadata alone', async () => {
  const shortProfile=buildTimingProfile(srt(baseStarts.slice(0,20)));
  const results=await applyAccuracyPreflight([candidate('shifted')],{filename:'Movie.2026.2160p.BluRay.Remux.mkv',videoHash:'abc'}, {
    ...noCache,
    preflightImpl:async()=>({quality:{valid:true,score:90,reasons:[]},timingProfile:shortProfile}),
    referencePreflightImpl:async()=>({timingProfile:referenceProfile}),
  });
  assert.equal(results[0].actualTimingEvidence.verdict,'incompatible');
  assert.equal(Boolean(results[0].safeTimingSyncPlan),false);
});

test('reference outage fails open and preserves deterministic existing ranking', async () => {
  const first=candidate('shifted',700), second=candidate('aligned',600);
  const results=await applyAccuracyPreflight([first,second],{filename:'Movie.2026.2160p.BluRay.Remux.mkv',videoHash:'abc'}, {
    ...noCache,
    preflightImpl:async()=>({quality:{valid:true,score:90,reasons:[]},timingProfile:referenceProfile}),
    referencePreflightImpl:async()=>{throw new Error('reference unavailable');},
  });
  assert.deepEqual(results.map(x=>x.id),['shifted','aligned']);
  assert.equal(results.some(x=>x.actualTimingEvidence),false);
});
