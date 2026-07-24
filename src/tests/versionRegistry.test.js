import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VersionRegistry } from '../services/versionRegistryService.js';

test('persists verified versions and hydrates local media facts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'm7md-registry-'));
  const storagePath = path.join(directory, 'versions.json');
  const search = { type: 'movie', id: 'tt1375666', videoHash: 'a1b2c3d4e5f60708', videoSize: 734003200, filename: 'Example.1080p.WEB-DL.mkv' };
  try {
    const registry = new VersionRegistry({ storagePath, maxItems: 20 });
    await registry.recordDecision({
      action: 'verify',
      search,
      candidate: { provider: 'opensubtitles', providerId: '123', name: 'Arabic release', releaseName: 'Example.1080p.WEB-DL', lang: 'ara', download: 'https://example.com/subtitle.srt', score: 720 },
    });
    const matches = await registry.findMatches(search);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].provider, 'registry');
    assert.equal(matches[0].trusted, true);

    await registry.recordMedia({ ...search, durationMs: 7123000, embeddedSubtitles: [{ index: 2, language: 'ara' }] });
    const hydrated = await registry.hydrateIdentity({ type: 'movie', id: 'tt1375666', videoHash: search.videoHash });
    assert.equal(hydrated.durationMs, 7123000);

    const reopened = new VersionRegistry({ storagePath, maxItems: 20 });
    const status = await reopened.status();
    assert.equal(status.verified, 4);
    assert.equal(status.media, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
