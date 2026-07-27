import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import {
  analyzeStyledSubtitle,
  normalizeStyledSubtitleBuffer,
  styledSubtitleFormatHint,
} from '../utils/styledSubtitle.js';
import { extractSubtitlePayload } from '../utils/subtitleArchive.js';
import { buildOpenSubtitlesDownloadBody } from '../providers/openSubtitles.js';
import { toStremioSubtitles } from '../utils/stremio.js';

const ASS_FIXTURE = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Arabic,Tahoma,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,40,40,55,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Arabic,,0,0,0,,{\\an8\\c&H00FF00&}مرحبا بكم
Dialogue: 0,0:00:04.00,0:00:06.00,Arabic,,0,0,0,,هذا سطر ثان\\Nمع سطر جديد
`;

test('styled ASS normalization preserves styles, positions, and line breaks', () => {
  const result = normalizeStyledSubtitleBuffer(Buffer.from(ASS_FIXTURE), {
    sourceName: 'Movie.Arabic.ass',
    expectedDurationMs: 7_000,
    qualityGate: { enabled: true, minCues: 2, minArabicRatio: 0.18, minCoverageRatio: 0.55 },
  });
  assert.equal(result.format, 'ass');
  assert.equal(result.quality.valid, true);
  assert.match(result.text, /\[V4\+ Styles]/);
  assert.match(result.text, /\{\\an8\\c&H00FF00&}/);
  assert.match(result.text, /\\N/);
  assert.match(result.text, /Style: Arabic,Tahoma/);
});

test('styled subtitle validation rejects non-Arabic or malformed scripts', () => {
  const english = ASS_FIXTURE
    .replaceAll('مرحبا بكم', 'hello')
    .replaceAll('هذا سطر ثان', 'another line')
    .replaceAll('مع سطر جديد', 'continued');
  const quality = analyzeStyledSubtitle(english, {
    qualityGate: { enabled: true, minCues: 2, minArabicRatio: 0.18, minCoverageRatio: 0 },
  });
  assert.equal(quality.valid, false);
  assert.ok(quality.reasons.includes('low-arabic-ratio'));
  assert.throws(
    () => normalizeStyledSubtitleBuffer(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n')),
    error => error?.status === 422,
  );
});

test('styled format hints are conservative and exclude normalized Vault text', () => {
  assert.equal(styledSubtitleFormatHint({ provider: 'subdl', fileName: 'Movie.Arabic.ass' }), 'ass');
  assert.equal(styledSubtitleFormatHint({ provider: 'subsource', format: 'SSA' }), 'ssa');
  assert.equal(styledSubtitleFormatHint({ provider: 'subdl', fileName: 'Movie.Arabic.ass.zip' }), 'ass');
  assert.equal(styledSubtitleFormatHint({ provider: 'vault', fileName: 'Movie.ass' }), null);
  assert.equal(styledSubtitleFormatHint({ provider: 'yify', fileName: 'Movie.srt' }), null);
});

test('archive extraction can target ASS/SSA while default extraction stays unchanged', async () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nمرحبا\n';
  const archive = Buffer.from(zipSync({
    'Movie.Arabic.srt': strToU8(srt),
    'Movie.Arabic.ass': strToU8(ASS_FIXTURE),
  }));
  const styled = await extractSubtitlePayload(archive, {
    sourceName: 'Movie.zip',
    allowedExtensions: ['ass', 'ssa'],
  });
  assert.equal(styled.entryName, 'Movie.Arabic.ass');
  assert.match(styled.buffer.toString('utf8'), /\[Events]/);

  const normal = await extractSubtitlePayload(archive, { sourceName: 'Movie.zip' });
  assert.equal(normal.entryName, 'Movie.Arabic.srt');
});

test('OpenSubtitles keeps SRT conversion for normal use and original format for styled use', () => {
  assert.deepEqual(buildOpenSubtitlesDownloadBody('123'), { file_id: 123, sub_format: 'srt' });
  assert.deepEqual(buildOpenSubtitlesDownloadBody('123', { subFormat: null }), { file_id: 123 });
});

test('Stremio keeps the existing SRT option and adds an optional styled ASS option', () => {
  const subtitles = toStremioSubtitles([{
    provider: 'subdl',
    id: 'styled-1',
    fileName: 'Movie.2026.1080p.WEB-DL-GROUP.ass',
    releaseName: 'Movie.2026.1080p.WEB-DL-GROUP',
    lang: 'ara',
    download: 'https://example.com/Movie.2026.1080p.WEB-DL-GROUP.ass',
    parsedRelease: { quality: '1080p', source: 'web-dl' },
    score: 900,
  }], 'https://addon.example', {
    query: 'Movie 2026',
    filename: 'Movie.2026.1080p.WEB-DL-GROUP.mkv',
  });

  assert.ok(subtitles.some(item => item.url.endsWith('.srt') && item.name.includes('Original')));
  assert.ok(subtitles.some(item => item.url.endsWith('.ass') && item.name.includes('Styled ASS')));
  assert.ok(subtitles.every(item => item.lang === 'ara'));
});
