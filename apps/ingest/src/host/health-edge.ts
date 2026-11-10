import type { EdgeClockReport } from "./edge-clock.js";
import { REFUSED_RECENT_MS, type UplinkStats } from "./uplink-client.js";

/**
 * The health body's edge line (`E7.2`, ADR 0123 decision 8, plan T5.5 and
 * C12). The edge serves the cloud's health listener, so its body is the same
 * `ingest-host …` header and endpoint lines, plus this one line.
 *
 * `clock=unsynced`, `clock=skewed` and a batch refused in the last ten
 * minutes **degrade** the verdict: every row stamped while it holds
 * may be offset, and an operator must see that before they trust the times.
 * The counters are lifetime counters and are rendered only — the verdict
 * never reads one (AGENTS.md §4.6); an outage shows as `buffered>0` and
 * `writePath=buffering` on the endpoint lines, as on the cloud.
 *
 * Out of `health-server.ts` for the §4.5 cap, as `health-gateways.ts` is.
 */

export type EdgeHealth = {
  /** `skewed`: synced, but the cloud's time is more than 60 s away (ADR 0123 Amendment 2). */
  readonly clock: EdgeClockReport;
  readonly uplink: UplinkStats;
};

/**
 * Whether the edge line moves the header verdict to `degraded`: a clock that
 * is not `synced`, or a batch refused for good within the last
 * `REFUSED_RECENT_MS` — a recent window, so one refusal an hour ago does not
 * degrade the box for ever (AGENTS.md §4.6).
 */
export function edgeDegrades(edge: EdgeHealth | undefined, now: Date): boolean {
  if (edge === undefined) return false;
  const refusedAt = edge.uplink.lastRefusedAt?.getTime();
  return edge.clock !== "synced" || (refusedAt !== undefined && now.getTime() - refusedAt < REFUSED_RECENT_MS);
}

/** The one `edge …` line: the clock, the last uplink outcome, and the uplink counters. */
export function renderEdgeLine(edge: EdgeHealth): string {
  const u = edge.uplink;
  return (
    `edge clock=${edge.clock} lastUplink=${u.lastOutcome ?? "never"} ` +
    `notBefore=${u.notBefore?.toISOString() ?? "none"} lastRefused=${u.lastRefusedAt?.toISOString() ?? "never"} ` +
    `batchesSent=${u.batchesSent} accepted=${u.accepted} uplinkRefused=${u.uplinkRefused} ` +
    `unattributed=${u.unattributed} invalid=${u.invalid} deviceTimeDropped=${u.deviceTimeDropped} foreignDevice=${u.foreignDevice} futureRx=${u.futureRx} ` +
    `tooOld=${u.tooOld} unresolved=${u.unresolved}`
  );
}
