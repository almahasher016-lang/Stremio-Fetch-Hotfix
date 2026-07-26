import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPinnedLookup,
  isBlockedRemoteAddress,
  parsePublicRemoteUrl,
  resolvePublicRemoteUrl,
} from '../utils/safeRemoteUrl.js';

test('remote URL parser rejects credentials, local names, and unsafe protocols', () => {
  for (const value of [
    'file:///etc/passwd',
    'http://user:pass@example.com/subtitle.srt',
    'http://localhost/subtitle.srt',
    'http://api.internal/subtitle.srt',
    'http://service.local/subtitle.srt',
  ]) {
    assert.throws(() => parsePublicRemoteUrl(value), error => error?.status === 400);
  }
});

test('remote address policy blocks private, link-local, reserved, and mapped ranges', () => {
  for (const address of [
    '0.0.0.1',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.88.99.1',
    '198.18.0.1',
    '203.0.113.5',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ]) {
    assert.equal(isBlockedRemoteAddress(address), true, address);
  }
  assert.equal(isBlockedRemoteAddress('1.1.1.1'), false);
  assert.equal(isBlockedRemoteAddress('2606:4700:4700::1111'), false);
});

test('DNS validation rejects private-only and mixed public/private answers', async () => {
  await assert.rejects(
    resolvePublicRemoteUrl('https://example.com/subtitle.srt', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    error => error?.status === 400,
  );
  await assert.rejects(
    resolvePublicRemoteUrl('https://example.com/subtitle.srt', {
      lookup: async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    }),
    error => error?.status === 400,
  );
  await assert.rejects(
    resolvePublicRemoteUrl('https://missing.example/subtitle.srt', {
      lookup: async () => { throw new Error('ENOTFOUND'); },
    }),
    error => error?.status === 502,
  );
});

test('DNS validation accepts public answers and strips fragments', async () => {
  const result = await resolvePublicRemoteUrl('https://example.com/subtitle.srt#ignored', {
    lookup: async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  });
  assert.equal(result.url, 'https://example.com/subtitle.srt');
  assert.deepEqual(result.records, [
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
});

test('pinned lookup returns only the pre-validated addresses', async () => {
  const lookup = createPinnedLookup([
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  const all = await new Promise((resolve, reject) => {
    lookup('attacker-controlled.example', { all: true }, (error, records) => error ? reject(error) : resolve(records));
  });
  assert.deepEqual(all, [
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
});
