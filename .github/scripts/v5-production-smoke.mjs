import assert from 'node:assert/strict';
import { analyzeArabicScriptLanguage } from '../../src/utils/arabicLanguageProfile.js';

const BASE = 'https://pleasing-gentleness-production.up.railway.app';

async function fetchWithRetry(url, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
  }
  throw lastError;
}

async function getJson(path) {
  const response = await fetchWithRetry(`${BASE}${path}`);
  return response.json();
}

function encoded(value) {
  return encodeURIComponent(value);
}

const health = await getJson('/health');
console.log('HEALTH', JSON.stringify(health));
assert.equal(health.status, 'ok');
assert.equal(health.version, '5.0.0');

const cases = [
  {
    id: 'devil-prada-2-framestor',
    requireResult: true,
    path: `/subtitles/movie/tt33612209.json?filename=${encoded('The.Devil.Wears.Prada.2.2026.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HDR10P.HEVC.HYBRID.REMUX-FraMeSToR.mkv')}&videoSize=55444604787&videoHash=8b9821a5bf6dd20a`,
  },
  {
    id: 'spiderman',
    path: `/subtitles/movie/tt22084616.json?filename=${encoded('Spider.Man.Brand.New.Day.2026.4k.Th Rong.mkv')}&videoHash=981bb99030667653`,
  },
  {
    id: 'mummy',
    path: `/subtitles/movie/tt32612507.json?filename=${encoded('The.Mummy.2026.2160p.UHD.BluRay.REMUX.HEVC.TrueHD.7.1.mkv')}`,
  },
  {
    id: 'euphoria-s01e02',
    path: `/subtitles/series/tt8772296:1:2.json?filename=${encoded('Euphoria.S01E02.1080p.WEB-DL.DDP5.1.H.264.mkv')}`,
  },
];

for (const testCase of cases) {
  const payload = await getJson(testCase.path);
  const subtitles = Array.isArray(payload?.subtitles) ? payload.subtitles : [];
  console.log(`CASE ${testCase.id} count=${subtitles.length}`);
  if (testCase.requireResult) {
    assert.ok(subtitles.length > 0, `${testCase.id}: production still returned zero subtitles`);
  }
  for (const [index, subtitle] of subtitles.entries()) {
    console.log(`RESULT ${testCase.id} #${index + 1}`, subtitle.name || '', subtitle.lang || '', subtitle.url || '');
    assert.equal(subtitle.lang, 'ara', `${testCase.id}: non-Arabic Stremio language code`);
    assert.match(String(subtitle.name || ''), /V5\s+(Certified|Safe|Recovery)/i, `${testCase.id}: result escaped V5 proof policy`);
    assert.doesNotMatch(String(subtitle.name || ''), /V5\s+(Reject|Withhold)/i, `${testCase.id}: rejected V5 result escaped policy`);
    assert.ok(subtitle.url, `${testCase.id}: subtitle URL missing`);

    const asset = await fetchWithRetry(subtitle.url);
    const text = await asset.text();
    assert.ok(text.length > 100, `${testCase.id}: subtitle asset is unexpectedly empty`);
    const profile = analyzeArabicScriptLanguage(text);
    console.log(`ASSET ${testCase.id} #${index + 1} bytes=${Buffer.byteLength(text)} language=${profile.language} arabicWords=${profile.arabicWordHits} persianWords=${profile.persianWordHits}`);
    assert.equal(profile.likelyPersian, false, `${testCase.id}: Persian subtitle escaped V5 production`);
  }
}

console.log('V5_PRODUCTION_SMOKE_OK');
