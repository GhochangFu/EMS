import { Injectable } from "@nestjs/common";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

import type { CalcSkipReason } from "../calc/calc-definition";

/** Runtime skip reasons (ADR 0037 decision 9) — a stored definition can be
 * unusable (`CalcSkipReason`), or usable but skipped this evaluation because
 * an input was absent or too old.
 *
 * The five after `non_finite` are `bms-calc-v2`'s (ADR 0055; `F2.9` Task 13),
 * and every one is decided at evaluation time from state no stored row holds:
 * `dependency_cycle` (decision 8 — the formula lies on a cycle of the graph as
 * membership resolves it this tick), `membership_unresolved` (the fleet read
 * that resolves membership failed, so every `v2` formula is refused this
 * sweep rather than computed over a guessed member set), `unknown_asset_reference`
 * (a `{CODE.key}` names no asset at the owner's location, decision 12),
 * `no_members` and `coverage_below_floor` (decision 11's two aggregate
 * refusals; a member that is missing or stale under a `null` ratio reports as
 * `missing_input` / `stale_input`, the same reason a local input would). */
export type CalcRuntimeSkipReason =
  | CalcSkipReason
  | "missing_input"
  | "stale_input"
  | "non_finite"
  | "dependency_cycle"
  | "membership_unresolved"
  | "unknown_asset_reference"
  | "no_members"
  | "coverage_below_floor";

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
   * Whether the `bms_alarms` NOTIFY listener is currently subscribed (`F3.11`,
   * ADR 0064 Amendment 1 A3), mirrored from the telemetry pair above.
   *
   * Before ADR 0064 an `api`-side raise reached `api`'s own sockets with no
   * listener in the path; since it, every `created` on a screen depends on
   * `LISTEN bms_alarms` being up, and the reason `F4.34` gives for the
   * telemetry gauge applies verbatim: a dropped listener means alarms landing
   * in `bms.alarms` while every alarm rail sits silent. `/health` is left
   * alone for the same reason.
   */
  private readonly alarmListenerConnected = new Gauge({
    name: "bms_api_alarm_listener_connected",
    help: "1 when the API is subscribed to the bms_alarms NOTIFY channel, 0 otherwise.",
    registers: [this.registry],
  });

  private readonly alarmListenerReconnects = new Counter({
    name: "bms_api_alarm_listener_reconnects_total",
    help: "Reconnect attempts made by the bms_alarms NOTIFY listener.",
    registers: [this.registry],
  });

  /**
   * Readings refused by validation before broadcast (`F4.36`).
   *
   * Non-zero means something is publishing to `bms_telemetry` in a shape the
   * contract does not allow. Any role that can connect to the database can
   * write to that channel, so this is the signal that a producer has drifted —
   * or that one exists which should not.
   *
   * **It counts rejected *readings*, not rejected payloads.** A producer that
   * breaks the envelope — non-JSON, or `readings` not an array — takes the
   * early-return path in `telemetry-listener.ts`, which logs and increments
   * nothing. Alerting on this counter alone will miss that, by design: the two
   * have different units and folding them together would make neither
   * meaningful. Envelope failures are log-only (`Failed to parse
   * bms_telemetry payload`).
   */
  private readonly telemetryReadingsDropped = new Counter({
    name: "bms_api_telemetry_readings_dropped_total",
    help: "Telemetry readings dropped by NOTIFY payload validation before broadcast.",
    registers: [this.registry],
  });

  /**
   * Calc engine skips, labelled by reason (ADR 0037 decision 9: "no skip is
   * silent"). Covers both an unusable stored definition (`no_trigger`,
   * `unparseable_formula`, …) and a usable one skipped this evaluation
   * (`missing_input`, `stale_input`, `non_finite`). A skip is an absent
   * value, never a wrong one — non-zero here is expected in steady state
   * (an author has not yet tightened a loose default) and only becomes
   * actionable relative to `bms_api_calc_values_written_total`.
   */
  private readonly calcSkipped = new Counter({
    name: "bms_api_calc_skipped_total",
    help: "Calc engine evaluations skipped, by reason.",
    labelNames: ["reason"],
    registers: [this.registry],
  });

  private readonly calcValuesWritten = new Counter({
    name: "bms_api_calc_values_written_total",
    help: "Derived point values written by the calc engine.",
    registers: [this.registry],
  });

  /** Active formula count (ADR 0037 decision 7): "a gauge exposes the active
   * formula count so growth is visible before it hurts." */
  private readonly calcActiveFormulas = new Gauge({
    name: "bms_api_calc_active_formulas",
    help: "Derived formulas currently active (usable definitions loaded by the calc engine).",
    registers: [this.registry],
  });

  /**
   * Members an aggregate left out because they were missing or stale while
   * its coverage ratio still admitted the value (ADR 0055 decision 11). A
   * refused aggregate counts under `bms_api_calc_skipped_total` instead; this
   * is the partial-coverage signal that a *written* value carries — non-zero
   * means site totals are being computed over fewer assets than declared.
   */
  private readonly calcAggregateMembersExcluded = new Counter({
    name: "bms_api_calc_aggregate_members_excluded_total",
    help: "Aggregate members excluded as missing or stale from a value that was still written.",
    registers: [this.registry],
  });

  /** The largest declared member set of any aggregate, as membership resolved
   * on the last sweep (plan design decision 6): a member set is not capped —
   * a silently computed subset would be worse than being slow — so its growth
   * must be visible before it hurts. */
  private readonly calcAggregateMembersMax = new Gauge({
    name: "bms_api_calc_aggregate_members_max",
    help: "Largest declared member set of any bms-calc-v2 aggregate on the last scheduled sweep.",
    registers: [this.registry],
  });

  /**
   * Per-queue depth (ADR 0063 decision 11), sampled by `readQueueHealth` on
   * every `GET /health` read rather than on a timer — so the series moves
   * only as often as the probe is scraped or curled, and a queue nobody
   * reads reports nothing here. **No `bms_api_` prefix**, as the ADR spells
   * the name: the same registry answers on the worker's `WORKER_PORT`, and a
   * queue is not an API concern.
   */
  private readonly queueDepth = new Gauge({
    name: "bms_queue_depth",
    help: "Jobs in a BullMQ queue by state (waiting, active, failed), sampled with the health read.",
    labelNames: ["queue", "state"],
    registers: [this.registry],
  });

  /**
   * Job outcomes (ADR 0063 decision 11), incremented by the worker host's
   * `completed`/`failed` listeners. The series therefore lives in the
   * WORKER's registry and is scraped from `WORKER_PORT` (plan §15 ruling 3);
   * on the API it exists and stays at zero. No `bms_api_` prefix, as above.
   */
  private readonly queueJobs = new Counter({
    name: "bms_queue_jobs_total",
    help: "BullMQ jobs finished by the worker, by queue and outcome (completed, failed).",
    labelNames: ["queue", "outcome"],
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

  /** Records alarm event emission by alarm event type. `"cleared"` is the
   * `F3.10` lifecycle sweep's arm (ADR 0057 decision 1). */
  countAlarmEvent(type: "created" | "acknowledged" | "cleared"): void {
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

  /** Records whether the alarm NOTIFY listener is subscribed right now (`F3.11`). */
  setAlarmListenerConnected(connected: boolean): void {
    this.alarmListenerConnected.set(connected ? 1 : 0);
  }

  /** Records one reconnect attempt by the alarm NOTIFY listener (`F3.11`). */
  countAlarmListenerReconnect(): void {
    this.alarmListenerReconnects.inc();
  }

  /** Records readings refused by NOTIFY payload validation. */
  countTelemetryReadingsDropped(count: number): void {
    this.telemetryReadingsDropped.inc(count);
  }

  /** Records one calc engine skip, labelled by reason. */
  countCalcSkipped(reason: CalcRuntimeSkipReason): void {
    this.calcSkipped.labels(reason).inc();
  }

  /** Records one derived point value written by the calc engine. */
  countCalcValuesWritten(count = 1): void {
    this.calcValuesWritten.inc(count);
  }

  /** Sets the current count of active (usable) calc definitions. */
  setCalcActiveFormulas(count: number): void {
    this.calcActiveFormulas.set(count);
  }

  /** Records members an aggregate excluded from a value it still wrote. */
  countCalcAggregateExcluded(count: number): void {
    this.calcAggregateMembersExcluded.inc(count);
  }

  /** Sets the largest declared member set seen by the last scheduled sweep. */
  setCalcAggregateMembersMax(count: number): void {
    this.calcAggregateMembersMax.set(count);
  }

  /** Sets one queue's depth in one state, as read with the health probe. */
  setQueueDepth(queue: string, state: "waiting" | "active" | "failed", n: number): void {
    this.queueDepth.labels(queue, state).set(n);
  }

  /** Records one job the worker finished, by queue and outcome. */
  countQueueJob(queue: string, outcome: "completed" | "failed"): void {
    this.queueJobs.labels(queue, outcome).inc();
  }
}
