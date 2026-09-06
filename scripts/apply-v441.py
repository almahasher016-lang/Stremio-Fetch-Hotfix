from pathlib import Path
import json

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# Core: preserve a richer prior candidate pool when a provider cycle returns only a partial list.
path = 'src/services/subtitleServiceCore.js'
text = read(path)
anchor = '''export function mergeResults(...groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of group || []) {
      if (
        config.providers.excludeMachineTranslated
        && (item.machineTranslated || item.automatedTranslated || item.autoTranslated)
      ) {
        continue;
      }
      const key = item.download || `${item.provider}:${item.providerId || item.id}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
  }
  return output;
}
'''
replacement = anchor + '''

export function preserveAccurateCandidates(search, ...groups) {
  return prioritizeAndLimitAccurateSubtitles(
    mergeResults(...groups),
    search,
    config.providers.topN,
  );
}
'''
text = replace_once(text, anchor, replacement, 'preserve candidates helper')

old_refresh = '''      const fresh = await buildFreshSubtitles(search);
      if (Array.isArray(fresh) && fresh.length > 0) {
        await cacheSet(key, fresh, config.cache.searchTtlSeconds, config.cache.staleSeconds);
      }
'''
new_refresh = '''      const fresh = await buildFreshSubtitles(search);
      if (Array.isArray(fresh) && fresh.length > 0) {
        const existing = await cacheGetEntry(key, { allowStale: true, preferShared: true });
        const preserved = existing?.hit && hasUsableSubtitleResults(existing.value)
          ? preserveAccurateCandidates(search, fresh, existing.value)
          : preserveAccurateCandidates(search, fresh);
        await cacheSet(key, preserved, config.cache.searchTtlSeconds, config.cache.staleSeconds);
      }
'''
text = replace_once(text, old_refresh, new_refresh, 'background partial preservation')

old_fresh = '''  const ranked = await buildFreshSubtitles(identity);
  if (hasUsableSubtitleResults(ranked)) {
    await cacheSet(key, ranked, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    return ranked;
  }
'''
new_fresh = '''  const ranked = await buildFreshSubtitles(identity);
  if (hasUsableSubtitleResults(ranked)) {
    // A degraded provider cycle can return one usable candidate while several better candidates
    // temporarily disappear. Preserve the prior non-empty pool, then re-rank with current rules.
    const preserved = cachedGood
      ? preserveAccurateCandidates(identity, ranked, cachedGood)
      : preserveAccurateCandidates(identity, ranked);
    await cacheSet(key, preserved, config.cache.searchTtlSeconds, config.cache.staleSeconds);
    return preserved;
  }
'''
text = replace_once(text, old_fresh, new_fresh, 'foreground partial preservation')
write(path, text)

# Final availability LKG: combine specific histories and never overwrite them with a narrower partial result.
path = 'src/services/subtitleService.js'
text = read(path)
start = text.index('async function readAvailabilityLkg(')
end = text.index('\nfunction singleflightKey', start)
new_lkg = '''async function readAvailabilityLkg(search) {
  const specific = [];
  const catalog = [];
  let allStale = true;
  for (const spec of availabilityKeySpecs(search)) {
    const cached = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    if (!cached?.hit || !usable(cached.value)) continue;
    allStale = allStale && Boolean(cached.stale);
    if (spec.kind === 'catalog') catalog.push(cached.value);
    else specific.push(cached.value);
  }
  const groups = specific.length ? specific : catalog;
  if (!groups.length) return null;
  const value = core.preserveAccurateCandidates(search, ...groups);
  return usable(value) ? {
    hit: true,
    stale: allStale,
    kind: specific.length ? 'specific' : 'catalog',
    value,
  } : null;
}

async function writeAvailabilityLkg(search, results) {
  if (!usable(results)) return;
  const writes = availabilityKeySpecs(search).map(async spec => {
    const current = await cacheGetEntry(spec.key, { allowStale: true, preferShared: true });
    const preserved = current?.hit && usable(current.value)
      ? core.preserveAccurateCandidates(search, results, current.value)
      : core.preserveAccurateCandidates(search, results);
    if (!usable(preserved)) return;
    await cacheSet(
      spec.key,
      preserved,
      config.cache.availabilityTtlSeconds,
      config.cache.availabilityStaleSeconds,
    );
  });
  await Promise.allSettled(writes);
}
'''
text = text[:start] + new_lkg + text[end:]
write(path, text)

# Version bump.
path = 'src/release.js'
text = read(path).replace("RELEASE_VERSION = '4.4.0'", "RELEASE_VERSION = '4.4.1'", 1)
write(path, text)

for filename in ['package.json', 'package-lock.json']:
    p = ROOT / filename
    data = json.loads(p.read_text(encoding='utf-8'))
    data['version'] = '4.4.1'
    if filename == 'package-lock.json' and isinstance(data.get('packages'), dict) and '' in data['packages']:
        data['packages']['']['version'] = '4.4.1'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Regression: a one-result degraded cycle cannot erase a richer timing-compatible pool.
