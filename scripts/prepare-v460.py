from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)


# Safe version bump: project metadata only, never dependency versions.
pkg_path = ROOT / 'package.json'
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = '4.6.0'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

lock_path = ROOT / 'package-lock.json'
lock = json.loads(lock_path.read_text(encoding='utf-8'))
lock['version'] = '4.6.0'
if isinstance(lock.get('packages'), dict) and isinstance(lock['packages'].get(''), dict):
    lock['packages']['']['version'] = '4.6.0'
lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

path = 'src/release.js'
text = read(path)
text, count = re.subn(r"export const RELEASE_VERSION = '[^']+';", "export const RELEASE_VERSION = '4.6.0';", text, count=1)
if count != 1:
    raise SystemExit('release version anchor not found')
write(path, text)

# Timing-evidence configuration is separate from delivery-time sync policy.
path = 'src/configCore.js'
text = read(path)
anchor = """    accuracyPreflight: {
      enabled: toBool(get('ACCURACY_PREFLIGHT_ENABLED'), true),
      topN: toInt(get('ACCURACY_PREFLIGHT_TOP_N'), 5, 0, 5),
      timeoutMs: toInt(get('ACCURACY_PREFLIGHT_TIMEOUT_MS'), 1800, 300, 8000),
      cacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_CACHE_TTL'), 21600, 300, 604800),
      rejectCacheTtlSeconds: toInt(get('ACCURACY_PREFLIGHT_REJECT_CACHE_TTL'), 180, 30, 3600),
    },
"""
insert = anchor + """    timingEvidence: {
      enabled: toBool(get('TIMING_EVIDENCE_ENABLED'), true),
      topN: toInt(get('TIMING_EVIDENCE_TOP_N'), 10, 1, 20),
      timeoutMs: toInt(get('TIMING_EVIDENCE_TIMEOUT_MS'), 2600, 500, 8000),
      maxCues: toInt(get('TIMING_EVIDENCE_MAX_CUES'), 192, 32, 400),
      cacheTtlSeconds: toInt(get('TIMING_EVIDENCE_CACHE_TTL'), 21600, 300, 604800),
      minCues: toInt(get('TIMING_EVIDENCE_MIN_CUES'), 24, 4, 200),
      minCueRatio: toNumber(get('TIMING_EVIDENCE_MIN_CUE_RATIO'), 0.62, 0, 1),
      minTemporalAgreement: toNumber(get('TIMING_EVIDENCE_MIN_AGREEMENT'), 0.68, 0, 1),
      minAnchorCoverage: toNumber(get('TIMING_EVIDENCE_MIN_COVERAGE'), 0.58, 0, 1),
      maxResidualMedianMs: toInt(get('TIMING_EVIDENCE_MAX_MEDIAN_RESIDUAL_MS'), 2500, 100, 20000),
      maxResidualP90Ms: toInt(get('TIMING_EVIDENCE_MAX_P90_RESIDUAL_MS'), 7000, 500, 60000),
      alignedMaxOffsetMs: toInt(get('TIMING_EVIDENCE_ALIGNED_MAX_OFFSET_MS'), 1200, 0, 10000),
      alignedMaxRatioDelta: toNumber(get('TIMING_EVIDENCE_ALIGNED_MAX_RATIO_DELTA'), 0.003, 0, 0.05),
    },
"""
if 'timingEvidence:' not in text:
    text = replace_once(text, anchor, insert, 'timing evidence config')
write(path, text)

