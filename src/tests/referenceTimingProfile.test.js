import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimingProfile, deriveReferenceSyncPlanFromProfiles } from '../utils/referenceSync.js';

const fmt=ms=>{const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(x).padStart(3,'0')}`};
const make=(shift=0)=>Array.from({length:50},(_,i)=>{const st=i*4100+(i%5)*130+shift;return `${i+1}\n${fmt(st)} --> ${fmt(st+1400+(i%4)*100)}\nx`;}).join('\n\n');

test('timing profile is bounded while preserving original cue count',()=>{const p=buildTimingProfile(make(),32);assert.equal(p.cueCount,50);assert.ok(p.cues.length<=32);});
test('profile comparison detects a global shift without release metadata',()=>{const a=buildTimingProfile(make(5000)),b=buildTimingProfile(make(0));const plan=deriveReferenceSyncPlanFromProfiles(a,b,{minCues:4,minCueRatio:0,minConfidence:0,minTemporalAgreement:0,minAnchorCoverage:0,dtwEnabled:true,piecewise:true});assert.ok(Math.abs(plan.offsetMs+5000)<1200);assert.ok(plan.temporalAgreement>0.75);});
