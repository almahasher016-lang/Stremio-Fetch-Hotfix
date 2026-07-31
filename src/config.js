import { buildConfig as buildCoreConfig, validateRuntimeConfig as validateCoreRuntimeConfig } from './configCore.js';

const RELEASE_VERSION = '3.5.1';
const VERSION_IN_NAME_RE = /\bv\d+\.\d+\.\d+\b/u;

export function buildConfig(env = process.env) {
  const runtime = buildCoreConfig(env);
  const configuredName = String(runtime.app.name || 'm7md Arabic Resolver').trim();

  runtime.app.version = RELEASE_VERSION;
  runtime.app.name = VERSION_IN_NAME_RE.test(configuredName)
    ? configuredName.replace(VERSION_IN_NAME_RE, `v${RELEASE_VERSION}`)
    : `${configuredName} v${RELEASE_VERSION}`;
  runtime.app.userAgent = `m7mdArabicDirect/${RELEASE_VERSION}`;
  runtime.cache.keyPrefix = String(runtime.cache.keyPrefix || 'subtitles').replace(/:release:[^:]+$/u, `:release:${RELEASE_VERSION}`);
  return runtime;
}

export const config = Object.freeze(buildConfig());

export function validateRuntimeConfig(runtime = config) {
  return validateCoreRuntimeConfig(runtime);
}