# Add reusable timing profiles without changing the existing delivery-time deriveReferenceSyncPlan behavior.
path = 'src/utils/referenceSync.js'
text = read(path)
marker = 'export function buildTimingProfile('
if marker not in text:
    before = "export function deriveReferenceSyncPlan(sourceText, referenceText, options = {}) {"
    profile_code = """function timingProfileCues(profile = {}) {
  return Array.isArray(profile.cues)
    ? profile.cues
      .map(cue => ({
        start: Number(cue.start),
        end: Number(cue.end),
        mid: Number(cue.mid ?? (Number(cue.start) + Number(cue.end)) / 2),
      }))
      .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    : [];
}

export function buildTimingProfile(text = '', maxCues = 192) {
  const cues = parseCueTimes(text);
  const sampled = sampleCueSequence(cues, Math.max(32, Number(maxCues) || 192)).map(item => item.cue);
  return {
    cueCount: cues.length,
    startMs: cues[0]?.start || 0,
    endMs: cues.at(-1)?.end || 0,
    durationMs: cues.length ? cues.at(-1).end - cues[0].start : 0,
    cues: sampled.map(cue => ({ start: cue.start, end: cue.end, mid: cue.mid })),
  };
}

export function deriveReferenceSyncPlanFromProfiles(sourceProfile = {}, referenceProfile = {}, options = {}) {
  const sourceCues = timingProfileCues(sourceProfile);
  const referenceCues = timingProfileCues(referenceProfile);
  const sourceCueCount = Number(sourceProfile.cueCount || sourceCues.length);
  const referenceCueCount = Number(referenceProfile.cueCount || referenceCues.length);
  const minCues = Number(options.minCues ?? 8);
  if (sourceCueCount < minCues || referenceCueCount < minCues || sourceCues.length < 4 || referenceCues.length < 4) {
    return {
      enabled: false,
      type: 'reference-piecewise',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:not-enough-cues:${sourceCueCount}/${referenceCueCount}`],
      sourceCueCount,
      referenceCueCount,
    };
  }
  const cueRatio = Math.min(sourceCueCount, referenceCueCount) / Math.max(sourceCueCount, referenceCueCount);
  if (cueRatio < Number(options.minCueRatio ?? 0.55)) {
    return {
      enabled: false,
      type: 'reference-piecewise',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:cue-ratio-low:${cueRatio.toFixed(2)}`],
      sourceCueCount,
      referenceCueCount,
      cueRatio: Number(cueRatio.toFixed(3)),
    };
  }
  const temporalAnchors = buildTemporalAnchors(sourceCues, referenceCues, options.maxAnchors ?? 48);
  const candidates = [evaluateAnchorPlan(temporalAnchors, sourceCues, referenceCues, options, 'temporal')];
  if (options.dtwEnabled !== false) {
    const dtwAnchors = buildDtwAnchors(sourceCues, referenceCues, {
      maxCues: options.dtwMaxCues ?? 192,
      maxAnchors: options.maxAnchors ?? 48,
      bandRatio: options.dtwBandRatio ?? 0.18,
      gapPenalty: options.dtwGapPenalty ?? 0.42,
      maxMatchCost: options.dtwMaxMatchCost ?? 0.52,
    });
    candidates.push(evaluateAnchorPlan(dtwAnchors, sourceCues, referenceCues, options, 'dtw'));
  }
  const selected = candidates.reduce((best, candidate) => (
    candidateScore(candidate) > candidateScore(best) ? candidate : best
  ));
  return {
    ...selected,
    sourceCueCount,
    referenceCueCount,
    cueRatio: Number(cueRatio.toFixed(3)),
  };
}

"""
    text = replace_once(text, before, profile_code + before, 'reference timing profile insertion')
write(path, text)

