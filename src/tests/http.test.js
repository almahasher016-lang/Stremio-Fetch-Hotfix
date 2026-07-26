import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../utils/http.js';

async function withServer(handler, task) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

test('fetchJson enforces a bounded provider response size', async () => {
  await withServer((_req, res) => {
    const body = JSON.stringify({ payload: 'x'.repeat(256) });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }, async baseUrl => {
    await assert.rejects(
      fetchJson(`${baseUrl}/private`, { maxBytes: 64 }),
      error => error?.status === 400,
    );
    await assert.rejects(
      fetchJson(`${baseUrl}/large`, { maxBytes: 64, allowPrivateNetwork: true }),
      error => error?.statusCode === 413,
    );
  });
});

test('fetchJson forwards AbortSignal to the HTTP client', async () => {
  await withServer((req, res) => {
    const timer = setTimeout(() => res.end('{"ok":true}'), 1_000);
    req.on('close', () => clearTimeout(timer));
  }, async baseUrl => {
    const controller = new AbortController();
    const task = fetchJson(`${baseUrl}/slow`, { signal: controller.signal, allowPrivateNetwork: true });
    setTimeout(() => controller.abort(new DOMException('deadline', 'AbortError')), 10);
    await assert.rejects(task, error => error?.name === 'AbortError');
  });
});

test('fetchJson uses a fixed trusted provider origin without weakening redirect checks', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect-same-origin') {
      res.writeHead(302, { location: '/provider' });
      res.end();
      return;
    }
    if (req.url === '/redirect-private') {
      res.writeHead(302, { location: 'http://127.0.0.2/private' });
      res.end();
      return;
    }
    res.end('{"ok":true}');
  }, async baseUrl => {
    assert.deepEqual(
      await fetchJson(`${baseUrl}/provider`, { trustedOrigin: baseUrl }),
      { ok: true },
    );
    assert.deepEqual(
      await fetchJson(`${baseUrl}/redirect-same-origin`, { trustedOrigin: baseUrl }),
      { ok: true },
    );
    await assert.rejects(
      fetchJson(`${baseUrl}/redirect-private`, { trustedOrigin: baseUrl }),
      error => error?.status === 400,
    );
  });
});

test('fetchJson sends one case-insensitive User-Agent override', async () => {
  await withServer((req, res) => {
    const rawNames = req.rawHeaders.filter((_value, index) => index % 2 === 0);
    const userAgentCount = rawNames.filter(name => name.toLowerCase() === 'user-agent').length;
    res.end(JSON.stringify({ userAgent: req.headers['user-agent'], userAgentCount }));
  }, async baseUrl => {
    const result = await fetchJson(`${baseUrl}/headers`, {
      allowPrivateNetwork: true,
      headers: { 'User-Agent': 'provider-contract/1.0' },
    });
    assert.deepEqual(result, {
      userAgent: 'provider-contract/1.0',
      userAgentCount: 1,
    });
  });
});
