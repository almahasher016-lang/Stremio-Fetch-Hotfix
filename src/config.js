import { buildConfig as buildCoreConfig, validateRuntimeConfig as validateCoreRuntimeConfig } from './configCore.js';
import { RELEASE_VERSION } from './release.js';

const VERSION_IN_NAME_RE = /\bv\d+\.\d+\.\d+\b/u;

function explicitlyConfigured(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key)
    && env[key] !== undefined
    && env[key] !== null
    && String(env[key]).trim() !== '';
}

export function buildConfig(env = process.env) {
  const runtime = buildCoreConfig(env);
  const configuredName = String(runtime.app.name || 'm7md Arabic Resolver').trim();

  runtime.app.version = RELEASE_VERSION;
  if (!explicitlyConfigured(env, 'ADDON_NAME')) {
    runtime.app.name = VERSION_IN_NAME_RE.test(configuredName)
      ? configuredName.replace(VERSION_IN_NAME_RE, `v${RELEASE_VERSION}`)
      : `${configuredName} v${RELEASE_VERSION}`;
  }
  runtime.app.userAgent = `m7mdArabicDirect/${RELEASE_VERSION}`;
  runtime.cache.keyPrefix = String(runtime.cache.keyPrefix || 'subtitles').replace(/:release:[^:]+$/u, `:release:${RELEASE_VERSION}`);

  // Cached provider download links can expire while a stale search result is still visible in Stremio.
  // Reliability is the default; operators may explicitly re-enable stale-while-revalidate in Railway.
  if (!explicitlyConfigured(env, 'CACHE_STALE_WHILE_REVALIDATE')) {
    runtime.cache.staleWhileRevalidate = false;
  }

  return runtime;
}

export const config = Object.freeze(buildConfig());

export function validateRuntimeConfig(runtime = config) {
  return validateCoreRuntimeConfig(runtime);
}