# Preflight now emits bounded timing profiles for Arabic candidates and exact-hash references.
path = 'src/utils/encodingProxy.js'
text = read(path)
text = replace_once(
    text,
    "import { deriveReferenceSyncPlan } from './referenceSync.js';",
    "import { buildTimingProfile, deriveReferenceSyncPlan } from './referenceSync.js';",
    'encoding proxy referenceSync import',
)
old_return = """  return {
    quality,
    encoding: processed.encoding,
    format: processed.format,
    archive: extracted.archive || null,
    archiveEntry: extracted.entryName || null,
  };
}

async function loadProcessedSource"""
new_return = """  return {
    quality,
    timingProfile: buildTimingProfile(processed.text, config.timingEvidence.maxCues),
    encoding: processed.encoding,
    format: processed.format,
    archive: extracted.archive || null,
    archiveEntry: extracted.entryName || null,
  };
}

export async function preflightTimingReferenceCandidate(item, {
  fetcher = fetchRemoteSubtitleBuffer,
  providerLinkResolver = defaultProviderLinkResolver,
  signal,
} = {}) {
  const source = preflightSourceForItem(item);
  const boundFetcher = (url, options = {}) => fetcher(url, { ...options, signal });
  const buffer = await fetchSourceBuffer(source, boundFetcher, providerLinkResolver);
  const extracted = await extractSubtitlePayload(buffer, {
    maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
    maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
    sourceName: source.name,
  });
  const processed = processSubtitleBuffer(extracted.buffer, {
    stripSdh: true,
    stripMusicNotes: config.encodingProxy.stripMusicNotes,
    sourceName: extracted.entryName || source.name,
  });
  assertValidProcessedSubtitle(processed.text);
  return {
    timingProfile: buildTimingProfile(processed.text, config.timingEvidence.maxCues),
    encoding: processed.encoding,
    format: processed.format,
    archive: extracted.archive || null,
    archiveEntry: extracted.entryName || null,
  };
}

async function loadProcessedSource"""
if 'preflightTimingReferenceCandidate' not in text:
    text = replace_once(text, old_return, new_return, 'encoding timing preflight')
write(path, text)

# Accuracy preflight becomes the measured-timing selection stage when exact-hash reference evidence exists.
path = 'src/services/accuracyPreflight.js'
text = read(path)
text = replace_once(
    text,
    "import { preflightSubtitleCandidate } from '../utils/encodingProxy.js';",
    "import { preflightSubtitleCandidate, preflightTimingReferenceCandidate } from '../utils/encodingProxy.js';\nimport { deriveReferenceSyncPlanFromProfiles } from '../utils/referenceSync.js';",
    'accuracy imports',
)
text = replace_once(
    text,
    "    archiveEntry: raw.archiveEntry || null,\n    elapsedMs:",
    "    archiveEntry: raw.archiveEntry || null,\n    timingProfile: raw.timingProfile || null,\n    elapsedMs:",
    'normalize timing profile',
)
helper_anchor = "async function inspectOne(item, search, {"
helper_code = """function exactTimingReference(item = {}) {
  const reference = item?.referenceSubtitle;
  if (!reference || item?.timingReferenceEvidence?.exactVideoHash !== true) return null;
  return { ...reference, exactVideoHash: true };
}

"""
if 'function exactTimingReference' not in text:
    text = replace_once(text, helper_anchor, helper_code + helper_anchor, 'exact timing reference helper')
