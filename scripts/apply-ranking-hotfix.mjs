import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing expected block: ${label}`);
  return text.replace(oldText, newText);
}

let scoring = readFileSync('src/utils/scoring.js', 'utf8');
const replacements = [
  ["  if (overlap >= 0.75) add(360, 'release-token-exactish');\n  else if (overlap >= 0.55) add(250, 'release-token-high');\n  else if (overlap >= 0.35) add(130, 'release-token-medium');\n  else if (overlap >= 0.18) add(45, 'release-token-low');", "  if (overlap >= 0.75) add(100, 'release-token-exactish');\n  else if (overlap >= 0.55) add(70, 'release-token-high');\n  else if (overlap >= 0.35) add(35, 'release-token-medium');\n  else if (overlap >= 0.18) add(10, 'release-token-low');", 'token overlap weights'],
  ["    if (target.quality === release.quality) add(220, 'quality-match');\n    else add(-260, 'quality-mismatch');", "    if (target.quality === release.quality) add(18, 'quality-match');\n    else add(-2, 'quality-different');", 'quality signal'],
  ["    if (target.source === release.source) add(260, 'source-match');\n    else add(-360, 'source-mismatch');", "    if (target.source === release.source) add(25, 'source-match');\n    else add(-5, 'source-different');", 'source signal'],
  ["    if (target.codecFamily === release.codecFamily) add(90, 'codec-match');\n    else add(-110, 'codec-mismatch');", "    if (target.codecFamily === release.codecFamily) add(8, 'codec-match');\n    else add(0, 'codec-different');", 'codec signal'],
  ["    if (target.releaseGroup === release.releaseGroup) add(340, 'release-group-match');\n    else add(-230, 'release-group-mismatch');", "    if (target.releaseGroup === release.releaseGroup) add(30, 'release-group-match');\n    else add(0, 'release-group-different');", 'group signal'],
  ["    if (target.hdr === release.hdr) add(55, 'hdr-match');\n    else add(-70, 'hdr-mismatch');", "    if (target.hdr === release.hdr) add(5, 'hdr-match');\n    else add(0, 'hdr-different');", 'hdr signal'],
  ["    if (target.service === release.service) add(170, 'streaming-service-match');\n    else add(-260, 'streaming-service-mismatch');", "    if (target.service === release.service) add(15, 'streaming-service-match');\n    else add(-3, 'streaming-service-different');", 'service signal'],
  ["    if (target.bitDepth === release.bitDepth) add(45, 'bit-depth-match');\n    else add(-45, 'bit-depth-mismatch');", "    if (target.bitDepth === release.bitDepth) add(4, 'bit-depth-match');\n    else add(0, 'bit-depth-different');", 'bit depth signal'],
  ["    if (target.audioCodec === release.audioCodec) add(65, 'audio-codec-match');\n    else add(-55, 'audio-codec-mismatch');", "    if (target.audioCodec === release.audioCodec) add(5, 'audio-codec-match');\n    else add(0, 'audio-codec-different');", 'audio codec signal'],
  ["    if (target.audioChannels === release.audioChannels) add(45, 'audio-channels-match');\n    else add(-40, 'audio-channels-mismatch');", "    if (target.audioChannels === release.audioChannels) add(4, 'audio-channels-match');\n    else add(0, 'audio-channels-different');", 'audio channels signal'],
  ["    if (target.audioProfile === release.audioProfile) add(35, 'audio-profile-match');\n    else add(-30, 'audio-profile-mismatch');", "    if (target.audioProfile === release.audioProfile) add(3, 'audio-profile-match');\n    else add(0, 'audio-profile-different');", 'audio profile signal'],
  ["    if (target.edition === release.edition) add(380, 'edition-match');\n    else add(-520, 'edition-mismatch');\n  } else if (target.edition && !release.edition) {\n    add(-420, 'edition-missing');\n  } else if (!target.edition && release.edition && release.edition !== 'theatrical') {\n    add(-260, 'unexpected-special-edition');", "    if (target.edition === release.edition) add(90, 'edition-match');\n    else add(-120, 'edition-mismatch');\n  } else if (target.edition && !release.edition) {\n    add(-60, 'edition-missing');\n  } else if (!target.edition && release.edition && release.edition !== 'theatrical') {\n    add(-80, 'unexpected-special-edition');", 'edition signal'],
  ["    if (Math.abs(target.fps - release.fps) <= 0.02) add(130, 'fps-match');\n    else add(-180, 'fps-mismatch');", "    if (Math.abs(target.fps - release.fps) <= 0.02) add(20, 'fps-match');\n    else add(-30, 'fps-mismatch');", 'fps signal'],
  ["  if (releaseMatch.exactFingerprint) add(520, 'exact-release-fingerprint');\n  else if (releaseMatch.similarity >= 0.9) add(90, 'deterministic-filename-similarity');\n  else if (releaseMatch.similarity >= 0.78) add(45, 'deterministic-filename-similarity');", "  if (releaseMatch.exactFingerprint) add(100, 'exact-release-name-fingerprint');\n  else if (releaseMatch.similarity >= 0.9) add(35, 'deterministic-filename-similarity');\n  else if (releaseMatch.similarity >= 0.78) add(15, 'deterministic-filename-similarity');", 'filename signal'],
];
for (const [oldText, newText, label] of replacements) scoring = replaceRequired(scoring, oldText, newText, label);

const helperMarker = 'export function rankAndFilter(results, search = {}, config = {}) {';
const helpers = `function evidenceRank(item) {
  const reasons = item.scoreReasons || [];
  if (item.sourceType === 'personal-vault-exact-hash' || item.sourceType === 'version-registry-exact-hash') return 3;
  if (reasons.some(reason => reason.reason === 'exact-video-hash-match')) return 3;
  if (reasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) return 2;
  return 0;
}

