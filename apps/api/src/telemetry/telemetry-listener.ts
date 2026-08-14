import {
  backoffDelayMs,
  DEFAULT_BACKOFF,
  type BackoffPolicy,
  type TelemetryReading,
} from "@bms/shared";

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
 * `LISTEN`, and attached only a `notification` handler. There was no `error`
 * handler and no reconnect. The consequence was worse than the backlog row
 * that raised this recorded: `pg.Client` is an `EventEmitter`, and an `error`
 * event with no registered listener **throws**. With no `uncaughtException`
 * handler anywhere in `apps/api/src` and no `restart:` policy on the `api`
 * compose service, a dropped listener connection did not merely leave
 * dashboards silently dead — it terminated the whole API and left it down.
 * Reproduced against a live database by terminating the listener's backend.
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

/**
 * How long a connection must survive before it counts as healthy.
 *
 * Resetting the backoff the instant `LISTEN` returns looks right and is not: a
 * peer that accepts a connection and drops it immediately — pgbouncer at its
 * pool limit, a replica still in recovery, a proxy idle-killing the socket —
 * resets the exponent on every cycle, so the listener retries at the ~1 s floor
 * forever instead of escalating. That is roughly 86,400 connect attempts a day
 * per replica, with no backoff ever reached. Raised by the `F4.34` security
 * review; the reset now requires the connection to have actually held.
 */
export const DEFAULT_STABLE_MS = 30_000;

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
  /** Clock, injected so the stability window is testable without waiting. */
  now?: () => number;
  /** Fired on every transition, and on every reconnect attempt. */
  onStateChange?(state: ListenerState): void;
  onReconnectAttempt?(): void;
  policy?: BackoffPolicy;
  stableMs?: number;
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
  // Unchecked cast, matching the pre-`F4.34` code exactly. Any role that can
  // connect to the database can `NOTIFY` this channel — no table privilege is
  // required — so the trust boundary is database credentials rather than the
  // MQTT edge. Validating here would be real defence in depth; it is `F4.36`,
  // kept out of this fix because changing a data path under a reconnect change
  // is how two defects get one test.
  return payload.readings as TelemetryReading[];
}

/** Builds the listener. Nothing runs until `start()`. */
export function createTelemetryListener(deps: TelemetryListenerDeps): TelemetryListener {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());
  const policy = deps.policy ?? DEFAULT_BACKOFF;
  const stableMs = deps.stableMs ?? DEFAULT_STABLE_MS;
  const { logger } = deps;

  const stopController = new AbortController();
  let stopped = false;
  let running: Promise<void> | null = null;
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
   * The abort listener is **removed on settle**. It was originally added per
   * iteration with no removal against a controller that lives for the whole
   * process, so listeners accumulated one per reconnect — a leak driven by
   * database availability rather than traffic, and one that would eventually
   * print `MaxListenersExceededWarning` from an unrelated-looking place. Both
   * reviews found it independently.
   */
  function waitForLoss(
    client: ListenerClient,
    attachError: (fn: (err: Error) => void) => void,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const onAbort = (): void => {
        settle("");
      };
      const settle = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        stopController.signal.removeEventListener("abort", onAbort);
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
      stopController.signal.addEventListener("abort", onAbort, { once: true });
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
      let client: ListenerClient | null = null;
      /**
       * When the current connection became usable, or `null` if it never did.
       *
       * **`null` and not `0`.** With `0` as the sentinel, an injected clock that
       * legitimately reads 0 made "never connected" and "connected at time 0"
       * indistinguishable, and the stability-window reset silently never fired.
       * A mutation removing the window survived because of it.
       */
      let connectedAt: number | null = null;

      try {
        // Inside the `try`: a throw from `createClient()` — a malformed
        // `DATABASE_URL` is the realistic one — would otherwise escape the loop
        // as an unhandled rejection and, with nothing catching those in this
        // app, take the API down. That is the very failure mode this item
        // exists to remove, so it must not be reintroduced by the fix.
        client = deps.createClient();
        // Registered before `connect()` and kept for the client's whole life.
        // `pg.Client` is an EventEmitter: an `error` event with no listener
        // throws, so this handler is what makes a connection-level failure
        // recoverable rather than fatal.
        let onError: (err: Error) => void = () => {};
        client.on("error", (err: Error) => {
          onError(err);
        });

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

        connectedAt = now();
        setConnected(true);
        logger.log("Listening on bms_telemetry");

        await lost;
      } catch (error) {
        logger.error(`Could not subscribe to bms_telemetry: ${reason(error)}`);
      } finally {
        setConnected(false);
        if (client !== null) {
          await safeEnd(client);
        }
      }

      if (stopped) {
        return;
      }

      // Reset only if the connection actually held. See `DEFAULT_STABLE_MS`:
      // resetting on connect alone lets an accept-then-drop peer pin the retry
      // rate at the floor forever.
      if (connectedAt !== null && now() - connectedAt >= stableMs) {
        attempt = 0;
      }

      const delay = backoffDelayMs(attempt, random, policy);
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
      // The loop is a background task nothing awaits until `stop()`, so an
      // escaping rejection would be unobserved. Catching here keeps a bug in
      // the supervisor from becoming the outage the supervisor prevents.
      running = loop().catch((error: unknown) => {
        logger.error(`bms_telemetry listener loop terminated: ${reason(error)}`);
        setConnected(false);
      });
    },

    async stop() {
      stopped = true;
      stopController.abort();
      const pending = running;
      running = null;
      // The current client is **not** closed here. Aborting settles
      // `waitForLoss`, and the loop's own `finally` closes it — closing from
      // both sides produced a second `end()` and a spurious "close failed" warn.
      await pending;
      setConnected(false);
    },

    connected() {
      return isConnected;
    },

    reconnects() {
      return reconnectCount;
    },
  };
}
