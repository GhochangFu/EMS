import { expect, vi } from "vitest";

import type { DiscoveryCollector } from "./discovery-collector";
import { DISCOVERY_DEADLINE_MARGIN_MS, listenForDevices, type ListenOutcome } from "./discovery-listener";
import { DISCOVERY_CONNECT_TIMEOUT_MS, type DiscoveryConnectOptions, type MqttDiscoveryTransport } from "./discovery-transport";

/**
 * `F4.339` (ADR 0117 decision 5, plan R5) — at the 300 s maximum window the
 * job's hard deadline is connect timeout + window + margin = 315 s. A broker
 * that CONNACKs and never SUBACKs listened to nothing, so the deadline ends it
 * `timeout` — at 315_000 ms and not one millisecond before.
 */
export async function assertThe300sDeadlineFiresAt315Seconds(): Promise<void> {
  vi.useFakeTimers();
  try {
    const listeners = new Map<string, () => void>();
    const transport = {
      connect: () => ({
        on: (event: string, listener: () => void) => {
          listeners.set(event, listener);
        },
        // No SUBACK: the window timer never starts, so only the deadline can end the listen.
        subscribe: () => undefined,
        end: () => undefined,
      }),
    } as unknown as MqttDiscoveryTransport;
    const collector = { offer: () => undefined, stopped: false } as unknown as DiscoveryCollector;
    let outcome: ListenOutcome | undefined;
    void listenForDevices({
      transport,
      options: {} as DiscoveryConnectOptions,
      filter: "bcpl/#",
      windowMs: 300_000,
      collector,
    }).then((result) => {
      outcome = result;
    });
    listeners.get("connect")?.();
    expect(DISCOVERY_CONNECT_TIMEOUT_MS + 300_000 + DISCOVERY_DEADLINE_MARGIN_MS).toBe(315_000);
    await vi.advanceTimersByTimeAsync(314_999);
    expect(outcome, "not before 315 s").toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ kind: "failed", error: "timeout" });
  } finally {
    vi.useRealTimers();
  }
}