function releaseFamilyKey(item) {
  const release = item.parsedRelease || {};
  const fps = Number.isFinite(Number(release.fps)) ? Number(release.fps).toFixed(3) : '';
  const fields = [release.source, release.edition, release.releaseGroup, release.quality, fps]
    .map(value => lower(value))
    .filter(Boolean);
  return fields.length ? fields.join(':') : \`provider:\${lower(item.provider || 'unknown')}\`;
}

function diversifyPlausibleAlternatives(items, scoreWindow = 240) {
  const output = [];
  let cursor = 0;
  while (cursor < items.length) {
    const anchor = items[cursor];
    const anchorEvidence = evidenceRank(anchor);
    const band = [];
    while (
      cursor < items.length
      && evidenceRank(items[cursor]) === anchorEvidence
      && items[cursor].score >= anchor.score - scoreWindow
    ) {
      band.push(items[cursor]);
      cursor += 1;
    }
    const seenFamilies = new Set();
    for (const item of band) {
      const family = releaseFamilyKey(item);
      if (seenFamilies.has(family)) continue;
      seenFamilies.add(family);
      output.push(item);
    }
    for (const item of band) if (!output.includes(item)) output.push(item);
  }
  return output;
}

`;
scoring = replaceRequired(scoring, helperMarker, helpers + helperMarker, 'ranking helpers');
const oldSort = `  ranked.sort((a, b) => {
    const aHash = a.scoreReasons?.some(r => r.reason.includes('hash')) ? 1 : 0;
    const bHash = b.scoreReasons?.some(r => r.reason.includes('hash')) ? 1 : 0;
    if (aHash !== bHash) return bHash - aHash;
    const useReleasePriority = (a.releaseMatch?.targetFields || b.releaseMatch?.targetFields || 0) > 0;
    if (useReleasePriority) {
      if (a.releaseMatchTier !== b.releaseMatchTier) return b.releaseMatchTier - a.releaseMatchTier;
      if (a.releaseMatch?.priority !== b.releaseMatch?.priority) {
        return (b.releaseMatch?.priority || 0) - (a.releaseMatch?.priority || 0);
      }
    }
    if ((b.provider === 'vault') !== (a.provider === 'vault')) return b.provider === 'vault' ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(b.trusted) !== Boolean(a.trusted)) return b.trusted ? 1 : -1;
    const downloadDelta = Number(b.downloads || b.downloadCount || 0) - Number(a.downloads || a.downloadCount || 0);
    if (downloadDelta) return downloadDelta;
    return \`\${a.provider || ''}:\${a.id || a.providerId || ''}\`.localeCompare(\`\${b.provider || ''}:\${b.id || b.providerId || ''}\`);
  });`;
const newSort = `  ranked.sort((a, b) => {
    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(b.trusted) !== Boolean(a.trusted)) return b.trusted ? 1 : -1;
    if ((b.provider === 'vault') !== (a.provider === 'vault')) return b.provider === 'vault' ? 1 : -1;
    if (a.releaseMatch?.priority !== b.releaseMatch?.priority) {
      return (b.releaseMatch?.priority || 0) - (a.releaseMatch?.priority || 0);
    }
    const downloadDelta = Number(b.downloads || b.downloadCount || 0) - Number(a.downloads || a.downloadCount || 0);
    if (downloadDelta) return downloadDelta;
    return \`\${a.provider || ''}:\${a.id || a.providerId || ''}\`.localeCompare(\`\${b.provider || ''}:\${b.id || b.providerId || ''}\`);
  });`;
scoring = replaceRequired(scoring, oldSort, newSort, 'sort order');
scoring = replaceRequired(scoring, '  return deduped;\n}', '  return diversifyPlausibleAlternatives(deduped);\n}', 'diversified return');
writeFileSync('src/utils/scoring.js', scoring);

let stremio = readFileSync('src/utils/stremio.js', 'utf8');
stremio = replaceRequired(stremio, "  if (item.releaseMatchTier >= 5) badges.push('🎯 Exact Release');\n  else if (item.releaseMatchTier >= 3) badges.push('✅ Release Match');", "  if (item.releaseMatchTier >= 5) badges.push('🎯 Strong Name Match');\n  else if (item.releaseMatchTier >= 3) badges.push('✅ Name Match');", 'release badges');
writeFileSync('src/utils/stremio.js', stremio);

let tests = readFileSync('src/tests/scoring.test.js', 'utf8');
tests = replaceRequired(tests, "test('rankAndFilter puts the matching video release first even when another provider has higher priority', () => {", "test('rankAndFilter does not let a release-name match override a stronger personal result', () => {", 'vault test name');
tests = replaceRequired(tests, "  assert.equal(ranked[0].provider, 'yify');\n  assert.ok(ranked[0].releaseMatchTier >= 5);", "  assert.equal(ranked[0].provider, 'vault');\n  assert.ok(ranked[1].releaseMatchTier >= 5);", 'vault assertions');
tests = replaceRequired(tests, "test('rankAndFilter keeps the exact extended cut ahead of a higher-priority normal release', () => {", "test('rankAndFilter keeps edition evidence secondary to a saved personal result', () => {", 'edition test name');
tests = replaceRequired(tests, "  assert.equal(ranked[0].provider, 'yify');\n  assert.ok(ranked[0].releaseMatch.matched.includes('edition'));\n  assert.ok(ranked[0].releaseMatchTier >= 5);\n  assert.equal(ranked[1].releaseMatchTier, 1);", "  assert.equal(ranked[0].provider, 'vault');\n  assert.ok(ranked[1].releaseMatch.matched.includes('edition'));\n  assert.ok(ranked[1].releaseMatchTier >= 5);\n  assert.equal(ranked[0].releaseMatchTier, 1);", 'edition assertions');
tests += `

test('rankAndFilter keeps an exact video hash first even when its release label differs', () => {
  const ranked = rankAndFilter([
    { provider: 'yify', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', movieHash: 'abc123', download: 'https://example.com/hash.srt' },
    { provider: 'opensubtitles', lang: 'ara', releaseName: 'Movie.2160p.BluRay-OTHER', trusted: true, qualityScore: 100, download: 'https://example.com/name.srt' },
  ], { filename: 'Movie.2160p.BluRay-OTHER.mkv', videoHash: 'abc123' }, { outputArabicOnly: true, minRankScore: -1000 });
  assert.equal(ranked[0].movieHash, 'abc123');
  assert.ok(ranked[0].scoreReasons.some(reason => reason.reason === 'exact-video-hash-match'));
});

test('rankAndFilter surfaces plausible alternatives before repeated release families', () => {
  const ranked = rankAndFilter([
    { provider: 'opensubtitles', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/a.srt' },
    { provider: 'subdl', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/b.srt' },
    { provider: 'subsource', lang: 'ara', releaseName: 'Movie.1080p.WEB-DL-GROUP', trusted: true, download: 'https://example.com/c.srt' },
    { provider: 'yify', lang: 'ara', releaseName: 'Movie.1080p.BluRay-OTHER', trusted: true, qualityScore: 80, download: 'https://example.com/d.srt' },
  ], { filename: 'Movie.1080p.WEB-DL-GROUP.mkv' }, { outputArabicOnly: true, minRankScore: -1000, maxReturnedPerRelease: 1 });
  assert.equal(ranked[0].provider, 'opensubtitles');
  assert.equal(ranked[1].parsedRelease.source, 'bluray');
});
`;
writeFileSync('src/tests/scoring.test.js', tests);
