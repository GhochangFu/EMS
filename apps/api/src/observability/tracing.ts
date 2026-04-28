import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

const tracingEnabled = process.env.OTEL_SDK_DISABLED !== "true";

if (tracingEnabled) {
  const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      })
    : undefined;

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "bms-api",
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  process.once("SIGTERM", () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
