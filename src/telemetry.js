// @ts-check
import { config } from './config.js';

/** @type {import('@opentelemetry/sdk-node').NodeSDK | null} */
let sdk = null;
let isShuttingDown = false;
const endpoint = String(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
const requested = !['0', 'false', 'no', 'off'].includes(
  String(process.env.ENABLE_TRACING || Boolean(endpoint)).toLowerCase(),
);
/** @type {{ requested: boolean, active: boolean, exporter: string, serviceName: string, error: string | null }} */
const status = {
  requested,
  active: false,
  exporter: endpoint ? 'otlp-http' : 'none',
  serviceName: String(process.env.OTEL_SERVICE_NAME || 'm7md-arabic-stremio-subtitles'),
  error: null,
};

if (requested && endpoint) {
  try {
    process.env.OTEL_SERVICE_NAME ||= status.serviceName;
    process.env.OTEL_SERVICE_VERSION ||= config.app.version;
    process.env.OTEL_RESOURCE_ATTRIBUTES ||= `deployment.environment.name=${config.server.nodeEnv}`;
    const [{ NodeSDK }, { OTLPTraceExporter }, { getNodeAutoInstrumentations }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/auto-instrumentations-node'),
    ]);
    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      })],
    });
    await sdk.start();
    status.active = true;
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    console.warn('[telemetry]', status.error);
  }
}

export function getTelemetryStatus() {
  return { ...status };
}

export async function shutdownTelemetry() {
  if (isShuttingDown || !sdk) return;
  isShuttingDown = true;
  const activeSdk = sdk;
  sdk = null;
  status.active = false;
  await activeSdk.shutdown();
}

/** @type {readonly NodeJS.Signals[]} */
const shutdownSignals = ['SIGTERM', 'SIGINT'];
for (const signal of shutdownSignals) {
  process.prependOnceListener(signal, () => {
    shutdownTelemetry().catch(error => console.warn('[telemetry:shutdown]', error.message));
  });
}