text = replace_once(
    text,
    "  if (item?.quality?.valid === true) {",
    "  if (item?.quality?.valid === true && !exactTimingReference(item)) {",
    'preflight existing quality timing bypass',
)
text = replace_once(
    text,
    "  const timeoutMs = config.accuracyPreflight.timeoutMs;",
    "  const timeoutMs = exactTimingReference(item) ? config.timingEvidence.timeoutMs : config.accuracyPreflight.timeoutMs;",
    'timing preflight timeout',
)
insert_anchor = "export async function applyAccuracyPreflight(results = [], search = {}, {"
extra = """function timingReferenceKey(reference = {}) {
  const payload = JSON.stringify({
    provider: reference.provider || '',
    providerId: reference.providerId || reference.fileId || reference.id || '',
    release: reference.releaseName || reference.fileName || reference.name || '',
    policyVersion: config.app.version,
  });
  return `timing-reference:${createHash('sha256').update(payload).digest('hex')}`;
}

async function inspectTimingReference(reference, { referencePreflightImpl, cacheGetImpl, cacheSetImpl } = {}) {
  if (!reference?.exactVideoHash) return null;
  const key = timingReferenceKey(reference);
  const cached = await cacheGetImpl(key);
  if (cached?.timingProfile) return { ...cached, source: 'shared-cache' };
  const started = Date.now();
  try {
    const signal = AbortSignal.timeout(config.timingEvidence.timeoutMs);
    const result = await referencePreflightImpl(reference, { signal });
    if (!result?.timingProfile) return null;
    const outcome = { timingProfile: result.timingProfile, elapsedMs: Date.now() - started };
    await cacheSetImpl(key, outcome, config.timingEvidence.cacheTtlSeconds, config.cache.staleSeconds);
    return { ...outcome, source: 'live-reference' };
  } catch {
    return null;
  }
}

function measuredTimingEvidence(plan = {}) {
  const agreement = Number(plan.temporalAgreement || 0);
  const coverage = Number(plan.anchorCoverage || 0);
  const cueRatio = Number(plan.cueRatio || 0);
  const confidence = Number(plan.confidence || 0);
  const residualMedianMs = Number(plan.residualMedianMs ?? Number.POSITIVE_INFINITY);
  const residualP90Ms = Number(plan.residualP90Ms ?? Number.POSITIVE_INFINITY);
  const offsetMs = Number(plan.offsetMs || 0);
  const ratio = Number(plan.ratio || 1);
  const ratioDelta = Math.abs(ratio - 1);
  const cfg = config.timingEvidence;
  const structurallyCompatible = Number(plan.sourceCueCount || 0) >= cfg.minCues
    && Number(plan.referenceCueCount || 0) >= cfg.minCues
    && cueRatio >= cfg.minCueRatio
    && agreement >= cfg.minTemporalAgreement
    && coverage >= cfg.minAnchorCoverage
    && residualMedianMs <= cfg.maxResidualMedianMs
    && residualP90Ms <= cfg.maxResidualP90Ms;
  const aligned = structurallyCompatible
    && Math.abs(offsetMs) <= cfg.alignedMaxOffsetMs
    && ratioDelta <= cfg.alignedMaxRatioDelta;
  const verdict = aligned ? 'aligned' : (structurallyCompatible ? 'repairable' : 'incompatible');
  const structuralScore = Math.round(
    agreement * 3500 + coverage * 2500 + cueRatio * 1500 + confidence * 15
    - Math.min(1200, Math.abs(offsetMs) / 50)
    - Math.min(1200, ratioDelta * 30000),
  );
  const classBase = verdict === 'aligned' ? 30000 : verdict === 'repairable' ? 15000 : 0;
  return {
    measured: true,
    exactVideoHash: true,
    verdict,
    rankScore: Math.max(0, classBase + structuralScore),
    confidence,
    temporalAgreement: agreement,
    anchorCoverage: coverage,
    cueRatio,
    residualMedianMs: Number.isFinite(residualMedianMs) ? residualMedianMs : null,
    residualP90Ms: Number.isFinite(residualP90Ms) ? residualP90Ms : null,
    offsetMs,
    ratio,
    strategy: plan.strategy || null,
  };
}

"""
if 'function measuredTimingEvidence' not in text:
    text = replace_once(text, insert_anchor, extra + insert_anchor, 'measured timing helpers')
