import { Injectable } from "@nestjs/common";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: "bms_api_http_request_duration_seconds",
    help: "API HTTP request duration in seconds.",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly websocketEvents = new Counter({
    name: "bms_api_websocket_events_total",
    help: "Socket.IO events emitted by namespace and event type.",
    labelNames: ["namespace", "event"],
    registers: [this.registry],
  });

  private readonly telemetryReadings = new Counter({
    name: "bms_api_telemetry_readings_broadcast_total",
    help: "Telemetry readings broadcast to websocket clients.",
    registers: [this.registry],
  });

  private readonly alarmEvents = new Counter({
    name: "bms_api_alarm_events_total",
    help: "Alarm websocket events emitted by type.",
    labelNames: ["type"],
    registers: [this.registry],
  });

  private readonly serviceInfo = new Gauge({
    name: "bms_api_service_info",
    help: "Static API service information.",
    labelNames: ["service", "env"],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({
      service: process.env.OTEL_SERVICE_NAME ?? "bms-api",
    });
    collectDefaultMetrics({
      prefix: "bms_api_",
      register: this.registry,
    });
    this.serviceInfo
      .labels("api", process.env.NODE_ENV ?? "development")
      .set(1);
  }

  /** Records one completed HTTP request for Prometheus. */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpDuration
      .labels(method, route, String(statusCode))
      .observe(durationSeconds);
  }

  /** Records websocket event emission by namespace and event name. */
  countWebsocketEvent(namespace: string, event: string): void {
    this.websocketEvents.labels(namespace, event).inc();
  }

  /** Records how many telemetry readings were pushed to websocket clients. */
  countTelemetryReadings(count: number): void {
    this.telemetryReadings.inc(count);
  }

  /** Records alarm event emission by alarm event type. */
  countAlarmEvent(type: "created" | "acknowledged"): void {
    this.alarmEvents.labels(type).inc();
  }
}
