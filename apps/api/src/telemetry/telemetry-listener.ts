import type { BackoffPolicy, TelemetryReading } from "@bms/shared";

import {
  createNotifyListener,
  DEFAULT_STABLE_MS,
  type ListenerClient,
  type ListenerLogger,
  type ListenerNotification,
  type ListenerState,
  type NotifyListener,
} from "../database/notify-listener";
import { parseReadings, type ReadingParseResult } from "./telemetry-reading.schema";

/**
 * The telemetry `LISTEN bms_telemetry` adapter (`F4.34`, `F4.36`).
 *
 * Since `F3.11` (ADR 0064 Amendment 1 A2) the supervised loop itself — the
 * `error`-before-`connect` order, the abort-listener removal, the
 * stable-window backoff reset — lives in `database/notify-listener.ts`, and
 * this file keeps only what is telemetry's: the channel name, the payload
 * parse (`F4.36`), the per-reading drop accounting, and the fan-out to
 * `onReadings`. `createTelemetryListener` builds the generic loop with those
 * plugged in; its signature and its spec are unchanged, and that spec is the
 * gate on the extraction. The `NOTIFY`-has-no-replay caveat and the `F4.34`
 * history are recorded on the loop.
 */

export { DEFAULT_STABLE_MS };
export type { ListenerClient, ListenerLogger, ListenerNotification, ListenerState };

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
  /** Called with how many readings a payload lost to validation (`F4.36`). */
  onDropped?(count: number): void;
  policy?: BackoffPolicy;
  stableMs?: number;
};

export type TelemetryListener = NotifyListener;

/**
 * Parses one payload, keeping only readings that validate (`F4.36`).
 *
 * Returns `null` when the payload is not decodable JSON or carries no
 * `readings` array. Otherwise every returned reading has been checked field by
 * field — see `telemetry-reading.schema.ts` for why the invalid ones are
 * dropped individually rather than the batch being discarded.
 */
export function parseNotification(raw: string | undefined): ReadingParseResult | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw ?? "{}");
  } catch {
    return null;
  }
  return parseReadings(payload);
}

/** Builds the listener. Nothing runs until `start()`. */
export function createTelemetryListener(deps: TelemetryListenerDeps): TelemetryListener {
  const { logger } = deps;
  return createNotifyListener({
    ...deps,
    channel: "bms_telemetry",
    // A throw from `onReadings` is caught by the loop's own `try/catch`
    // around this handler — the same never-fatal guard as before the move.
    onNotification: (raw) => {
      const parsed = parseNotification(raw);
      if (parsed === null) {
        logger.warn("Failed to parse bms_telemetry payload");
        return;
      }
      if (parsed.dropped > 0) {
        // Field paths, never values (§9.6): the payload is unvalidated data
        // of unknown provenance, and echoing it would turn a validation
        // failure into a log-injection and secret-spill surface.
        logger.warn(
          `Dropped ${parsed.dropped} invalid bms_telemetry reading(s); fields: ${parsed.failedFields.join(", ")}`,
        );
        deps.onDropped?.(parsed.dropped);
      }
      if (parsed.readings.length === 0) {
        return;
      }
      deps.onReadings(parsed.readings);
    },
  });
}
