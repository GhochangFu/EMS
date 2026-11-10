import type { EdgeHealth } from "./health-edge.js";
import { renderHealth, type HealthSnapshot } from "./health-server.js";
import { assert } from "./normaliser.spec.js";

/**
 * `E7.2` / ADR 0123 decision 8, plan T5.5 and C12 — the edge's health line.
 * Assertions live here; `health-server-edge.test.ts` is the vitest entry
 * point. Out of `health-server.spec.ts`, which is near the §4.5 cap.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");

function snapshot(edge?: EdgeHealth): HealthSnapshot {
  return {
    endpoints: [],
    stopped: [],
    skipped: [],
    startedAt: new Date(NOW.getTime() - 60_000),
    staleAfterMs: 300_000,
    ...(edge === undefined ? {} : { edge }),
  };
}

function edge(overrides: Partial<EdgeHealth> = {}): EdgeHealth {
  return {
    clock: "synced",
    uplink: {
      batchesSent: 12,
      accepted: 40,
      foreignDevice: 1,
      futureRx: 0,
      tooOld: 2,
      unresolved: 3,
      uplinkRefused: 4,
      unattributed: 5,
      invalid: 6,
      deviceTimeDropped: 7,
      refusedRecently: false,
      lastOutcome: "200",
    },
    ...overrides,
  };
}

const lineOf = (body: string, prefix: string): string | undefined =>
  body.split("\n").find((l) => l.startsWith(prefix));

/** The edge line renders the clock and the uplink counters. */
export function theEdgeLineRenders(): void {
  const body = renderHealth(snapshot(edge()), NOW);
  const line = lineOf(body, "edge ");
  assert(
    line ===
      "edge clock=synced lastUplink=200 notBefore=none lastRefused=never batchesSent=12 accepted=40 uplinkRefused=4 " +
        "unattributed=5 invalid=6 deviceTimeDropped=7 foreignDevice=1 futureRx=0 tooOld=2 unresolved=3",
    `edge line was: ${line}`,
  );
  assert(body.startsWith("ingest-host ok "), `a synced edge with nothing else wrong is ok: ${body.split("\n")[0]}`);
  const deferred = renderHealth(
    snapshot(edge({ uplink: { ...edge().uplink, lastOutcome: "503", notBefore: new Date("2026-11-10T09:00:30.000Z") } })),
    NOW,
  );
  assert(
    lineOf(deferred, "edge ")?.includes("lastUplink=503 notBefore=2026-11-10T09:00:30.000Z") === true,
    "the Retry-After gate is shown",
  );
  const before = renderHealth(snapshot(edge({ uplink: { ...edge().uplink, lastOutcome: undefined } })), NOW);
  assert(lineOf(before, "edge ")?.includes("lastUplink=never") === true, "before the first post");
}

/** `clock=unsynced` degrades the verdict: every row stamped now may be offset (decision 8). */
export function anUnsyncedClockDegrades(): void {
  const skewed = renderHealth(snapshot(edge({ clock: "skewed" })), NOW);
  assert(skewed.startsWith("ingest-host degraded ") && skewed.includes("edge clock=skewed "), "skewed degrades too");
  const body = renderHealth(snapshot(edge({ clock: "unsynced" })), NOW);
  assert(body.startsWith("ingest-host degraded "), `unsynced must degrade: ${body.split("\n")[0]}`);
  assert(lineOf(body, "edge ")?.startsWith("edge clock=unsynced ") === true, "and says why");
}

/** The cloud host has no edge line and its verdict ignores the field's absence. */
export function theCloudHasNoEdgeLine(): void {
  const edgeBody = renderHealth(snapshot(edge()), NOW);
  assert(edgeBody.includes(" notify=cloud ") && !edgeBody.includes("notify=on"), "the edge does not claim to notify");
  const body = renderHealth(snapshot(), NOW);
  assert(body.includes(" notify=on "), "the cloud's literal is unchanged");
  assert(lineOf(body, "edge ") === undefined, "no edge line on the cloud");
  assert(body.startsWith("ingest-host ok "), `the cloud verdict is unchanged: ${body.split("\n")[0]}`);
}

/** A recent refusal degrades the verdict; the window itself is the client's, on its monotonic clock. */
export function aRecentRefusalDegradesForTenMinutes(): void {
  const at = new Date(NOW.getTime() - 60_000);
  const body = (recent: boolean) =>
    renderHealth(snapshot(edge({ uplink: { ...edge().uplink, lastRefusedAt: at, refusedRecently: recent } })), NOW);
  assert(body(true).startsWith("ingest-host degraded "), "a recent refusal degrades");
  assert(body(false).startsWith("ingest-host ok "), "past the window it no longer does");
  assert(body(true).includes("lastRefused=2026-11-10T08:59:00.000Z"), "and the line says when");
}
