import { expect } from "vitest";

import { INGEST_HOST_STALE_SECONDS, STALE_BAND_FRACTION } from "@bms/shared";

import { hostStateAt, hostSummaryFor, rtuStateAt, type HostBeat } from "./device-state";

/**
 * `F3.16` / ADR 0127 decisions 11 and 16 — the one state rule. Assertions live
 * here; `device-state.test.ts` names the cases (ADR 0014). Times are in
 * milliseconds; `W` is a 150 s window (a 60 s device).
 */

const W = 150;
const BEAT = Date.UTC(2026, 10, 11, 12, 0, 0);
const s = (seconds: number): number => seconds * 1000;
const host: HostBeat = { hostKey: "cloud", lastBeatMs: BEAT, healthySinceMs: BEAT - s(3600) };
const monitored = (lastSeenAgo: number | null) => ({
  hostKey: "cloud",
  lastSeenMs: lastSeenAgo === null ? null : BEAT - s(lastSeenAgo),
  monitoredSinceMs: BEAT - s(3600),
});

/** D1 — each band at its boundary: 0.6 W is Online, just past it Stale, W Stale, just past W Offline. */
export function assertEachBandAtItsBoundary(): void {
  expect(STALE_BAND_FRACTION).toBe(0.6);
  expect(rtuStateAt(monitored(0), host, W)).toBe("online");
  expect(rtuStateAt(monitored(90), host, W)).toBe("online");
  expect(rtuStateAt(monitored(90.001), host, W)).toBe("stale");
  expect(rtuStateAt(monitored(150), host, W)).toBe("stale");
  expect(rtuStateAt(monitored(150.001), host, W)).toBe("offline");
}

/** D2 — the reference is the host's last beat, not the wall clock: a host that stopped long ago freezes the state. */
export function assertTheReferenceIsTheHostBeat(): void {
  const frozen: HostBeat = { hostKey: "cloud", lastBeatMs: BEAT - s(86_400), healthySinceMs: BEAT - s(90_000) };
  const rtu = { hostKey: "cloud", lastSeenMs: BEAT - s(86_400) - s(10), monitoredSinceMs: BEAT - s(90_000) };
  // A day of wall-clock silence after the host's last beat; judged against that beat, 10 s old.
  expect(rtuStateAt(rtu, frozen, W)).toBe("online");
}

/** D3 — a newly monitored RTU that never sent gets one full window from `monitored_since`. */
export function assertANewRtuGetsOneWindow(): void {
  const fresh = (sinceAgo: number) => ({ hostKey: "cloud", lastSeenMs: null, monitoredSinceMs: BEAT - s(sinceAgo) });
  expect(rtuStateAt(fresh(30), host, W)).toBe("online");
  expect(rtuStateAt(fresh(150), host, W)).toBe("stale");
  expect(rtuStateAt(fresh(151), host, W)).toBe("offline");
}

/** D4 — a recovered host (`healthy_since` restarted) gives every RTU one full window from that moment. */
export function assertARecoveredHostGivesOneWindow(): void {
  const recovered = (healthyAgo: number): HostBeat => ({
    hostKey: "cloud",
    lastBeatMs: BEAT,
    healthySinceMs: BEAT - s(healthyAgo),
  });
  const silentForAnHour = monitored(3600);
  expect(rtuStateAt(silentForAnHour, recovered(20), W)).toBe("online");
  expect(rtuStateAt(silentForAnHour, recovered(150), W)).toBe("stale");
  expect(rtuStateAt(silentForAnHour, recovered(151), W)).toBe("offline");
  // A null healthy_since (the beat was missed) adds no credit: the hour of silence is judged.
  expect(rtuStateAt(silentForAnHour, { ...host, healthySinceMs: null }, W)).toBe("offline");
}

/** D5 — no `monitored_since` is Not monitored, whatever was last seen; so is an RTU whose host has no row. */
export function assertNoMonitoredSinceIsNotMonitored(): void {
  expect(rtuStateAt({ hostKey: "cloud", lastSeenMs: BEAT, monitoredSinceMs: null }, host, W)).toBe("not_monitored");
  expect(rtuStateAt({ hostKey: null, lastSeenMs: null, monitoredSinceMs: null }, undefined, W)).toBe("not_monitored");
  expect(rtuStateAt(monitored(0), undefined, W)).toBe("not_monitored");
}

/** D6 — the host is stale strictly after INGEST_HOST_STALE_SECONDS against the database clock; no row is `never`. */
export function assertTheHostBoundary(): void {
  expect(INGEST_HOST_STALE_SECONDS).toBe(30);
  expect(hostStateAt(host, BEAT + s(30))).toBe("ok");
  expect(hostStateAt(host, BEAT + s(30.001))).toBe("stale");
  expect(hostStateAt(undefined, BEAT)).toBe("never");
}

/** D7 — the summary judges the hosts that serve the RTUs; with none named, every host; the worst state wins. */
export function assertTheHostSummary(): void {
  const edge: HostBeat = { hostKey: "edge-1", lastBeatMs: BEAT - s(120), healthySinceMs: null };
  expect(hostSummaryFor([host, edge], ["cloud"], BEAT + s(1))).toEqual({ state: "ok", lastBeatMs: BEAT });
  expect(hostSummaryFor([host, edge], ["cloud", "edge-1"], BEAT + s(1))).toEqual({
    state: "stale",
    lastBeatMs: BEAT - s(120),
  });
  expect(hostSummaryFor([host, edge], [], BEAT + s(1))).toEqual({ state: "stale", lastBeatMs: BEAT - s(120) });
  expect(hostSummaryFor([host], ["gone"], BEAT)).toEqual({ state: "never", lastBeatMs: null });
  expect(hostSummaryFor([], [], BEAT)).toEqual({ state: "never", lastBeatMs: null });
}
