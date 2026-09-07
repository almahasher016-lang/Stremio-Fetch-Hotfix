import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';
import { buildTimingProfile, deriveReferenceSyncPlanFromProfiles } from '../utils/referenceSync.js';

function srt(starts) {
  const time = ms => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
  };
  return starts.map((start, index) => {
    const end = start + 1200 + (index % 3) * 180;
    return `${index + 1}\n${time(start)} --> ${time(end)}\nسطر عربي رقم ${index + 1}`;
  }).join('\n\n');
}

const baseStarts = Array.from({ length: 60 }, (_, index) => index * 3700 + (index % 7) * 190);
const referenceProfile = buildTimingProfile(srt(baseStarts));
const reference = {
  id: 'en-ref',
  provider: 'opensubtitles',
  providerId: '999',
  fileId: '999',
  download: '/downloads/opensubtitles/999.srt',
  lang: 'eng',
  releaseName: 'Exact.Hash.Reference',
};
const noCache = { cacheGetImpl: async () => null, cacheSetImpl: async () => {} };

function candidate(id, score = 500, providerId = '101') {
  return {
    id,
    provider: 'opensubtitles',
    providerId,
    fileId: providerId,
    download: `/downloads/opensubtitles/${providerId}.srt`,
    lang: 'ara',
    score,
    releaseName: `Movie.2026.2160p.BluRay.${id}`,
    releaseMatch: { targetFields: 3, criticalMismatches: 0, tier: 3, priority: 30000, mismatched: [] },
    timingReferenceEvidence: { exactVideoHash: true, matchScore: 900 },
    referenceSubtitle: reference,
  };
}

test('actual cue timing outranks a higher textual score with the same exact-hash reference', async () => {
  const profiles = {
    aligned: buildTimingProfile(srt(baseStarts)),
    shifted: buildTimingProfile(srt(baseStarts.map(value => value + 9000))),
  };
  const results = await applyAccuracyPreflight(
    [candidate('shifted', 900, '102'), candidate('aligned', 400, '101')],
    { filename: 'Movie.2026.2160p.BluRay.Remux.mkv', videoHash: 'abc' },
    {
      ...noCache,
      preflightImpl: async item => ({ quality: { valid: true, score: 90, reasons: [] }, timingProfile: profiles[item.id] }),
      referencePreflightImpl: async () => ({ timingProfile: referenceProfile }),
    },
  );
  assert.equal(results[0].id, 'aligned');
  assert.equal(results[0].actualTimingEvidence.verdict, 'aligned');
  assert.equal(results[1].actualTimingEvidence.verdict, 'repairable');
});

test('measured timing rescues an aligned candidate from the tenth visible slot', async () => {
  const shiftedProfile = buildTimingProfile(srt(baseStarts.map(value => value + 8500)));
  const alignedProfile = buildTimingProfile(srt(baseStarts));
  const candidates = Array.from({ length: 10 }, (_, index) => {
    const aligned = index === 9;
    return candidate(aligned ? 'aligned-tenth' : `shifted-${index}`, 1000 - index * 35, String(300 + index));
  });
  const results = await applyAccuracyPreflight(
    candidates,
    { filename: 'Movie.2026.2160p.BluRay.Remux.mkv', videoHash: 'abc' },
    {
      ...noCache,
      preflightImpl: async item => ({
        quality: { valid: true, score: 90, reasons: [] },
        timingProfile: item.id === 'aligned-tenth' ? alignedProfile : shiftedProfile,
      }),
      referencePreflightImpl: async () => ({ timingProfile: referenceProfile }),
    },
  );
  assert.equal(results[0].id, 'aligned-tenth');
  assert.equal(results[0].actualTimingEvidence.verdict, 'aligned');
});

test('a clearly different cut is marked incompatible instead of trusted by BluRay metadata alone', async () => {
  const shortProfile = buildTimingProfile(srt(baseStarts.slice(0, 20)));
  const results = await applyAccuracyPreflight(
    [candidate('wrong-cut', 900, '401'), candidate('unknown', 500, '402')],
    { filename: 'Movie.2026.2160p.BluRay.Remux.mkv', videoHash: 'abc' },
    {
      ...noCache,
      preflightImpl: async item => {
        if (item.id === 'unknown') throw new Error('temporary provider outage');
        return { quality: { valid: true, score: 90, reasons: [] }, timingProfile: shortProfile };
      },
      referencePreflightImpl: async () => ({ timingProfile: referenceProfile }),
    },
  );
  assert.equal(results[0].id, 'unknown');
  assert.equal(results[1].actualTimingEvidence.verdict, 'incompatible');
});

test('reference outage fails open and preserves deterministic ranking', async () => {
  const first = candidate('first', 700, '501');
  const second = candidate('second', 600, '502');
  const results = await applyAccuracyPreflight(
    [first, second],
    { filename: 'Movie.2026.2160p.BluRay.Remux.mkv', videoHash: 'abc' },
    {
      ...noCache,
      preflightImpl: async () => ({ quality: { valid: true, score: 90, reasons: [] }, timingProfile: referenceProfile }),
      referencePreflightImpl: async () => { throw new Error('reference unavailable'); },
    },
  );
  assert.deepEqual(results.map(item => item.id), ['first', 'second']);
  assert.equal(results.some(item => item.actualTimingEvidence), false);
});

test('profile-based timing derivation matches the exact timeline without mutating delivery sync', () => {
  const plan = deriveReferenceSyncPlanFromProfiles(referenceProfile, referenceProfile, {
    minCues: 4,
    minCueRatio: 0,
    minConfidence: 0,
    minTemporalAgreement: 0,
    minAnchorCoverage: 0,
    dtwEnabled: true,
    piecewise: true,
  });
  assert.ok(plan.sourceCueCount >= 60);
  assert.ok(plan.referenceCueCount >= 60);
  assert.ok(plan.temporalAgreement > 0.8);
});
