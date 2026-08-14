import type { TelemetryReading } from "@bms/shared";

import {
  DEFAULT_LISTENER_BACKOFF,
  listenerBackoffMs,
  type BackoffPolicy,
} from "./listener-backoff";

/**
 * The telemetry `LISTEN bms_telemetry` loop (`F4.34`).
 *
 * **Why this is a module and not the body of `TelemetryNotifyService`:** the
 * service is a Nest provider with a real `pg.Client` and a real clock, which is
 * exactly the shape nothing tests. `apps/ingest` settled the same problem the
 * same way — `src/main.ts` is "deliberately wiring-only and stays uncovered;
 * the decisions it would otherwise make live in `host/config.ts`,
 * `host/bindings.ts` and `host/supervisor.ts`, which are". This file holds the
 * decisions; `telemetry-notify.service.ts` holds the wiring.
 *
 * **What was wrong before `F4.34`.** The service connected once, issued
 * `LISTEN`, and attached only a `notification` handler. There was no
 * `error` handler and no reconnect. Two consequences, and the second is worse
 * than the row that raised this recorded:
 *
 * 1. A dropped listener connection was never re-established, so rows kept
 *    landing in `telemetry.point_values` while every dashboard went dead with
 *    no error and no alarm — the exact outage ADR 0016 §6 commit 4 removed on
 *    the ingest side, still reachable one hop downstream.
 * 2. `pg.Client` is an `EventEmitter`, and an `error` event with no registered
 *    listener **throws**. So a connection-level error did not merely go
 *    unnoticed; it surfaced as an unhandled error from a background emitter.
 *
 * **What is deliberately not solved here.** `NOTIFY` has no replay: readings
 * published while the listener is down are gone from the realtime path for
 * good. They are still written to the hypertable, so a client recovers its
 * history through `GET /telemetry/points/:pointRef/recent` and only the live
 * push is lost. Durable realtime delivery would be a queue, which is a
 * different decision and not this fix.
 */

/** Notification payload shape as `pg` delivers it. */
export type ListenerNotification = { readonly payload?: string };

/**
 * The slice of `pg.Client` this loop uses.
 *
 * Structural rather than importing `Client` so a test can supply a fake without
 * a database, and so the loop cannot quietly start using more of `pg` than it
 * declares.
 */
export type ListenerClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  on(event: "notification", listener: (msg: ListenerNotification) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  end(): Promise<void>;
};

export type ListenerState = "connected" | "disconnected";