test_path = 'src/tests/accuracyFirst.test.js'
test_text = read(test_path)
test_text += '''

test('partial provider results cannot erase a richer timing-compatible candidate pool', async () => {
  const { preserveAccurateCandidates } = await import('../services/subtitleServiceCore.js');
  const search = { filename: 'Show.S01E07.2160p.BluRay.REMUX-GRP.mkv' };
  const previous = [
    {
      id: 'bluray-good', provider: 'opensubtitles', releaseName: 'Show.S01E07.720p.BluRay.x264-BLOODY', score: 850,
      releaseMatch: releaseMatch({ tier: 2, priority: 19000, mismatched: ['quality', 'releaseGroup'] }), scoreReasons: [],
    },
    {
      id: 'web-old', provider: 'opensubtitles', releaseName: 'Show.S01E07.2160p.WEB-DL-GRP', score: 1400,
      releaseMatch: releaseMatch({ tier: 2, priority: 21000, mismatched: ['source'] }), scoreReasons: [],
    },
    {
      id: 'web-alt', provider: 'subdl', releaseName: 'Show.S01E07.1080p.WEBRip-GRP2', score: 900,
      releaseMatch: releaseMatch({ tier: 1, priority: 12000, mismatched: ['source', 'quality'] }), scoreReasons: [],
    },
  ];
  const degradedFresh = [{
    id: 'web-partial', provider: 'opensubtitles', releaseName: 'Show.S01E07.2160p.WEB-DL-PARTIAL', score: 1800,
    releaseMatch: releaseMatch({ tier: 2, priority: 22000, mismatched: ['source'] }), scoreReasons: [],
  }];
  const preserved = preserveAccurateCandidates(search, degradedFresh, previous);
  assert.ok(preserved.some(item => item.id === 'bluray-good'));
  assert.equal(preserved[0].id, 'bluray-good');
  assert.ok(preserved.length >= previous.length);
});

test('a newly discovered exact hash still outranks preserved older candidates', async () => {
  const { preserveAccurateCandidates } = await import('../services/subtitleServiceCore.js');
  const search = { filename: 'Movie.2026.2160p.BluRay.REMUX-GRP.mkv', videoHash: 'abcd1234' };
  const previous = [{
    id: 'old-family', provider: 'subdl', releaseName: 'Movie.2026.1080p.BluRay-GRP', score: 1500,
    releaseMatch: releaseMatch({ tier: 4, priority: 43000 }), scoreReasons: [],
  }];
  const fresh = [{
    id: 'new-hash', provider: 'opensubtitles', releaseName: 'Movie.2026.1080p.WEB-DL-OTHER', score: 400,
    releaseMatch: releaseMatch({ tier: 1, priority: 9000, mismatched: ['source'] }),
    scoreReasons: [{ reason: 'exact-video-hash-match', value: 1800 }],
  }];
  const preserved = preserveAccurateCandidates(search, fresh, previous);
  assert.equal(preserved[0].id, 'new-hash');
});
'''
write(test_path, test_text)

# Docs.
path = 'README.md'
text = read(path)
text = replace_once(text, '# m7md Arabic Resolver v4.4.0', '# m7md Arabic Resolver v4.4.1', 'README title')
marker = '## ما الجديد في 4.4.0\n'
notes = '''## ما الجديد في 4.4.1\n\n- منع `partial-result poisoning`: تعطل بعض المزودات لا يسمح لقائمة جزئية من نتيجة أو نتيجتين بمسح مجموعة مرشحين أفضل محفوظة سابقًا.\n- دمج نتائج البحث الجديدة مع آخر Candidate Pool صالح ثم إعادة ترتيبها بالقواعد الحالية قبل تحديث Redis.\n- تطبيق الحماية نفسها على background refresh وFinal Arabic LKG مع إبقاء Exact Hash أقوى دليل.\n\n'''
if '## ما الجديد في 4.4.1' not in text:
    text = replace_once(text, marker, notes + marker, 'README notes')
write(path, text)

path = 'CHANGELOG.md'
text = read(path)
entry = '''## 4.4.1 - 2026-09-06\n\n- Prevent partial non-empty provider cycles from replacing a richer cached timing-compatible candidate pool.\n- Merge fresh and previous candidates, then re-run current Accuracy-First ordering before Redis search-cache writes.\n- Preserve and re-rank prior candidates during background refresh and Final Arabic Last-Known-Good updates.\n- Keep newly discovered exact-video-hash evidence authoritative over preserved heuristic candidates.\n\n'''
if not text.startswith('## 4.4.1'):
    text = entry + text
write(path, text)

print('v4.4.1 patch applied')
