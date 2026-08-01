import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, validateRuntimeConfig } from '../config.js';
import { buildConfig as buildCoreConfig } from '../configCore.js';
import { RELEASE_ID, RELEASE_NAME, RELEASE_USER_AGENT, RELEASE_VERSION } from '../release.js';

test('configuration prefers explicit environment values and ships no credentials', () => {
  const defaults = buildConfig({});
  assert.equal(defaults.encodingProxy.secret, '');
  assert.equal(defaults.admin.token, '');
  assert.equal(defaults.openSubtitles.apiKey, '');
  assert.equal(defaults.subdl.apiKey, '');
  assert.equal(defaults.subsource.apiKey, '');
  assert.equal(defaults.cache.redisUrl, '');
  assert.equal(defaults.cache.staleWhileRevalidate, false);
  assert.equal(defaults.ui.testUiEnabled, true);

  const configured = buildConfig({
    ADDON_NAME: 'Custom resolver',
    PROVIDER_EXCLUDE_MACHINE_TRANSLATED: 'false',
    OPENSUBTITLES_API_KEY: 'provider-key-from-env',
  });
  assert.equal(configured.app.name, 'Custom resolver');
  assert.equal(configured.providers.excludeMachineTranslated, false);
  assert.equal(configured.openSubtitles.apiKey, 'provider-key-from-env');
});

test('core and runtime configuration share one release metadata source', () => {
  const core = buildCoreConfig({});
  const runtime = buildConfig({});
  assert.equal(core.app.id, RELEASE_ID);
  assert.equal(core.app.name, RELEASE_NAME);
  assert.equal(core.app.version, RELEASE_VERSION);
  assert.equal(core.app.userAgent, RELEASE_USER_AGENT);
  assert.equal(runtime.app.version, RELEASE_VERSION);
  assert.equal(runtime.app.name, RELEASE_NAME);
  assert.equal(runtime.app.userAgent, RELEASE_USER_AGENT);
  assert.match(runtime.cache.keyPrefix, new RegExp(`:release:${RELEASE_VERSION.replaceAll('.', '\\.')}$`));
});


test('production defaults disable the test UI and require an explicit ADMIN_TOKEN', () => {
  const production = buildCoreConfig({ NODE_ENV: 'production' });
  assert.equal(production.ui.testUiEnabled, false);
  assert.equal(production.cache.staleWhileRevalidate, false);

  const legacy = buildConfig({
    NODE_ENV: 'production',
    ENCODING_PROXY_SECRET: 'proxy-production-secret-is-long-enough-12345',
    PERSONAL_VAULT_TOKEN: 'legacy-admin-secret-is-long-enough-67890',
  });
  assert.equal(legacy.admin.tokenSource, 'PERSONAL_VAULT_TOKEN');
  assert.throws(() => validateRuntimeConfig(legacy), /ADMIN_TOKEN must be configured explicitly/);

  const enabled = buildCoreConfig({ NODE_ENV: 'production', ENABLE_TEST_UI: 'true' });
  assert.equal(enabled.ui.testUiEnabled, true);
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
