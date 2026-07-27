import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, validateRuntimeConfig } from '../config.js';

test('configuration prefers explicit environment values and ships no credentials', () => {
  const defaults = buildConfig({});
  assert.equal(defaults.encodingProxy.secret, '');
  assert.equal(defaults.admin.token, '');
  assert.equal(defaults.openSubtitles.apiKey, '');
  assert.equal(defaults.subdl.apiKey, '');
  assert.equal(defaults.subsource.apiKey, '');
  assert.equal(defaults.cache.redisUrl, '');

  const configured = buildConfig({
    ADDON_NAME: 'Custom resolver',
    PROVIDER_EXCLUDE_MACHINE_TRANSLATED: 'false',
    OPENSUBTITLES_API_KEY: 'provider-key-from-env',
  });
  assert.equal(configured.app.name, 'Custom resolver');
  assert.equal(configured.providers.excludeMachineTranslated, false);
  assert.equal(configured.openSubtitles.apiKey, 'provider-key-from-env');
});

test('production validation rejects missing, short, or shared security secrets', () => {
  assert.throws(
    () => validateRuntimeConfig(buildConfig({ NODE_ENV: 'production' })),
    /ENCODING_PROXY_SECRET.*ADMIN_TOKEN/,
  );
  assert.throws(
    () => validateRuntimeConfig(buildConfig({
      NODE_ENV: 'production',
      ENCODING_PROXY_SECRET: 'short',
      ADMIN_TOKEN: 'short',
    })),
    /minimum 32 bytes/,
  );
  const shared = 'same-production-secret-is-long-enough-12345';
  assert.throws(
    () => validateRuntimeConfig(buildConfig({
      NODE_ENV: 'production',
      ENCODING_PROXY_SECRET: shared,
      ADMIN_TOKEN: shared,
    })),
    /must differ/,
  );
});

test('production validation accepts distinct strong secrets from the environment', () => {
  const runtime = buildConfig({
    NODE_ENV: 'production',
    ENCODING_PROXY_SECRET: 'proxy-production-secret-is-long-enough-12345',
    ADMIN_TOKEN: 'admin-production-secret-is-long-enough-67890',
  });
  assert.doesNotThrow(() => validateRuntimeConfig(runtime));
});

test('public base URL must be a clean HTTP origin', () => {
  assert.throws(() => buildConfig({ PUBLIC_BASE_URL: 'javascript:alert(1)' }), /HTTP\(S\) origin/);
  assert.throws(() => buildConfig({ PUBLIC_BASE_URL: 'https://user@example.com/path' }), /HTTP\(S\) origin/);
  assert.equal(buildConfig({ PUBLIC_BASE_URL: 'https://subtitles.example.com/' }).app.publicBaseUrl, 'https://subtitles.example.com');
});
