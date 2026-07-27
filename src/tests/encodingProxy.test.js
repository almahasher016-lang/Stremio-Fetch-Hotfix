import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { createEncodingToken, resolveProxiedSubtitle, verifyEncodingToken } from '../utils/encodingProxy.js';
import { toStremioSubtitles } from '../utils/stremio.js';

test('encoding tokens retain a bounded ordered Arabic fallback chain', () => {
  const token = createEncodingToken({
    url: 'https://example.com/primary.srt',
    provider: 'primary',
    candidate: { provider: 'primary', providerId: 'one', lang: 'ara' },
    fallbacks: Array.from({ length: config.encodingProxy.maxFallbacks + 2 }, (_value, index) => ({
      url: `https://example.com/fallback-${index}.srt`,
      provider: 'fallback',
      candidate: { provider: 'fallback', providerId: `fallback-${index}`, lang: 'ara' },
    })),
  });
  const payload = verifyEncodingToken(token);
  assert.equal(payload.fallbacks.length, config.encodingProxy.maxFallbacks);
  assert.equal(payload.fallbacks[0].candidate.providerId, 'fallback-0');
  assert.equal(payload.fallbacks[1].candidate.providerId, 'fallback-1');
});

test('the first Stremio result carries the next ranked candidate as fallback', () => {
  const results = [
    { id: 'first', provider: 'opensubtitles', providerId: 'one', lang: 'ara', download: 'https://example.com/first.srt' },
    { id: 'second', provider: 'subdl', providerId: 'two', lang: 'ara', download: 'https://example.com/second.srt' },
  ];
  const subtitles = toStremioSubtitles(results, 'https://addon.example', { type: 'movie', id: 'tt1375666' });
  const match = new URL(subtitles[0].url).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/);
  assert.ok(match);
  const payload = verifyEncodingToken(match[1]);
  assert.equal(payload.candidate.providerId, 'one');
  assert.equal(payload.fallbacks[0].candidate.providerId, 'two');
});

function timedSrt(text, cueCount = 8) {
  return Array.from({ length: cueCount }, (_value, index) => {
    const seconds = String(index * 3).padStart(2, '0');
    const end = String(index * 3 + 2).padStart(2, '0');
    return `${index + 1}\n00:00:${seconds},000 --> 00:00:${end},000\n${text} ${index + 1}\n`;
  }).join('\n');
}

test('the resolver falls back after a broken or non-Arabic primary source', async () => {
  for (const primaryMode of ['broken', 'english']) {
    const suffix = `${primaryMode}-${Date.now()}-${Math.random()}`;
    const primaryUrl = `https://example.com/${suffix}-primary.srt`;
    const fallbackUrl = `https://example.com/${suffix}-fallback.srt`;
    const token = createEncodingToken({
      url: primaryUrl,
      provider: 'primary',
      candidate: { provider: 'primary', providerId: suffix },
      fallbacks: [{
        url: fallbackUrl,
        provider: 'fallback',
        candidate: { provider: 'fallback', providerId: `${suffix}-fallback` },
      }],
    });
    const result = await resolveProxiedSubtitle(token, {
      fetcher: async url => {
        if (url === primaryUrl && primaryMode === 'broken') throw new Error('upstream failed');
        if (url === primaryUrl) return Buffer.from(timedSrt('English subtitle'));
        return Buffer.from(timedSrt('هذه ترجمة عربية سليمة'));
      },
    });
    assert.equal(result.fallbackIndex, 1);
    assert.match(result.text, /ترجمة عربية/);
    assert.equal(result.quality.valid, true);
  }
});

test('fallback does not reuse the primary candidate reference', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const primaryUrl = `https://example.com/${suffix}-primary.srt`;
  const fallbackUrl = `https://example.com/${suffix}-fallback.srt`;
  const referenceUrl = `https://example.com/${suffix}-reference.srt`;
  const requested = [];
  const token = createEncodingToken({
    url: primaryUrl,
    provider: 'primary',
    candidate: { provider: 'primary', providerId: suffix },
    reference: { url: referenceUrl, provider: 'reference' },
    fallbacks: [{
      url: fallbackUrl,
      provider: 'fallback',
      candidate: { provider: 'fallback', providerId: `${suffix}-fallback` },
    }],
  });
  const result = await resolveProxiedSubtitle(token, {
    fetcher: async url => {
      requested.push(url);
      return Buffer.from(url === primaryUrl
        ? timedSrt('English subtitle')
        : timedSrt('هذه ترجمة عربية سليمة'));
    },
  });
  assert.equal(result.fallbackIndex, 1);
  assert.equal(result.sync, null);
  assert.deepEqual(requested, [primaryUrl, fallbackUrl]);
});

test('compressed tokens round-trip, stay bounded, and reject tampering', () => {
  const token = createEncodingToken({
    url: 'https://example.com/primary.srt',
    provider: 'primary',
    candidate: {
      provider: 'primary',
      providerId: 'candidate',
      name: 'A'.repeat(800),
      releaseName: 'Movie.Release.1080p.WEB-DL'.repeat(20),
    },
    fallbacks: Array.from({ length: config.encodingProxy.maxFallbacks }, (_value, index) => ({
      url: `https://example.com/fallback-${index}.srt`,
      provider: 'fallback',
      candidate: { provider: 'fallback', providerId: `fallback-${index}`, name: 'B'.repeat(500) },
    })),
  });
  assert.match(token, /^z1\./);
  assert.ok(token.length <= 1800);
  assert.equal(verifyEncodingToken(token).candidate.providerId, 'candidate');

  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => verifyEncodingToken(tampered), error => error?.status === 403);
});

