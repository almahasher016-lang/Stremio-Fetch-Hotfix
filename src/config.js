import { buildConfig as buildCoreConfig, validateRuntimeConfig as validateCoreRuntimeConfig } from './configCore.js';

const RELEASE_VERSION = '3.5.1';

export function buildConfig(env = process.env) {
  const runtime = buildCoreConfig(env);
  runtime.app.version = RELEASE_VERSION;
  runtime.app.name = String(runtime.app.name || '').replace(/v3\.4\.3\b/u, `v${RELEASE_VERSION}`);
  runtime.app.userAgent = `m7mdArabicDirect/${RELEASE_VERSION}`;
  runtime.cache.keyPrefix = String(runtime.cache.keyPrefix || 'subtitles').replace(/:release:[^:]+$/u, `:release:${RELEASE_VERSION}`);
  return runtime;
}

export const config = Object.freeze(buildConfig());

export function validateRuntimeConfig(runtime = config) {
  return validateCoreRuntimeConfig(runtime);
}
