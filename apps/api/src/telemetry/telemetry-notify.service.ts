import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Client } from "pg";

import type { TelemetryReading } from "@bms/shared";

import { MetricsService } from "../observability/metrics.service";
import { sleep } from "./sleep";
import { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";
import {
  createTelemetryListener,
  type ListenerClient,
  type ListenerLogger,
  type TelemetryListener,
  type TelemetryListenerDeps,
} from "./telemetry-listener";

/**
 * Builds the listener's dependencies.
 *
 * **Exported, and separate from `onModuleInit`, so the metric wiring is
 * testable.** It was originally inline, and a mutation that deleted the
 * `onStateChange` hook entirely left every test passing — the listener suite
 * covers the *listener*, and nothing covered the wiring that drives the gauge.
 * Since the gauge is the visible half of `F4.34`, a guard nothing checks was
 * not good enough. Pure over its arguments; the only impure thing left in the
 * service is `new Client()` and the clock.
 */
export function buildListenerDeps(args: {
  createClient: () => ListenerClient;
  hub: Pick<TelemetryBroadcastHub, "emitReadings">;
  metrics: Pick<
    MetricsService,
    | "setTelemetryListenerConnected"
    | "countTelemetryListenerReconnect"
    | "countTelemetryReadingsDropped"
  >;
  logger: ListenerLogger;
}): TelemetryListenerDeps {
  return {
    createClient: args.createClient,
    onReadings: (readings: TelemetryReading[]) => {
      args.hub.emitReadings(readings);
    },
    logger: args.logger,
    sleep,
    onStateChange: (state) => {
      args.metrics.setTelemetryListenerConnected(state === "connected");
    },
    onReconnectAttempt: () => {
      args.metrics.countTelemetryListenerReconnect();
    },
    onDropped: (count) => {
      args.metrics.countTelemetryReadingsDropped(count);
    },
  };
}

/**
 * Subscribes to `bms_telemetry` and fans payloads out to websocket clients.
 *
 * **Wiring only** — the reconnect loop, backoff and payload handling live in
 * `telemetry-listener.ts`, which is where the tests are. This file supplies the
 * three things that cannot be unit tested: a real `pg.Client`, a real clock,
 * and the Nest logger.
 *
 * `F4.34` replaced a connect-once listener with a supervised one. See
 * `telemetry-listener.ts` for what was wrong and what is deliberately still not
 * solved (`NOTIFY` has no replay).
 */
@Injectable()
export class TelemetryNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryNotifyService.name);
  private listener: TelemetryListener | null = null;

  constructor(
    private readonly hub: TelemetryBroadcastHub,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    // ADR 0043 decision 8 (F4.16): the API no longer holds an owner
    // (`DATABASE_URL`) connection at all. `LISTEN`/`NOTIFY` needs no schema or
    // table grant — a channel name is not a schema object — so this reaches
    // for the LEAST privileged of the three roles, not the most convenient
    // one: `bms_auth` is `NOBYPASSRLS` with narrow, named grants on four
    // tables, versus `bms_fleet`'s `BYPASSRLS` and full DML on every `bms.*`
    // and `telemetry.*` table. A future accidental query added to this
    // service (a copy-paste mistake, a debugging line) fails loudly against
    // `bms_auth`'s four-table grant instead of silently succeeding with full
    // access.
    const url = process.env.DATABASE_URL_AUTH;
    if (!url) {
      this.logger.warn("DATABASE_URL_AUTH missing; telemetry NOTIFY listener disabled");
      this.metrics.setTelemetryListenerConnected(false);
      return;
    }

    this.listener = createTelemetryListener(
      buildListenerDeps({
        createClient: () => new Client({ connectionString: url }) as unknown as ListenerClient,
        hub: this.hub,
        metrics: this.metrics,
        logger: {
          // Single-argument calls on purpose. Nest's `Logger.error(message,
          // stack?, context?)` took the old `({ err }, "…")` form as an object
          // message plus a *stack*, and `JSON.stringify` on an `Error` is `{}`
          // because `message` and `stack` are non-enumerable — so the one log
          // line that mattered on a listener failure printed an empty object and
          // discarded the cause. The listener interpolates the real text.
          log: (message) => this.logger.log(message),
          warn: (message) => this.logger.warn(message),
          error: (message) => this.logger.error(message),
        },
      }),
    );

    this.metrics.setTelemetryListenerConnected(false);
    this.listener.start();
  }

  async onModuleDestroy(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    if (listener !== null) {
      await listener.stop();
    }
  }
}
