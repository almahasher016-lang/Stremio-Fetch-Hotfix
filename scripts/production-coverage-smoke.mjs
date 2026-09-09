const baseUrl = String(process.env.PRODUCTION_BASE_URL || 'https://pleasing-gentleness-production.up.railway.app').replace(/\/+$/, '');
const attempts = Math.max(1, Math.min(20, Number(process.env.SMOKE_ATTEMPTS) || 8));
const retryMs = Math.max(1_000, Math.min(60_000, Number(process.env.SMOKE_RETRY_MS) || 20_000));
const timeoutMs = Math.max(2_000, Math.min(60_000, Number(process.env.SMOKE_TIMEOUT_MS) || 25_000));

const cases = [
  {
    name: 'Tuner release-year drift movie',
    path: '/subtitles/movie/tt33296751/filename=Tuner.2025.BluRay.1080p.TrueHD.Atmos.7.1.AVC.REMUX-FraMeSToR.mkv&videoSize=27543009236&videoHash=e9893332dc323e8d.json',
  },
  {
    name: 'The Shawshank Redemption catalog movie',
    path: '/subtitles/movie/tt0111161.json',
  },
  {
    name: 'Game of Thrones S01E01 catalog episode',
    path: '/subtitles/series/tt0944947:1:1.json',
    forbidden: [/frozen[ ._-]*planet/i],
  },
];

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchCase(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Smoke request timeout', 'AbortError')), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}${item.path}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'm7md-production-coverage-smoke/1.1' },
    });
    const body = await response.json().catch(() => ({}));
    const subtitles = Array.isArray(body?.subtitles) ? body.subtitles : [];
    const pollutedRows = subtitles.filter(row => (item.forbidden || [])
      .some(pattern => pattern.test(JSON.stringify(row))));
    return {
      ok: response.ok && subtitles.length > 0 && pollutedRows.length === 0,
      status: response.status,
      count: subtitles.length,
      pollutedCount: pollutedRows.length,
      tiers: [...new Set(subtitles.map(row => row?.availabilityTier).filter(Boolean))],
      names: subtitles.slice(0, 5).map(row => row?.name || row?.releaseName || row?.id || 'unnamed'),
      pollutedNames: pollutedRows.map(row => row?.name || row?.releaseName || row?.id || 'unnamed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

let last = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  last = [];
  for (const item of cases) {
    try {
      const result = await fetchCase(item);
      last.push({ name: item.name, ...result });
    } catch (error) {
      last.push({ name: item.name, ok: false, status: 0, count: 0, pollutedCount: 0, error: error?.message || String(error) });
    }
  }

  console.log(JSON.stringify({ attempt, baseUrl, results: last }, null, 2));
  if (last.every(result => result.ok)) process.exit(0);
  if (attempt < attempts) await sleep(retryMs);
}

console.error('Production coverage smoke failed: a known-Arabic title returned no usable subtitle or leaked a forbidden wrong-series result.');
process.exit(1);
