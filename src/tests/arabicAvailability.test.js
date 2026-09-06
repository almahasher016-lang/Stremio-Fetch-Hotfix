import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUsableSubtitleResults } from '../services/subtitleServiceCore.js';
import { setStremioSearchNoStoreHeaders } from '../api/routes/subtitles.js';

test('empty subtitle arrays are never considered cacheable usable search results', () => {
  assert.equal(hasUsableSubtitleResults([]), false);
  assert.equal(hasUsableSubtitleResults(null), false);
  assert.equal(hasUsableSubtitleResults([{ id: 'arabic-1' }]), true);
});

test('Stremio subtitle search responses are explicitly no-store at every cache layer', () => {
  const headers = new Map();
  const res = { setHeader(name, value) { headers.set(name.toLowerCase(), value); } };
  setStremioSearchNoStoreHeaders(res);
  assert.equal(headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(headers.get('cdn-cache-control'), 'no-store');
  assert.equal(headers.get('cloudflare-cdn-cache-control'), 'no-store');
  assert.equal(headers.get('surrogate-control'), 'no-store');
  assert.equal(headers.get('pragma'), 'no-cache');
  assert.equal(headers.get('expires'), '0');
});
