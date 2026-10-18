import type { OnboardingDiscoveryErrorClass } from "@bms/shared";

import type { DiscoveryCollector } from "./discovery-collector";
import {
  DISCOVERY_CONNECT_TIMEOUT_MS,
  type DiscoveryConnectOptions,
  type MqttDiscoveryTransport,
} from "./discovery-transport";

/**
 * `F3.24b` (ADR 0103 decisions 4, 5 and 7; security review L1) — one bounded
 * listening window: connect, one QoS 0 subscription to `filter`, every
 * message to the collector, then disconnect at the end of the window or at
 * the first cap that stops the collector, whichever comes first.
 *
 * **It never throws and never returns broker text.** A broker or socket error
 * becomes one of the four classes; its message, its stack and the connect
 * options never leave this function. A thrown error would reach BullMQ's
 * `failedReason` in Redis (L1).
 */

export type ListenOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly error?: OnboardingDiscoveryErrorClass };

const AUTH_CODES: ReadonlySet<number> = new Set([4, 5, 134, 135]);
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);
const TLS_CODES = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT|UNABLE_TO_|HOSTNAME_MISMATCH|ERR_OSSL_)/;

/** An error's class from its `code` and, for the two library-made errors, its fixed message. */
export function classifyMqttError(error: unknown): OnboardingDiscoveryErrorClass {
  const e = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
    library?: unknown;
  };
  const message = typeof e.message === "string" ? e.message : "";
  if (typeof e.code === "number" && AUTH_CODES.has(e.code)) {
    return "auth refused";
  }
  if (/not authori[sz]ed|bad user ?name or password/i.test(message)) {
    return "auth refused";
  }
  if (typeof e.code === "string" && TLS_CODES.test(e.code)) {
    return "TLS failed";
  }
  if (e.library === "SSL routines" || message === "TLS not authorized") {
    return "TLS failed";
  }
  if (typeof e.code === "string" && UNREACHABLE_CODES.has(e.code)) {
    return "host unreachable";
  }
  if (/connack timeout/i.test(message)) {
    return "timeout";
  }
  return "host unreachable";
}

export async function listenForDevices(args: {
  readonly transport: MqttDiscoveryTransport;
  readonly options: DiscoveryConnectOptions;
  readonly filter: string;
  readonly windowMs: number;
  readonly collector: DiscoveryCollector;
  readonly connectTimeoutMs?: number;
}): Promise<ListenOutcome> {
  return new Promise<ListenOutcome>((resolve) => {
    let settled = false;
    let connected = false;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let windowTimer: ReturnType<typeof setTimeout> | undefined;
    let handle: ReturnType<MqttDiscoveryTransport["connect"]> | undefined;

    const finish = (outcome: ListenOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(windowTimer);
      try {
        handle?.end(true);
      } catch {
        // Ending a socket that already failed must not turn a result into a throw.
      }
      resolve(outcome);
    };

    try {
      handle = args.transport.connect(args.options);
    } catch (error) {
      finish({ kind: "failed", error: classifyMqttError(error) });
      return;
    }
    const client = handle;

    // A throw while the listeners are registered rejects this promise (the
    // executor's own semantics); the job's `finally` still writes `failed`
    // and a `finish` row. The connect timer starts only after registration,
    // so a rejected listen leaves no timer behind.
    client.on("connect", () => {
      if (connected || settled) {
        return;
      }
      connected = true;
      clearTimeout(connectTimer);
      client.subscribe(args.filter, { qos: 0 }, (error, granted) => {
        // A SUBACK of 0x80 is the broker refusing the filter for this user.
        if (error || granted?.some((g) => g.qos === 128)) {
          finish({ kind: "failed", error: "auth refused" });
          return;
        }
        windowTimer = setTimeout(() => {
          finish({ kind: "done" });
        }, args.windowMs);
      });
    });
    client.on("message", (topic, payload) => {
      if (settled) {
        return;
      }
      try {
        args.collector.offer(topic, payload);
      } catch {
        // A throw inside the library's event dispatch would never settle this
        // promise; end the window as failed instead.
        finish({ kind: "failed" });
        return;
      }
      if (args.collector.stopped) {
        finish({ kind: "done" });
      }
    });
    client.on("error", (error) => {
      finish({ kind: "failed", error: classifyMqttError(error) });
    });
    client.on("close", () => {
      // Closed before CONNACK: nothing answered. Closed during the window (a
      // broker that allows one connection per user, a restart): keep what
      // arrived — the result is a partial window, not a failure.
      finish(connected ? { kind: "done" } : { kind: "failed", error: "host unreachable" });
    });

    connectTimer = setTimeout(() => {
      finish({ kind: "failed", error: "timeout" });
    }, args.connectTimeoutMs ?? DISCOVERY_CONNECT_TIMEOUT_MS);
  });
}