test('token creation always produces a payload that verification can open', () => {
  const token = createEncodingToken({
    url: 'https://example.com/large-candidate.srt',
    provider: 'provider',
    candidate: {
      provider: 'provider',
      providerId: 'large',
      name: 'A'.repeat(70_000),
      releaseName: 'B'.repeat(70_000),
    },
  });
  const payload = verifyEncodingToken(token);
  assert.equal(payload.candidate.name.length, 260);
  assert.equal(payload.candidate.releaseName.length, 260);
});

test('invalid post-sync output falls through to an unsynchronized valid source', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const primaryUrl = `https://example.com/${suffix}-sync-primary.srt`;
  const fallbackUrl = `https://example.com/${suffix}-sync-fallback.srt`;
  const requested = [];
  const token = createEncodingToken({
    url: primaryUrl,
    provider: 'primary',
    candidate: { provider: 'primary', providerId: suffix },
    syncPlan: { enabled: true, offsetMs: -120_000, ratio: 1, confidence: 99 },
    fallbacks: [{
      url: fallbackUrl,
      provider: 'fallback',
      candidate: { provider: 'fallback', providerId: `${suffix}-fallback` },
    }],
  });
  const result = await resolveProxiedSubtitle(token, {
    fetcher: async url => {
      requested.push(url);
      return Buffer.from(timedSrt('هذه ترجمة عربية سليمة'));
    },
  });
  assert.equal(result.fallbackIndex, 1);
  assert.equal(result.sync, null);
  assert.equal(result.quality.valid, true);
  assert.deepEqual(requested, [primaryUrl, fallbackUrl]);
});

test('provider-backed downloads are internal token sources and original provider behavior is retained', () => {
  const openSubtitlesUrl = toStremioSubtitles([{
    id: 'os-one',
    provider: 'opensubtitles',
    providerId: 'subtitle',
    fileId: '123456',
    lang: 'ara',
    download: '/downloads/opensubtitles/123456.srt',
  }], 'https://addon.example', { type: 'movie', id: 'tt1375666' })[0].url;
  const openSubtitlesToken = new URL(openSubtitlesUrl).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/)[1];
  const openSubtitlesPayload = verifyEncodingToken(openSubtitlesToken);
  assert.equal(openSubtitlesPayload.source.kind, 'provider');
  assert.equal(openSubtitlesPayload.source.provider, 'opensubtitles');
  assert.equal(openSubtitlesPayload.source.providerId, '123456');
  assert.equal(openSubtitlesPayload.source.url, undefined);

  const registryUrl = toStremioSubtitles([{
    id: 'registry-yify',
    provider: 'registry',
    originalProvider: 'yify',
    providerId: 'saved-yify',
    lang: 'ara',
    download: 'https://yifysubtitles.ch/subtitle/example.zip',
  }], 'https://addon.example', { type: 'movie', id: 'tt1375666' })[0].url;
  const registryToken = new URL(registryUrl).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/)[1];
  assert.equal(verifyEncodingToken(registryToken).source.provider, 'yify');
});

test('provider-backed reference sync never calls a protected self-download route', async () => {
  const [referenceSubtitle] = toStremioSubtitles([{
    id: 'os-primary',
    provider: 'opensubtitles',
    providerId: 'subtitle',
    fileId: '123456',
    lang: 'ara',
    download: '/downloads/opensubtitles/123456.srt',
    referenceSubtitle: {
      provider: 'opensubtitles',
      name: 'English reference',
      download: '/downloads/opensubtitles/654321.srt',
    },
  }], 'https://addon.example', { type: 'movie', id: 'tt1375666' });
  const token = new URL(referenceSubtitle.url).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/)[1];
  const payload = verifyEncodingToken(token);
  assert.equal(payload.source.kind, 'provider');
  assert.equal(payload.reference.kind, 'provider');
  assert.equal(payload.reference.providerId, '654321');

  const resolvedIds = [];
  const result = await resolveProxiedSubtitle(token, {
    providerLinkResolver: async source => {
      resolvedIds.push(source.providerId);
      return `https://example.com/provider-${source.providerId}.srt`;
    },
    fetcher: async url => Buffer.from(
      url.includes('123456')
        ? timedSrt('هذه ترجمة عربية سليمة')
        : timedSrt('English reference subtitle'),
    ),
  });
  assert.equal(result.quality.valid, true);
  assert.deepEqual(resolvedIds, ['123456', '654321']);
});

test('reference fallback selection scans past incompatible higher-ranked candidates', () => {
  const make = (id, withReference) => ({
    id,
    provider: 'subdl',
    providerId: id,
    lang: 'ara',
    download: `https://example.com/${id}.srt`,
    ...(withReference ? {
      referenceSubtitle: {
        provider: 'opensubtitles',
        download: `https://example.com/${id}-en.srt`,
      },
    } : {}),
  });
  const subtitles = toStremioSubtitles([
    make('first', true),
    make('second', false),
    make('third', false),
    make('fourth', true),
  ], 'https://addon.example', { type: 'movie', id: 'tt1375666' });
  const reference = subtitles.find(item => item.id === 'first-refsync');
  const token = new URL(reference.url).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/)[1];
  const payload = verifyEncodingToken(token);
  assert.equal(payload.fallbacks[0].candidate.providerId, 'fourth');
  assert.ok(payload.fallbacks[0].reference?.url);
});
