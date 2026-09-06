import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '../config.js';

const DURATION_BUCKETS = [100, 250, 500, 1000, 2500, 5000, 10000, 20000];
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
const httpStats = {
  recent: [],
  byRouteStatus: new Map(),
};

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

const accuracyPreflightStats = {
  valid: 0,
  degraded: 0,
  rejected: 0,
  unavailable: 0,
  recentMs: [],
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

export function recordHttpRequest(route, statusCode, ms) {
  if (!config.metrics.enabled) return;
  const safeRoute = String(route || 'other').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'other';
  const statusClass = `${Math.floor(Number(statusCode || 0) / 100) || 0}xx`;
  const duration = Math.max(0, Number(ms) || 0);
  const key = `${safeRoute}|${statusClass}`;
  httpStats.byRouteStatus.set(key, (httpStats.byRouteStatus.get(key) || 0) + 1);
  httpStats.recent.push({ ms: duration, statusCode: Number(statusCode || 0), route: safeRoute });
  while (httpStats.recent.length > Math.max(100, config.metrics.windowSize * 4)) httpStats.recent.shift();
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

export function recordAccuracyPreflight(state, ms = 0) {
  const normalized = ['valid', 'degraded', 'rejected', 'unavailable'].includes(state) ? state : 'unavailable';
  accuracyPreflightStats[normalized] += 1;
  accuracyPreflightStats.recentMs.push(Math.max(0, Number(ms) || 0));
  while (accuracyPreflightStats.recentMs.length > config.metrics.windowSize) accuracyPreflightStats.recentMs.shift();
}

export function getAccuracyPreflightMetrics() {
  const total = accuracyPreflightStats.valid
    + accuracyPreflightStats.degraded
    + accuracyPreflightStats.rejected
    + accuracyPreflightStats.unavailable;
  return {
    valid: accuracyPreflightStats.valid,
    degraded: accuracyPreflightStats.degraded,
    rejected: accuracyPreflightStats.rejected,
    unavailable: accuracyPreflightStats.unavailable,
    total,
    p95Ms: percentile(accuracyPreflightStats.recentMs, 0.95),
  };
}

export function getRuntimeMetrics() {
  const recent = httpStats.recent;
  const durations = recent.map(item => item.ms);
  const errors5xx = recent.filter(item => item.statusCode >= 500 && item.statusCode < 600).length;
  const eventLoopMeanMs = Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0;
  const p95 = eventLoopDelay.percentile(95);
  const p99 = eventLoopDelay.percentile(99);
  return {
    http: {
      sampleCount: recent.length,
      p50Ms: percentile(durations, 0.50),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      error5xxRate: recent.length ? Number((errors5xx / recent.length).toFixed(4)) : 0,
    },
    eventLoop: {
      meanMs: Number(eventLoopMeanMs.toFixed(3)),
      p95Ms: Number.isFinite(p95) ? Number((p95 / 1e6).toFixed(3)) : 0,
      p99Ms: Number.isFinite(p99) ? Number((p99 / 1e6).toFixed(3)) : 0,
    },
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
  for (const [key, count] of httpStats.byRouteStatus) {
    const [route, status] = key.split('|');
    lines.push(`m7md_http_requests_total{route="${route}",status="${status}"} ${count}`);
  }
  const runtime = getRuntimeMetrics();
  lines.push(`m7md_http_request_duration_ms_p50 ${runtime.http.p50Ms}`);
  lines.push(`m7md_http_request_duration_ms_p95 ${runtime.http.p95Ms}`);
  lines.push(`m7md_http_request_duration_ms_p99 ${runtime.http.p99Ms}`);
  lines.push(`m7md_http_5xx_ratio ${runtime.http.error5xxRate}`);
  lines.push(`m7md_event_loop_delay_ms_mean ${runtime.eventLoop.meanMs}`);
  lines.push(`m7md_event_loop_delay_ms_p95 ${runtime.eventLoop.p95Ms}`);
  lines.push(`m7md_event_loop_delay_ms_p99 ${runtime.eventLoop.p99Ms}`);
  const preflight = getAccuracyPreflightMetrics();
  lines.push(`m7md_accuracy_preflight_total{state="valid"} ${preflight.valid}`);
  lines.push(`m7md_accuracy_preflight_total{state="degraded"} ${preflight.degraded}`);
  lines.push(`m7md_accuracy_preflight_total{state="rejected"} ${preflight.rejected}`);
  lines.push(`m7md_accuracy_preflight_total{state="unavailable"} ${preflight.unavailable}`);
  lines.push(`m7md_accuracy_preflight_duration_ms_p95 ${preflight.p95Ms}`);
  return `${lines.join('\n')}\n`;
}
