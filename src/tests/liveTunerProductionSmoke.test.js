import test from 'node:test';
import assert from 'node:assert/strict';

const TUNER_URL = 'https://pleasing-gentleness-production.up.railway.app/subtitles/movie/tt33296751/filename=Tuner.2025.BluRay.1080p.TrueHD.Atmos.7.1.AVC.REMUX-FraMeSToR.mkv&videoSize=27543009236&videoHash=e9893332dc323e8d.json';

test('production returns Arabic subtitles for the real Tuner playback identity', async () => {
  const response = await fetch(TUNER_URL, {
    headers: { 'user-agent': 'm7md-production-smoke/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const subtitles = Array.isArray(body?.subtitles) ? body.subtitles : [];
  console.log('LIVE_TUNER_RESULT', JSON.stringify({
    count: subtitles.length,
    names: subtitles.slice(0, 10).map(item => item.name),
    urls: subtitles.slice(0, 10).map(item => item.url),
  }));
  assert.ok(subtitles.length > 0, `Expected Tuner subtitles, received ${JSON.stringify(body)}`);
});
