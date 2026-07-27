import { config } from '../config.js';

const DURATION_BUCKETS = [100, 250, 500, 1000, 2500, 5000, 10000, 20000];
const providers = new Map();
const cacheStats = {
  hits: 0,
  memoryHits: 0,
  redisHits: 0,
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
      totalResults: 0,
      durationCount: 0,
      durationSum: 0,
      durationBuckets: Object.fromEntries(DURATION_BUCKETS.map(bucket => [bucket, 0])),
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
  const duration = Math.max(0, Number(ms) || 0);
  state.totalMs += duration;
  state.totalResults += Math.max(0, Number(count) || 0);
  state.durationCount += 1;
  state.durationSum += duration;
  for (const bucket of DURATION_BUCKETS) {
    if (duration <= bucket) state.durationBuckets[bucket] += 1;
  }
  const calls = state.success + state.fail;
  state.avgMs = calls ? Math.round(state.totalMs / calls) : 0;
  state.lastStatus = ok ? (count > 0 ? 'ok' : 'empty') : 'fail';
  const currentError = error ? String(error).slice(0, 240) : null;
  if (ok) state.lastError = null;
  else if (currentError && currentError !== 'circuit-breaker-open') state.lastError = currentError;
  state.lastAt = new Date().toISOString();
  state.recent.push({ ok: Boolean(ok), count, ms: Math.round(ms || 0), error: currentError, at: state.lastAt });
  while (state.recent.length > config.metrics.windowSize) state.recent.shift();
}

export function recordCache(event) {
  if (event === 'hit') cacheStats.hits += 1;
  else if (event === 'memory-hit') {
    cacheStats.hits += 1;
    cacheStats.memoryHits += 1;
  } else if (event === 'redis-hit') {
    cacheStats.hits += 1;
    cacheStats.redisHits += 1;
  } else if (event === 'memory-stale') {
    cacheStats.staleHits += 1;
    cacheStats.memoryHits += 1;
  } else if (event === 'redis-stale') {
    cacheStats.staleHits += 1;
    cacheStats.redisHits += 1;
  } else if (event === 'miss') cacheStats.misses += 1;
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

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export function getProviderMetrics() {
  return Object.fromEntries([...providers].map(([name, value]) => [name, {
    success: value.success,
    fail: value.fail,
    empty: value.empty,
    avgMs: value.avgMs,
    p50Ms: percentile(value.recent.map(item => item.ms), 0.5),
    p95Ms: percentile(value.recent.map(item => item.ms), 0.95),
    maxMs: value.recent.length ? Math.max(...value.recent.map(item => item.ms)) : 0,
    totalResults: value.totalResults,
    lastStatus: value.lastStatus,
    lastError: value.lastError,
    lastAt: value.lastAt,
    successRate: value.success + value.fail ? Number((value.success / (value.success + value.fail)).toFixed(3)) : null,
  }]));
}

export function getCacheMetrics() {
  const lookups = cacheStats.hits + cacheStats.staleHits + cacheStats.misses;
  return {
    ...cacheStats,
    hitRatio: lookups ? Number(((cacheStats.hits + cacheStats.staleHits) / lookups).toFixed(4)) : null,
    refreshLocks: { ...refreshLockStats },
  };
}

export function prometheusMetrics() {
  const lines = [];
  for (const [name, value] of providers) {
    lines.push(`m7md_provider_success_total{provider="${name}"} ${value.success}`);
    lines.push(`m7md_provider_fail_total{provider="${name}"} ${value.fail}`);
    lines.push(`m7md_provider_empty_total{provider="${name}"} ${value.empty}`);
    lines.push(`m7md_provider_avg_ms{provider="${name}"} ${value.avgMs}`);
    const recentDurations = value.recent.map(item => item.ms);
    for (const bucket of DURATION_BUCKETS) {
      lines.push(`m7md_provider_duration_ms_bucket{provider="${name}",le="${bucket}"} ${value.durationBuckets[bucket]}`);
    }
    lines.push(`m7md_provider_duration_ms_bucket{provider="${name}",le="+Inf"} ${value.durationCount}`);
    lines.push(`m7md_provider_duration_ms_count{provider="${name}"} ${value.durationCount}`);
    lines.push(`m7md_provider_duration_ms_sum{provider="${name}"} ${value.durationSum}`);
    lines.push(`m7md_provider_duration_ms_p50{provider="${name}"} ${percentile(recentDurations, 0.5)}`);
    lines.push(`m7md_provider_duration_ms_p95{provider="${name}"} ${percentile(recentDurations, 0.95)}`);
  }
  lines.push(`m7md_cache_hits_total ${cacheStats.hits}`);
  lines.push(`m7md_cache_memory_hits_total ${cacheStats.memoryHits}`);
  lines.push(`m7md_cache_redis_hits_total ${cacheStats.redisHits}`);
  lines.push(`m7md_cache_misses_total ${cacheStats.misses}`);
  lines.push(`m7md_cache_stale_hits_total ${cacheStats.staleHits}`);
  lines.push(`m7md_cache_sets_total ${cacheStats.sets}`);
  lines.push(`m7md_cache_errors_total ${cacheStats.errors}`);
  const cacheMetrics = getCacheMetrics();
  lines.push(`m7md_cache_hit_ratio ${cacheMetrics.hitRatio ?? 0}`);
  lines.push(`m7md_cache_refresh_lock_local_skipped_total ${refreshLockStats.localSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_acquired_total ${refreshLockStats.redisAcquired}`);
  lines.push(`m7md_cache_refresh_lock_redis_skipped_total ${refreshLockStats.redisSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_released_total ${refreshLockStats.redisReleased}`);
  lines.push(`m7md_cache_refresh_lock_redis_release_skipped_total ${refreshLockStats.redisReleaseSkipped}`);
  lines.push(`m7md_cache_refresh_lock_redis_errors_total ${refreshLockStats.redisErrors}`);
  lines.push(`m7md_cache_refresh_lock_fallback_local_total ${refreshLockStats.fallbackLocal}`);
  return `${lines.join('\n')}\n`;
}
