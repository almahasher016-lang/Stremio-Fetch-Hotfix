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
