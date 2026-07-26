import test from 'node:test';
import assert from 'node:assert/strict';
import { redactRequestUrl } from '../utils/logging.js';

test('request logging redacts signed subtitle paths and administrative query tokens', () => {
  assert.equal(
    redactRequestUrl('/proxy/encoding/secret.payload.srt?token=my-vault-token&q=test'),
    '/proxy/encoding/[redacted]?token=%5Bredacted%5D&q=test',
  );
  assert.equal(
    redactRequestUrl('/preview/encoding/secret.payload.json'),
    '/preview/encoding/[redacted]',
  );
  assert.equal(
    redactRequestUrl('https://subtitles.example/proxy/encoding/secret.srt?q=1'),
    '/proxy/encoding/[redacted]?q=1',
  );
});
