import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSloSnapshot } from '../utils/slo.js';

const thresholds = {
  minHttpSamples: 5,
  minProviderSamples: 3,
  minPreflightSamples: 3,
  httpP95Ms: 1000,
  httpP99Ms: 2000,
  http5xxRate: 0.02,
  eventLoopP99Ms: 100,
  providerP95Ms: 1500,
  providerSuccessRate: 0.7,
  preflightUnavailableRate: 0.5,
};

test('SLO evaluator reports warming before enough samples exist', () => {
  const result = evaluateSloSnapshot({
    runtime: { http: { sampleCount: 1 }, eventLoop: {} },
    providers: {},
    preflight: { total: 0 },
  }, thresholds);
  assert.equal(result.status, 'warming');
});

test('SLO evaluator reports degraded on latency or error budget violations', () => {
  const result = evaluateSloSnapshot({
    runtime: {
      http: { sampleCount: 20, p95Ms: 2500, p99Ms: 3000, error5xxRate: 0.1 },
      eventLoop: { p99Ms: 20 },
    },
    providers: {
      yify: { success: 8, fail: 2, successRate: 0.8, p95Ms: 900 },
    },
    preflight: { total: 10, unavailable: 1 },
  }, thresholds);
  assert.equal(result.status, 'degraded');
  assert.ok(result.violations.some(item => item.name === 'http-p95-ms'));
  assert.ok(result.violations.some(item => item.name === 'http-5xx-rate'));
});

test('SLO evaluator reports ok for healthy mature samples', () => {
  const result = evaluateSloSnapshot({
    runtime: {
      http: { sampleCount: 20, p95Ms: 500, p99Ms: 900, error5xxRate: 0 },
      eventLoop: { p99Ms: 20 },
    },
    providers: {
      yify: { success: 9, fail: 1, successRate: 0.9, p95Ms: 700 },
    },
    preflight: { total: 10, unavailable: 1 },
  }, thresholds);
  assert.equal(result.status, 'ok');
});
