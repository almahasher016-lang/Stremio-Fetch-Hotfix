import { writeFile } from 'node:fs/promises';
import { fetchText } from '../src/utils/http.js';

const BASE_URL = 'https://www.podnapisi.net';
const OUTPUT_PATH = 'podnapisi-probe-phase1.json';
const SAMPLES = Object.freeze([
  { imdbId: 'tt0111161', type: 'movie', title: 'The Shawshank Redemption' },
  { imdbId: 'tt0468569', type: 'movie', title: 'The Dark Knight' },
  { imdbId: 'tt1375666', type: 'movie', title: 'Inception' },
  { imdbId: 'tt0816692', type: 'movie', title: 'Interstellar' },
  { imdbId: 'tt0068646', type: 'movie', title: 'The Godfather' },
  { imdbId: 'tt0903747', type: 'series', season: 1, episode: 1, title: 'Breaking Bad' },
  { imdbId: 'tt1839578', type: 'series', season: 1, episode: 1, title: 'Person of Interest' },
  { imdbId: 'tt0944947', type: 'series', season: 1, episode: 1, title: 'Game of Thrones' },
  { imdbId: 'tt0141842', type: 'series', season: 1, episode: 1, title: 'The Sopranos' },
  { imdbId: 'tt1475582', type: 'series', season: 1, episode: 1, title: 'Sherlock' },
]);

const captchaPatterns = [
  /g-recaptcha/i,
  /h-captcha/i,
  /cf-chl-/i,
  /verify you are human/i,
  /captcha-container/i,
];

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function errorCategory(error) {
  if (error?.statusCode === 429) return 'rate-limited';
  if (error?.statusCode) return `http-${error.statusCode}`;
  if (error?.name === 'AbortError') return 'aborted';
  return 'request-failed';
}

async function probe() {
  const results = {
    timestamp: new Date().toISOString(),
    phase: 'discovery',
    samples: [],
    responseKinds: {},
    flags: {
      captchaIndicators: false,
      rateLimited: false,
    },
  };

  for (const sample of SAMPLES) {
    const params = new URLSearchParams({ movie: sample.imdbId });
    if (sample.type === 'series') {
      params.set('season', String(sample.season));
      params.set('episode', String(sample.episode));
    }
    params.set('languages[]', 'ar');

    const sampleResult = {
      imdbId: sample.imdbId,
      type: sample.type,
      title: sample.title,
      responseType: null,
      topLevelJsonKeys: [],
      hasCaptchaIndicators: false,
      errorCategory: null,
    };

    try {
      const text = await fetchText(`${BASE_URL}/subtitles/search/advanced?${params.toString()}`, {
        headers: { 'user-agent': 'm7mdArabicDirect/podnapisi-probe-1.0' },
        maxBytes: 500_000,
        timeoutMs: 10_000,
      });
      const trimmed = text.trim();
      const hasJsonStructure = trimmed.startsWith('{') || trimmed.startsWith('[');
      const hasHtmlStructure = /<!doctype\s+html|<html[\s>]/i.test(trimmed);
      sampleResult.hasCaptchaIndicators = captchaPatterns.some(pattern => pattern.test(text));
      if (sampleResult.hasCaptchaIndicators) results.flags.captchaIndicators = true;

      const kind = hasJsonStructure ? 'json' : hasHtmlStructure ? 'html' : 'unknown';
      sampleResult.responseType = kind;
      results.responseKinds[kind] = (results.responseKinds[kind] || 0) + 1;
      if (kind === 'json') {
        const payload = JSON.parse(trimmed);
        sampleResult.topLevelJsonKeys = payload && typeof payload === 'object'
          ? Object.keys(payload).slice(0, 20)
          : [];
      }
    } catch (error) {
      sampleResult.errorCategory = errorCategory(error);
      if (error?.statusCode === 429) results.flags.rateLimited = true;
    }

    results.samples.push(sampleResult);
    await wait(1_000);
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log('=== Podnapisi Phase 1 Probe ===');
  console.log('Response kinds:', results.responseKinds);
  console.log('CAPTCHA indicators:', results.flags.captchaIndicators);
  console.log('Rate limited:', results.flags.rateLimited);
  console.log(`Report: ${OUTPUT_PATH}`);
  if (results.flags.captchaIndicators) console.log('Possible automated obstacle; manual verification is required.');
  else if (results.responseKinds.json > 0) console.log('JSON discovered; inspect the recorded keys before designing phase 2.');
  else if (results.responseKinds.html > 0) console.log('HTML only; the API contract remains unconfirmed.');
  else console.log('Unknown response format; manual investigation is required.');
}

await probe();
