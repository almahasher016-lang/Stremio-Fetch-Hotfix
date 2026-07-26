import test from 'node:test';
import assert from 'node:assert/strict';
import { getBaseUrl, parseExtra } from '../utils/stremio.js';
import { requestId } from '../api/middleware/requestId.js';

test('getBaseUrl accepts a normalized public request origin', () => {
  assert.equal(getBaseUrl({
    protocol: 'http',
    headers: {
      host: 'internal.invalid',
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'subtitles.example.com, proxy.internal',
    },
  }), 'https://subtitles.example.com');
});

test('getBaseUrl rejects malformed or credential-bearing origins', () => {
  for (const req of [
    { protocol: 'javascript', headers: { host: 'example.com' } },
    { protocol: 'https', headers: { host: 'user@example.com' } },
    { protocol: 'https', headers: { host: 'example.com/forged' } },
    { protocol: 'https', headers: {} },
  ]) {
    assert.throws(() => getBaseUrl(req), error => error?.status === 400);
  }
});

test('requestId accepts bounded safe IDs and replaces unsafe values', () => {
  const headers = {};
  const response = { setHeader: (key, value) => { headers[key] = value; } };
  let continued = false;
  const next = () => { continued = true; };
  const trusted = { headers: { 'x-request-id': 'edge_123:abc' } };
  requestId(trusted, response, next);
  assert.equal(trusted.id, 'edge_123:abc');
  assert.equal(headers['X-Request-Id'], trusted.id);
  assert.equal(continued, true);

  const unsafe = { headers: { 'x-request-id': 'bad\r\nx-injected: yes' } };
  requestId(unsafe, response, () => {});
  assert.match(unsafe.id, /^[0-9a-f-]{36}$/);
});

test('parseExtra rejects malformed percent encoding as a client error', () => {
  assert.deepEqual(parseExtra('filename=Movie%20Name.mkv'), { filename: 'Movie Name.mkv' });
  assert.throws(() => parseExtra('filename=%E0%A4%A'), error => error?.status === 400);
  assert.throws(() => parseExtra('__proto__=polluted'), error => error?.status === 400);
});
