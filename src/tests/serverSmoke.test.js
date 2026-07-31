import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5_000);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited during startup with code ${code}`));
    });
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('running on port')) return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

test('server exposes the release, administration dashboard, and maintenance actions', async t => {
  const port = 31_817;
  const adminToken = 'test-admin-token-which-is-at-least-32-bytes';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ADMIN_TOKEN: adminToken,
      ENCODING_PROXY_SECRET: 'test-proxy-secret-which-is-at-least-32-bytes',
      ADMIN_RATE_LIMIT_MAX: '6',
      ADMIN_RATE_LIMIT_WINDOW_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
  });
  await waitForServer(child);

  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { 'x-admin-token': adminToken };
  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: 'ok', version: config.app.version, ai: false });

  const styledPreflight = await fetch(`${baseUrl}/proxy/styled/invalid.ass`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://web.stremio.com',
      'access-control-request-method': 'GET',
    },
  });
  assert.equal(styledPreflight.status, 204);
  assert.equal(styledPreflight.headers.get('access-control-allow-origin'), '*');
  assert.match(styledPreflight.headers.get('access-control-expose-headers') || '', /X-Source-Archive-Entry/i);

  const adminResponse = await fetch(`${baseUrl}/api/admin/health`, { headers });
  assert.equal(adminResponse.status, 200);
  const admin = await adminResponse.json();
  assert.equal(admin.version, config.app.version);
  assert.equal(admin.limiters.yify.maxConcurrent, config.providers.maxConcurrentPerProvider);
  assert.equal(admin.breakers.yify.state, 'closed');

  for (const page of ['/admin.html', '/vault.html']) {
    const response = await fetch(`${baseUrl}${page}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>$/i);
    assert.match(html, new RegExp(config.app.version.replaceAll('.', '\\.')));

    const csp = response.headers.get('content-security-policy') || '';
    const headerNonce = csp.match(/script-src[^;]*'nonce-([^']+)'/u)?.[1];
    const elementNonces = [...html.matchAll(/<(?:script|style)\b[^>]*\bnonce="([^"]+)"/giu)]
      .map(match => match[1]);
    assert.ok(headerNonce, `${page} must expose a CSP nonce`);
    assert.ok(elementNonces.length > 0, `${page} must inject nonce attributes`);
    assert.ok(elementNonces.every(nonce => nonce === headerNonce), `${page} nonce mismatch`);
  }

  const unauthorizedMalformedImport = await fetch(`${baseUrl}/api/vault/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"items":',
  });
  assert.equal(unauthorizedMalformedImport.status, 401);
  assert.match((await unauthorizedMalformedImport.json()).error, /administrator token/i);

  const authorizedMalformedImport = await fetch(`${baseUrl}/api/vault/import`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{"items":',
  });
  assert.equal(authorizedMalformedImport.status, 400);

  const clearResponse = await fetch(`${baseUrl}/api/admin/cache/clear?scope=search`, { method: 'POST', headers });
  assert.equal(clearResponse.status, 200);
  assert.equal((await clearResponse.json()).result.scope, 'search');

  const resetResponse = await fetch(`${baseUrl}/api/admin/breakers/yify/reset`, { method: 'POST', headers });
  assert.equal(resetResponse.status, 200);
  assert.equal((await resetResponse.json()).breaker.state, 'closed');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/admin/cache/clear?scope=search`, { method: 'POST', headers });
    assert.equal(response.status, 200);
  }
  const limitedResponse = await fetch(`${baseUrl}/api/admin/cache/clear?scope=search`, { method: 'POST', headers });
  assert.equal(limitedResponse.status, 429);
  assert.match((await limitedResponse.json()).error, /administrative write requests/i);
});
