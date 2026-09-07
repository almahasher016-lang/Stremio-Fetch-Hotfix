from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

path = 'src/services/accuracyPreflight.js'
text = read(path)
old = "  const inspected = new Map();\n  const targets = ranked.slice(0, config.accuracyPreflight.topN);\n"
new = """  const inspected = new Map();
  // When we have a timing reference proven to belong to this exact video hash,
  // measure every candidate that can actually be surfaced to the user (normally TOP_N=10).
  // Without exact-hash evidence, retain the bounded quality-preflight window.
  const exactHashTimingAvailable = config.timingEvidence.enabled
    && ranked.some(item => item?.exactTimingReference?.exactVideoHash);
  const timingTargetCount = exactHashTimingAvailable
    ? Math.min(Number(config.providers.topN || 10), 10)
    : 0;
  const targetCount = Math.max(config.accuracyPreflight.topN, timingTargetCount);
  const targets = ranked.slice(0, Math.min(targetCount, ranked.length));
"""
text = replace_once(text, old, new, 'timing target pool')
write(path, text)

path = 'src/tests/actualTimingEvidence.test.js'
text = read(path)
marker = "timing evidence rescues an aligned candidate from the tenth visible slot"
if marker not in text:
    text += r'''

test('timing evidence rescues an aligned candidate from the tenth visible slot', async () => {
  const shiftedProfile = buildTimingProfile(srt(baseStarts.map(v => v + 8500)));
  const alignedProfile = buildTimingProfile(srt(baseStarts));
  const candidates = Array.from({ length: 10 }, (_, index) => {
    const aligned = index === 9;
    const id = aligned ? 'aligned-tenth' : `shifted-${index}`;
    return {
      ...candidate('shifted', 1000 - index * 35),
      id,
      providerId: String(300 + index),
      fileId: String(300 + index),
      download: `/downloads/opensubtitles/${300 + index}.srt`,
      releaseName: `Movie.2026.2160p.BluRay.${id}`,
      exactTimingReference: reference,
    };
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
'''
write(path, text)

print('v4.5.0 full visible timing pool finalized')
