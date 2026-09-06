import { config } from '../config.js';
import {
  getAccuracyPreflightMetrics,
  getCacheMetrics,
  getProviderMetrics,
  getRuntimeMetrics,
} from './metrics.js';

function check(name, value, threshold, comparison, ready = true) {
  if (!ready) return { name, status: 'warming', value, threshold };
  const ok = comparison(value, threshold);
  return { name, status: ok ? 'ok' : 'violation', value, threshold };
}

export function evaluateSloSnapshot(snapshot, thresholds = config.slo) {
  const runtime = snapshot.runtime || {};
  const providers = snapshot.providers || {};
  const preflight = snapshot.preflight || {};
  const checks = [];
  const httpSamples = Number(runtime.http?.sampleCount || 0);
  checks.push(check(
    'http-p95-ms',
    Number(runtime.http?.p95Ms || 0),
    thresholds.httpP95Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'http-p99-ms',
    Number(runtime.http?.p99Ms || 0),
    thresholds.httpP99Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'http-5xx-rate',
    Number(runtime.http?.error5xxRate || 0),
    thresholds.http5xxRate,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));
  checks.push(check(
    'event-loop-p99-ms',
    Number(runtime.eventLoop?.p99Ms || 0),
    thresholds.eventLoopP99Ms,
    (value, limit) => value <= limit,
    httpSamples >= thresholds.minHttpSamples,
  ));

  for (const [provider, metrics] of Object.entries(providers)) {
    const calls = Number(metrics.success || 0) + Number(metrics.fail || 0);
    const ready = calls >= thresholds.minProviderSamples;
    checks.push(check(
      `provider-${provider}-success-rate`,
      metrics.successRate ?? 1,
      thresholds.providerSuccessRate,
      (value, minimum) => value >= minimum,
      ready,
    ));
    checks.push(check(
      `provider-${provider}-p95-ms`,
      Number(metrics.p95Ms || 0),
      thresholds.providerP95Ms,
      (value, limit) => value <= limit,
      ready,
    ));
  }

  const preflightTotal = Number(preflight.total || 0);
  const unavailableRate = preflightTotal
    ? Number((Number(preflight.unavailable || 0) / preflightTotal).toFixed(4))
    : 0;
  checks.push(check(
    'accuracy-preflight-unavailable-rate',
    unavailableRate,
    thresholds.preflightUnavailableRate,
    (value, limit) => value <= limit,
    preflightTotal >= thresholds.minPreflightSamples,
  ));

  const violations = checks.filter(item => item.status === 'violation');
  const warming = checks.filter(item => item.status === 'warming');
  return {
    status: violations.length ? 'degraded' : warming.length ? 'warming' : 'ok',
    violations,
    checks,
    thresholds,
  };
}

export function getSloStatus() {
  return evaluateSloSnapshot({
    runtime: getRuntimeMetrics(),
    providers: getProviderMetrics(),
    cache: getCacheMetrics(),
    preflight: getAccuracyPreflightMetrics(),
  });
}