text = replace_once(
    text,
    "  preflightImpl = preflightSubtitleCandidate,\n  cacheGetImpl = cacheGet,",
    "  preflightImpl = preflightSubtitleCandidate,\n  referencePreflightImpl = preflightTimingReferenceCandidate,\n  cacheGetImpl = cacheGet,",
    'reference preflight dependency',
)
old_targets = """  const inspected = new Map();
  const targets = ranked.slice(0, config.accuracyPreflight.topN);
"""
new_targets = """  const inspected = new Map();
  const exactHashTimingAvailable = config.timingEvidence.enabled
    && ranked.some(item => exactTimingReference(item));
  const timingTargetCount = exactHashTimingAvailable
    ? Math.min(config.timingEvidence.topN, ranked.length)
    : 0;
  const targetCount = Math.max(config.accuracyPreflight.topN, timingTargetCount);
  const targets = ranked.slice(0, Math.min(targetCount, ranked.length));
"""
text = replace_once(text, old_targets, new_targets, 'expanded measured timing targets')
post_inspection_anchor = """  await Promise.all(targets.map(async item => {
    const key = candidateKey(item, search);
    const outcome = await inspectOne(item, search, { preflightImpl, cacheGetImpl, cacheSetImpl });
    inspected.set(key, outcome);
  }));

  const decorated = ranked.map(item => {
"""
post_inspection_new = """  await Promise.all(targets.map(async item => {
    const key = candidateKey(item, search);
    const outcome = await inspectOne(item, search, { preflightImpl, cacheGetImpl, cacheSetImpl });
    inspected.set(key, outcome);
  }));

  const exactReference = config.timingEvidence.enabled
    ? targets.map(item => exactTimingReference(item)).find(Boolean)
    : null;
  const referenceOutcome = exactReference
    ? await inspectTimingReference(exactReference, { referencePreflightImpl, cacheGetImpl, cacheSetImpl })
    : null;

  const decorated = ranked.map(item => {
"""
text = replace_once(text, post_inspection_anchor, post_inspection_new, 'reference profile inspection')
old_decorate = """    const measuredQuality = outcome.quality
      ? { ...(item.quality || {}), ...outcome.quality }
      : item.quality;
    return {
      ...item,
      ...(measuredQuality ? { quality: measuredQuality, qualityScore: measuredQuality.score } : {}),
      accuracyPreflight: outcome,
    };
"""
new_decorate = """    const measuredQuality = outcome.quality
      ? { ...(item.quality || {}), ...outcome.quality }
      : item.quality;
    let timing = null;
    if (
      config.timingEvidence.enabled
      && exactTimingReference(item)
      && outcome?.timingProfile
      && referenceOutcome?.timingProfile
    ) {
      const plan = deriveReferenceSyncPlanFromProfiles(outcome.timingProfile, referenceOutcome.timingProfile, {
        minCues: 4,
        minCueRatio: 0,
        minConfidence: 0,
        minTemporalAgreement: 0,
        minAnchorCoverage: 0,
        maxAnchors: 48,
        piecewise: true,
        dtwEnabled: true,
        dtwMaxCues: config.timingEvidence.maxCues,
      });
      timing = measuredTimingEvidence(plan);
    }
    return {
      ...item,
      ...(measuredQuality ? { quality: measuredQuality, qualityScore: measuredQuality.score } : {}),
      ...(timing ? { actualTimingEvidence: timing } : {}),
      accuracyPreflight: outcome,
    };
"""
text = replace_once(text, old_decorate, new_decorate, 'timing evidence decoration')
write(path, text)

# Actual cue timing outranks metadata guesses, while unknown remains above a proven incompatible cut.
path = 'src/utils/accuracyFirst.js'
text = read(path)
function_anchor = """function timingReferenceRank(item) {
  const evidence = item?.timingReferenceEvidence;
  if (!evidence?.exactVideoHash) return 0;
  const score = Number(evidence.matchScore || 0);
  return Math.max(0, Math.min(10_000, Number.isFinite(score) ? score : 0));
}

"""
function_new = function_anchor + """function actualTimingRank(item) {
  const evidence = item?.actualTimingEvidence;
  if (!evidence?.measured || !evidence?.exactVideoHash) return { classRank: 1, score: 0 };
  const classRank = evidence.verdict === 'aligned' ? 4 : evidence.verdict === 'repairable' ? 3 : 0;
  const score = Number(evidence.rankScore || 0);
  return { classRank, score: Number.isFinite(score) ? score : 0 };
}

"""
if 'function actualTimingRank' not in text:
    text = replace_once(text, function_anchor, function_new, 'actual timing rank helper')
