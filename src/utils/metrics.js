import { config } from '../config.js';

const providers = new Map();
const cacheStats = {
  hits: 0,
  misses: 0,
  staleHits: 0,
  sets: 0,
  errors: 0,
};

const refreshLockStats = {
  localSkipped: 0,
  redisAcquired: 0,
  redisSkipped: 0,
  redisReleased: 0,
  redisReleaseSkipped: 0,
  redisErrors: 0,
  fallbackLocal: 0,
};

function providerState(name) {
  if (!providers.has(name)) {
    providers.set(name, {
      name,
      success: 0,
      fail: 0,
      empty: 0,
      totalMs: 0,
      avgMs: 0,
      lastStatus: 'never',
      lastError: null,
      lastAt: null,
      recent: [],
    });
  }
  return providers.get(name);
}

export function recordProviderCall(name, { ok, count = 0, ms = 0, error = null } = {}) {
  if (!config.metrics.enabled) return;
  const state = providerState(name);
  if (ok) state.success += 1;
  else state.fail += 1;
  if (ok && count === 0) state.empty += 1;
  state.totalMs += Number(ms) || 0;
  const calls = state.success + state.fail;
  state.avgMs = calls ? Math.round(state.totalMs / calls) : 0;
  state.lastStatus = ok ? (count > 0 ? 'ok' : 'empty') : 'fail';
  state.lastError = error ? String(error).slice(0, 240) : null;
  state.lastAt = new Date().toISOString();
  state.recent.push({ ok: Boolean(ok), count, ms: Math.round(ms || 0), error: state.lastError, at: state.lastAt });
  while (state.recent.length > config.metrics.windowSize) state.recent.shift();
}

export function recordCache(event) {
  if (event === 'hit') cacheStats.hits += 1;
  else if (event === 'miss') cacheStats.misses += 1;
  else if (event === 'stale') cacheStats.staleHits += 1;
  else if (event === 'set') cacheStats.sets += 1;
  else if (event === 'error') cacheStats.errors += 1;
}

export function recordRefreshLock(event) {
  if (event === 'local-skipped') refreshLockStats.localSkipped += 1;
  else if (event === 'redis-acquired') refreshLockStats.redisAcquired += 1;
  else if (event === 'redis-skipped') refreshLockStats.redisSkipped += 1;
  else if (event === 'redis-released') refreshLockStats.redisReleased += 1;
  else if (event === 'redis-release-skipped') refreshLockStats.redisReleaseSkipped += 1;
  else if (event === 'redis-error') refreshLockStats.redisErrors += 1;
  else if (event === 'fallback-local') refreshLockStats.fallbackLocal += 1;
}

export function getProviderMetrics() {
  return Object.fromEntries([...providers].map(([name, value]) => [name, {
    success: value.success,
    fail: value.fail,
    empty: value.empty,
    avgMs: value.avgMs,
    lastStatus: value.lastStatus,
    lastError: value.lastError,
    lastAt: value.lastAt,
    successRate: value.success + value.fail ? Number((value.success / (value.success + value.fail)).toFixed(3)) : null,
  }]));
}

export function getCacheMetrics() {
  return { ...cacheStats, refreshLocks: { ...refreshLockStats } };
}

export function prometheusMetrics() {
  const lines = [];
  for (const [name, value] of providers) {
    lines.push(`m7md_provider_success_total{provider="${name}"} ${value.success}`);
    lines.push(`m7md_provider_fail_total{provider="${name}"} ${value.fail}`);
    lines.push(`m7md_provider_empty_total{provider="${name}"} ${value.empty}`);
    lines.push(`m7md_provider_avg_ms{provider="${name}"} ${value.avgMs}`);
  }
  lines.push(`m7md_cache_hits_total ${cacheStats.hits}`);
  lines.push(`m7md_cache_misses_total ${cacheStats.misses}`);
  lines.push(`m7md_cache_stale_hits_total ${cacheStats.staleHits}`);
  lines.push(`m7md_cache_sets_total ${cacheStats.sets}`);
  lines.push(`m7md_cache_errors_total ${cacheStats.errors}`);
  lines.push(`m7md_cache_refresh_lock_local_skipped_total ${refreshLockStats.localSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_acquired_total ${refreshLockStats.redisAcquired}`);
  lines.push(`m7md_cache_refresh_lock_redis_skipped_total ${refreshLockStats.redisSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_released_total ${refreshLockStats.redisReleased}`);
  lines.push(`m7md_cache_refresh_lock_redis_release_skipped_total ${refreshLockStats.redisReleaseSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_errors_total ${refreshLockStats.redisErrors}`);
  lines.push(`m7md_cache_refresh_lock_fallback_local_total ${refreshLockStats.fallbackLocal}`);
  return `${lines.join('\n')}\n`;
}
