const baseUrl = String(process.env.PRODUCTION_BASE_URL || 'https://pleasing-gentleness-production.up.railway.app').replace(/\/+$/, '');
const expectedCommit = String(process.env.EXPECTED_COMMIT || '').trim().toLowerCase();
const attempts = Math.max(1, Math.min(20, Number(process.env.SMOKE_ATTEMPTS) || 8));
const retryMs = Math.max(1_000, Math.min(60_000, Number(process.env.SMOKE_RETRY_MS) || 20_000));
const timeoutMs = Math.max(2_000, Math.min(60_000, Number(process.env.SMOKE_TIMEOUT_MS) || 25_000));

const cases = [
  {
    name: 'Tuner release-year drift movie',
    path: '/subtitles/movie/tt33296751/filename=Tuner.2025.BluRay.1080p.TrueHD.Atmos.7.1.AVC.REMUX-FraMeSToR.mkv&videoSize=27543009236&videoHash=e9893332dc323e8d.json',
  },
  {
    name: 'House of the Dragon S02E02 HYPERION BluRay playback',
    path: '/subtitles/series/tt11198330:2:2/filename=House.of.the.Dragon.S02E02.MULTI.VFI.2160p.UHD.BluRay.Remux.DV.HDR.TrueHD.Atmos.7.1.HEVC-HYPERION.mkv&videoSize=37943411040&videoHash=f7c275740ef40e95.json',
  },
  {
    name: 'House of the Dragon S02E02 FraMeSToR-KiNGSMAN BluRay playback',
    path: '/subtitles/series/tt11198330:2:2/filename=House.of.the.Dragon.S02E02.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC-FraMeSToR-KiNGSMAN.mkv&videoSize=37559489003&videoHash=cff4ef4781b1412a.json',
  },
  {
    name: 'The Shawshank Redemption catalog movie',
    path: '/subtitles/movie/tt0111161.json',
  },
  {
    name: 'Game of Thrones S01E01 catalog episode',
    path: '/subtitles/series/tt0944947:1:1.json',
  },
];

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Smoke request timeout', 'AbortError')), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'm7md-production-coverage-smoke/1.0' },
    });
    return {
      response,
      body: await response.json().catch(() => ({})),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDeploymentIdentity() {
  const { response, body } = await fetchJson('/health');
  return {
    ok: response.ok,
    status: response.status,
    version: body?.version || null,
    commit: String(body?.commit || '').trim().toLowerCase() || null,
  };
}

async function fetchCase(item) {
  const { response, body } = await fetchJson(item.path);
  const subtitles = Array.isArray(body?.subtitles) ? body.subtitles : [];
  const names = subtitles.map(row => String(row?.name || row?.id || 'unnamed'));
  // Availability is NOT a synchronization claim. Release/timing proof requires examining
  // the corresponding V5 decision and evidence in Railway's runtime logs.
  return {
    ok: response.ok && subtitles.length > 0,
    status: response.status,
    count: subtitles.length,
    tiers: [...new Set(subtitles.map(row => row?.availabilityTier).filter(Boolean))],
    namedCertifiedOrSafeCount: names.filter(name => /V5 (?:Certified|Safe)/.test(name)).length,
    recoveryBadgeCount: names.filter(name => /V5 Recovery/.test(name)).length,
    names: names.slice(0, 3),
  };
}

let last = [];
let lastDeployment = null;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    lastDeployment = await fetchDeploymentIdentity();
  } catch (error) {
    lastDeployment = {
      ok: false,
      status: 0,
      version: null,
      commit: null,
      error: error?.message || String(error),
    };
  }

  const deploymentMatches = !expectedCommit || lastDeployment.commit === expectedCommit;
  if (!lastDeployment.ok || !deploymentMatches) {
    console.log(JSON.stringify({
      attempt,
      baseUrl,
      state: 'waiting-for-target-deployment',
      expectedCommit: expectedCommit || null,
      deployment: lastDeployment,
    }, null, 2));
    if (attempt < attempts) await sleep(retryMs);
    continue;
  }

  last = [];
  for (const item of cases) {
    try {
      const result = await fetchCase(item);
      last.push({ name: item.name, ...result });
    } catch (error) {
      last.push({ name: item.name, ok: false, status: 0, count: 0, error: error?.message || String(error) });
    }
  }

  console.log(JSON.stringify({
    attempt,
    baseUrl,
    expectedCommit: expectedCommit || null,
    deployment: lastDeployment,
    coverageOnly: true,
    warning: 'Nonempty subtitle responses do not prove matching BluRay release or synchronized timing; inspect V5 runtime proof.',
    results: last,
  }, null, 2));
  if (last.every(result => result.ok)) process.exit(0);
  if (attempt < attempts) await sleep(retryMs);
}

if (expectedCommit && lastDeployment?.commit !== expectedCommit) {
  console.error(`Production coverage smoke failed: target commit ${expectedCommit} was not observed in production.`);
} else {
  console.error('Production coverage smoke failed: at least one known-Arabic title returned no usable subtitle.');
}
process.exit(1);