compare_anchor = """    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    // An English subtitle returned for the exact video hash describes the actual playback
"""
compare_new = """    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    // Positive cue-timeline proof beats unknown metadata; an unknown candidate still beats a
    // candidate proven structurally incompatible. This keeps failures fail-open without ignoring proof.
    const aActualTiming = actualTimingRank(a);
    const bActualTiming = actualTimingRank(b);
    const actualClassDelta = bActualTiming.classRank - aActualTiming.classRank;
    if (actualClassDelta) return actualClassDelta;
    if (aActualTiming.classRank !== 1) {
      const actualScoreDelta = bActualTiming.score - aActualTiming.score;
      if (actualScoreDelta) return actualScoreDelta;
    }

    // An English subtitle returned for the exact video hash describes the actual playback
"""
text = replace_once(text, compare_anchor, compare_new, 'actual timing comparator')
text = replace_once(
    text,
    "  if (evidenceRank(item) > 0 || timingReferenceRank(item) > 0) return true;",
    "  const actual = item?.actualTimingEvidence;\n  if (evidenceRank(item) > 0 || actual?.verdict === 'aligned' || actual?.verdict === 'repairable' || timingReferenceRank(item) > 0) return true;",
    'strong timing evidence',
)
write(path, text)

# Regression coverage: real timeline evidence must rescue the correct candidate even from slot 10.
path = ROOT / 'src/tests/actualTimingEvidence.test.js'
path.write_text(r'''import test from 'node:test';
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
''', encoding='utf-8')

# Documentation.
path = 'CHANGELOG.md'
text = read(path)
entry = """## 4.6.0 - 2026-09-07

- Rank Arabic subtitles by measured cue-timeline compatibility when an English reference is proven by the exact video hash.
- Measure every candidate in the configured timing-evidence window (default 10), so a correct subtitle cannot be lost merely because metadata ranked it lower initially.
- Classify measured candidates as aligned, repairable, or incompatible using DTW/temporal anchors, cue ratio, coverage, and residuals.
- Keep exact Arabic hash authority and hard identity conflicts above timing evidence; keep transient preflight/reference failures fail-open.
- Preserve v4.5.0 exact-hash delivery sync as the correction stage after measured selection rather than replacing it.

"""
if not text.startswith('## 4.6.0'):
    text = entry + text
write(path, text)

path = 'README.md'
text = read(path)
text = re.sub(r'^# m7md Arabic Resolver v[^\n]+', '# m7md Arabic Resolver v4.6.0', text, count=1)
section = """## ما الجديد في 4.6.0

- **Measured Timing Selection**: عند توفر Reference إنجليزي مطابق لـ`videoHash`، تُقاس بنية توقيت الترجمات العربية نفسها قبل ترتيبها، بدل الاعتماد على اسم BluRay/WEB فقط.
- يفحص المحرك افتراضيًا حتى **10 مرشحين** قابلين للعرض، لذلك يمكن لترجمة صحيحة موجودة أسفل الترتيب النصي أن تصعد إلى المركز الأول.
- التصنيف الزمني أصبح: `aligned` ثم `repairable` ثم المرشح غير المقاس ثم `incompatible`، مع بقاء Exact Arabic Hash أعلى الجميع.
- يستخدم القياس DTW + Temporal Anchors + Cue Ratio + Coverage + Residuals، بينما فشل المرجع أو Preflight يبقى Fail-Open ولا يخفي العربية.
- إصلاح v4.5.0 للتزامن الآمن يبقى مرحلة التسليم: نختار أولًا أفضل Timeline مقاس، ثم نصحح فقط إذا احتاج وبشروط الثقة الصارمة الموجودة أصلًا.

"""
if '## ما الجديد في 4.6.0' not in text:
    anchor = '## ما الجديد في 4.5.0'
    text = replace_once(text, anchor, section + anchor, 'README 4.6 section')
write(path, text)

print('v4.6.0 measured timing selection prepared')