/** Three methods, matching what Nest's `Logger` offers and nothing more. */
export type ListenerLogger = {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export type TelemetryListenerDeps = {
  /** A fresh client per attempt — `pg.Client` is not reusable after `end()`. */
  createClient(): ListenerClient;
  /** Called with each parsed batch. Throwing is caught and logged, never fatal. */
  onReadings(readings: TelemetryReading[]): void;
  logger: ListenerLogger;
  /** Injected so tests do not wait out a 60 s cap. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Jitter source. Injected so the spread is assertable. */
  random?: () => number;
  /** Fired on every transition, and on every reconnect attempt. */
  onStateChange?(state: ListenerState): void;
  onReconnectAttempt?(): void;
  policy?: BackoffPolicy;
};

export type TelemetryListener = {
  /** Starts the loop. Returns immediately; it runs until `stop()`. */
  start(): void;
  /** Stops the loop and closes the current client. Idempotent. */
  stop(): Promise<void>;
  connected(): boolean;
  reconnects(): number;
};

/** Parses one payload into readings, or `null` when it carries none. */
export function parseNotification(raw: string | undefined): TelemetryReading[] | null {
  let payload: { readings?: unknown };
  try {
    payload = JSON.parse(raw ?? "{}") as { readings?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(payload.readings)) {
    return null;
  }
  return payload.readings as TelemetryReading[];
}

/** Builds the listener. Nothing runs until `start()`. */
export function createTelemetryListener(deps: TelemetryListenerDeps): TelemetryListener {
  const random = deps.random ?? Math.random;
  const policy = deps.policy ?? DEFAULT_LISTENER_BACKOFF;
  const { logger } = deps;

  const stopController = new AbortController();
  let stopped = false;
  let running: Promise<void> | null = null;
  let current: ListenerClient | null = null;
  let isConnected = false;
  let reconnectCount = 0;

  function setConnected(next: boolean): void {
    if (isConnected === next) {
      return;
    }
    isConnected = next;
    deps.onStateChange?.(next ? "connected" : "disconnected");
  }

  function reason(error: unknown): string {
    // `JSON.stringify(new Error(...))` is `{}` — `message` and `stack` are
    // non-enumerable — which is how the pre-`F4.34` service logged an empty
    // object on the one path that mattered. Reach for `.message` explicitly.
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Resolves when the connection is lost or `stop()` is called.
   *
   * The `error` handler is attached **before** `connect()` by the caller, so a
   * failure during the handshake lands here rather than on an emitter with no
   * listener.
   */
  function waitForLoss(client: ListenerClient, attachError: (fn: (err: Error) => void) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (message !== "") {
          logger.warn(`bms_telemetry listener lost: ${message}`);
        }
        resolve();
      };
      attachError((err) => {
        settle(reason(err));
      });
      client.on("end", () => {
        settle("connection ended");
      });
      if (stopController.signal.aborted) {
        settle("");
        return;
      }
      stopController.signal.addEventListener("abort", () => {
        settle("");
      });
    });
  }

  async function safeEnd(client: ListenerClient): Promise<void> {
    try {
      await client.end();
    } catch (error) {
      // A client that will not close must not stop the next attempt. Never a
      // silent `catch {}` — the same rule ADR 0016 §5 rule 9 sets for ingest.
      logger.warn(`bms_telemetry listener close failed: ${reason(error)}`);
    }
  }

  async function loop(): Promise<void> {
    let attempt = 0;
    while (!stopped) {
      const client = deps.createClient();
      current = client;
      // Registered before `connect()` and kept for the client's whole life.
      // `pg.Client` is an EventEmitter: an `error` event with no listener
      // throws, so this handler is what makes a connection-level failure
      // recoverable rather than fatal.
      let onError: (err: Error) => void = () => {};
      client.on("error", (err: Error) => {
        onError(err);
      });

      try {
        const lost = waitForLoss(client, (fn) => {
          onError = fn;
        });
        await client.connect();
        await client.query("LISTEN bms_telemetry");
        client.on("notification", (msg) => {
          const readings = parseNotification(msg.payload);
          if (readings === null) {
            logger.warn("Failed to parse bms_telemetry payload");
            return;
          }
          try {
            deps.onReadings(readings);
          } catch (error) {
            logger.warn(`Failed to broadcast bms_telemetry payload: ${reason(error)}`);
          }
        });

        // A successful connect resets the backoff: a listener that recovers
        // cleanly after an hour should retry in one second next time, not sixty.
        attempt = 0;
        setConnected(true);
        logger.log("Listening on bms_telemetry");

        await lost;
      } catch (error) {
        logger.error(`Could not subscribe to bms_telemetry: ${reason(error)}`);
      } finally {
        setConnected(false);
        await safeEnd(client);
        current = null;
      }

      if (stopped) {
        return;
      }

      const delay = listenerBackoffMs(attempt, random, policy);
      attempt += 1;
      reconnectCount += 1;
      deps.onReconnectAttempt?.();
      logger.warn(`bms_telemetry listener reconnecting in ${delay} ms (attempt ${attempt})`);
      await deps.sleep(delay, stopController.signal);
    }
  }

  return {
    start() {
      if (running !== null) {
        return;
      }
      running = loop();
    },

    async stop() {
      stopped = true;
      stopController.abort();
      const pending = running;
      running = null;
      if (current !== null) {
        await safeEnd(current);
        current = null;
      }
      setConnected(false);
      await pending;
    },

    connected() {
      return isConnected;
    },

    reconnects() {
      return reconnectCount;
    },
  };
}
