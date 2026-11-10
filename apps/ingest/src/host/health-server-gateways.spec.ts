import type { GatewayHealth } from "./health-gateways.js";
import { renderHealth, type HealthSnapshot } from "./health-server.js";
import { assert } from "./normaliser.spec.js";
import type { SupervisorHealth } from "./supervisor.js";
import { gatewayHealth } from "./uplink-gateways.js";
import { gateway } from "./uplink-gateways.spec.js";

/**
 * `E7.2` / ADR 0123 decision 12, plan C12 and T3.7 — the cloud host's health
 * body carries one line per edge gateway, and none of them moves the verdict.
 *
 * Assertions live here; `health-server-gateways.test.ts` is the vitest entry
 * point (ADR 0014). Out of `health-server.spec.ts`, which is near the §4.5
 * cap.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");

function snapshot(gateways?: readonly GatewayHealth[]): HealthSnapshot {
  return {
    endpoints: [],
    stopped: [],
    skipped: [],
    startedAt: new Date(NOW.getTime() - 60_000),
    staleAfterMs: 300_000,
    ...(gateways === undefined ? {} : { gateways }),
  };
}

function health(overrides: Partial<GatewayHealth> = {}): GatewayHealth {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "GW-A",
    organizationCode: "ESKOM",
    status: "active",
    ingestEnabled: true,
    rtus: 2,
    lastSeenAt: new Date("2026-11-10T08:59:30.000Z"),
    reportedBacklog: 120,
    clockState: "synced",
    dirtyFrom: null,
    dirtyTo: null,
    ...overrides,
  };
}

const lineOf = (body: string, prefix: string): string | undefined =>
  body.split("\n").find((l) => l.startsWith(prefix));

/** One gateway renders one line with its report. */
export function aGatewayLineRenders(): void {
  const body = renderHealth(snapshot([health()]), NOW);
  const line = lineOf(body, "gateway ");
  assert(
    line ===
      "gateway id=11111111-1111-4111-8111-111111111111 code=GW-A org=ESKOM status=active ingest=on rtus=2 " +
        "lastSeen=2026-11-10T08:59:30.000Z backlog=120 clock=synced dirty=none",
    `gateway line was: ${line}`,
  );
  const never = lineOf(
    renderHealth(
      snapshot([
        health({
          lastSeenAt: null,
          reportedBacklog: null,
          clockState: null,
          dirtyFrom: new Date("2026-11-10T01:00:00.000Z"),
          dirtyTo: new Date("2026-11-10T02:00:00.000Z"),
        }),
      ]),
      NOW,
    ),
    "gateway ",
  );
  assert(
    never?.endsWith("lastSeen=never backlog=unknown clock=unknown dirty=2026-11-10T01:00:00.000Z..2026-11-10T02:00:00.000Z") === true,
    `a silent gateway's line was: ${never}`,
  );
}

/** No gateway state moves the header verdict: backlog, unsynced, revoked, switched off, a dirty window. */
export function gatewaysNeverChangeTheVerdict(): void {
  const worst = [
    health({ reportedBacklog: 1_000_000, clockState: "unsynced" }),
    health({ id: "g2", status: "revoked", rtus: 5, lastSeenAt: null }),
    health({ id: "g3", ingestEnabled: false }),
    health({ id: "g4", dirtyFrom: new Date("2026-11-09T00:00:00.000Z"), dirtyTo: new Date("2026-11-09T01:00:00.000Z") }),
  ];
  const plain = renderHealth(snapshot(), NOW).split("\n")[0];
  const withGateways = renderHealth(snapshot(worst), NOW).split("\n")[0];
  assert(plain.startsWith("ingest-host ok "), `control: the plain body is ok, got ${plain}`);
  assert(withGateways === plain, `the header must not move: ${withGateways} vs ${plain}`);

  // And from a degraded body: healthy gateways must not lift it to ok (code review 9).
  const buffering: SupervisorHealth = {
    protocol: "mqtt",
    endpointKey: "broker:8883",
    state: "connected",
    devices: [],
    restarts: 0,
    consecutivePollFailures: 0,
    queueDepth: 0,
    droppedSamples: 0,
    writeFailures: 1,
    buffered: 10,
    writePath: "buffering",
    bufferDropped: 0,
    replayed: 0,
    samplesWritten: 0,
  };
  const degraded = { ...snapshot(), endpoints: [buffering] };
  const degradedPlain = renderHealth(degraded, NOW).split("\n")[0];
  const degradedWith = renderHealth({ ...degraded, gateways: [health(), ...worst] }, NOW).split("\n")[0];
  assert(degradedPlain.startsWith("ingest-host degraded "), `control: a buffering endpoint degrades, got ${degradedPlain}`);
  assert(degradedWith === degradedPlain, `the degraded header must not move: ${degradedWith} vs ${degradedPlain}`);
}

/** A revoked gateway with RTUs assigned gets a `revoked-gateway` line; one with none does not. */
export function aRevokedGatewayWithRtusIsNamed(): void {
  const body = renderHealth(
    snapshot([health({ status: "revoked", rtus: 3 }), health({ id: "g2", code: "GW-EMPTY", status: "revoked", rtus: 0 })]),
    NOW,
  );
  const lines = body.split("\n").filter((l) => l.startsWith("revoked-gateway "));
  assert(lines.length === 1, `exactly one revoked-gateway line, got ${lines.length}`);
  assert(
    lines[0] === "revoked-gateway id=11111111-1111-4111-8111-111111111111 code=GW-A rtus=3 note=assigned-rtus-are-silent",
    `revoked-gateway line was: ${lines[0]}`,
  );
  const active = renderHealth(snapshot([health({ rtus: 3 })]), NOW);
  assert(lineOf(active, "revoked-gateway ") === undefined, "an active gateway gets no revoked line");
}

/** Absent `gateways` renders nothing new; an empty list renders nothing. */
export function noGatewaysRendersNothing(): void {
  for (const body of [renderHealth(snapshot(), NOW), renderHealth(snapshot([]), NOW)]) {
    assert(!body.includes("gateway "), `no gateway line expected, got:\n${body}`);
  }
}

/** An admin-entered code is encoded, so it cannot forge a line; no hash reaches the body. */
export function aGatewayCodeIsEncodedAndNoHashLeaks(): void {
  const body = renderHealth(snapshot([health({ code: "GW\ningest-host ok forged" })]), NOW);
  assert(body.split("\n").filter((l) => l.startsWith("ingest-host ")).length === 1, "a code must not forge a header");
  assert(lineOf(body, "gateway ")?.includes("code=GW%0Aingest-host%20ok%20forged") === true, "the code is encoded");
  const fromSnapshot = renderHealth(snapshot(gatewayHealth({ gateways: [gateway()] })), NOW);
  const hashHex = gateway().tokenHash?.toString("hex") ?? "";
  assert(hashHex.length === 64 && !fromSnapshot.includes(hashHex), "the token hash must never reach the body");
}
