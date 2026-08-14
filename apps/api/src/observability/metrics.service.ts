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

  /**
   * Whether the `bms_telemetry` NOTIFY listener is currently subscribed (`F4.34`).
   *
   * This is the signal that makes a dead realtime path visible. Before it, a
   * dropped listener meant rows landing in the hypertable while every dashboard
   * sat silent — no error, no alarm, and nothing to alert on. `/health` is
   * deliberately left alone: it is documented as a liveness probe, and a
   * listener drop is not a reason to have an orchestrator restart a process
   * that is otherwise serving traffic correctly.
   */
  private readonly telemetryListenerConnected = new Gauge({
    name: "bms_api_telemetry_listener_connected",
    help: "1 when the API is subscribed to the bms_telemetry NOTIFY channel, 0 otherwise.",
    registers: [this.registry],
  });

  private readonly telemetryListenerReconnects = new Counter({
    name: "bms_api_telemetry_listener_reconnects_total",
    help: "Reconnect attempts made by the bms_telemetry NOTIFY listener.",
    registers: [this.registry],
  });

  /**
   * Readings refused by validation before broadcast (`F4.36`).
   *
   * Non-zero means something is publishing to `bms_telemetry` in a shape the
   * contract does not allow. Any role that can connect to the database can
   * write to that channel, so this is the only signal that a producer has
   * drifted — or that one exists which should not.
   */
  private readonly telemetryReadingsDropped = new Counter({
    name: "bms_api_telemetry_readings_dropped_total",
    help: "Telemetry readings dropped by NOTIFY payload validation before broadcast.",
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

  /** Records whether the telemetry NOTIFY listener is subscribed right now. */
  setTelemetryListenerConnected(connected: boolean): void {
    this.telemetryListenerConnected.set(connected ? 1 : 0);
  }

  /** Records one reconnect attempt by the telemetry NOTIFY listener. */
  countTelemetryListenerReconnect(): void {
    this.telemetryListenerReconnects.inc();
  }

  /** Records readings refused by NOTIFY payload validation. */
  countTelemetryReadingsDropped(count: number): void {
    this.telemetryReadingsDropped.inc(count);
  }
}
