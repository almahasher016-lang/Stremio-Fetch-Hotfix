import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Grafana dashboard and Prometheus alert rules are deployable configuration', async () => {
  const dashboardText = await readFile(new URL('../../ops/grafana/m7md-enterprise-dashboard.json', import.meta.url), 'utf8');
  const alerts = await readFile(new URL('../../ops/prometheus/alerts.yml', import.meta.url), 'utf8');
  const dashboard = JSON.parse(dashboardText);
  assert.equal(dashboard.uid, 'm7md-enterprise');
  assert.ok(dashboard.panels.length >= 6);
  assert.match(alerts, /M7mdHttpErrorBudgetBurn/);
  assert.match(alerts, /M7mdAccuracyPreflightUnavailable/);
});
