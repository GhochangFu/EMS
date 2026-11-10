import { NOTIFY_LIVE_WINDOW_MS, type UplinkBatch, type UplinkSample } from "@bms/shared/ingest";

import type { EdgeServed } from "./binding-targets.js";
import { createHostLogger } from "./logger.js";
import { assert } from "./normaliser.spec.js";
import type { PointTarget } from "./normaliser.js";
import { createUplinkReceiver, type ReceiverClient } from "./uplink-receiver.js";
import { gateway } from "./uplink-gateways.spec.js";
import { fakeTx } from "./uplink-write.spec.js";

/**
 * `E7.2` / ADR 0123 decision 4, plan T3.2–T3.3 — the receiver end to end on a
 * fake client: screening, the gateway's own point index, the write, and the
 * `200` body's counts.
 *
 * Assertions live here; `uplink-receiver.test.ts` is the vitest entry point
 * (ADR 0014).
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const GW = gateway();

function target(assetId: string, pointKey: string): PointTarget {
  return {
    assetId,
    pointKey,
    unit: "kW",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  };
}

const SERVED: EdgeServed = new Map([
  [
    GW.id,
    {
      deviceKeys: new Set(["RTU-1"]),
      pointIndex: new Map([["RTU-1", new Map([["kw", [target("asset-1", "KW")]]])]]),
    },
  ],
]);

function wire(overrides: Partial<UplinkSample> = {}): UplinkSample {
  return {
    protocol: "mqtt",
    sourceKey: "kw",
    value: 12.5,
    deviceKey: "RTU-1",
    rx: new Date(NOW.getTime() - 1_000).toISOString(),
    ...overrides,
  };
}

function batch(...samples: UplinkSample[]): UplinkBatch {
  return { v: 1, sentAt: NOW.toISOString(), backlog: false, buffered: 7, clock: "synced", samples };
}

function harness(options: { failOn?: RegExp; served?: EdgeServed } = {}) {
  const tx = fakeTx(options.failOn === undefined ? {} : { failOn: options.failOn });
  let released = 0;
  const lines: string[] = [];
  const client: ReceiverClient = {
    query: (text, values) => tx.client.query(text, values),
    release: () => {
      released += 1;
    },
  };
  const receive = createUplinkReceiver({
    now: () => NOW,
    edgeServed: () => options.served ?? SERVED,
    connect: async () => client,
    liveWindowMs: NOTIFY_LIVE_WINDOW_MS,
    logger: createHostLogger({}, (line) => lines.push(line)),
  });
  return { receive, calls: tx.calls, lines, released: () => released };
}

/** A good sample is resolved through the gateway's own index and counted `accepted`. */
export async function aGoodSampleIsWrittenAndAccepted(): Promise<void> {
  const h = harness();
  const response = await h.receive(GW, batch(wire()));
  assert(response.accepted === 1, `accepted must be 1, got ${response.accepted}`);
  const { foreignDevice, futureRx, tooOld, unresolved } = response.rejected;
  assert(foreignDevice + futureRx + tooOld + unresolved === 0, "nothing rejected");
  const upsert = h.calls.find((c) => c.text.startsWith("INSERT INTO telemetry.point_values"));
  assert(upsert?.values?.[1] === "asset-1" && upsert.values[2] === "KW", "the row targets the gateway's point");
  const time = upsert?.values?.[0];
  assert(
    time instanceof Date && time.getTime() === NOW.getTime() - 1_000,
    "time must be the sample's rx",
  );
  assert(h.released() === 1, "the client must be released once");
}

/** Every reason is counted in the body, and the batch still resolves (answers 200). */
export async function everyRejectionIsCounted(): Promise<void> {
  const h = harness();
  const response = await h.receive(
    GW,
    batch(
      wire(),
      wire({ deviceKey: "RTU-OTHER" }),
      wire({ rx: new Date(NOW.getTime() + 120_000).toISOString() }),
      wire({ rx: "2026-10-01T00:00:00.000Z" }),
      wire({ sourceKey: "unmapped" }),
    ),
  );
  const r = response.rejected;
  assert(response.accepted === 1, "one sample accepted");
  assert(r.foreignDevice === 1 && r.futureRx === 1 && r.tooOld === 1 && r.unresolved === 1, `counts ${JSON.stringify(r)}`);
  const warn = h.lines.find((l) => l.includes("uplink samples rejected")) ?? "";
  assert(warn !== "", "a rejection is logged");
  assert(!warn.includes("unmapped") && !warn.includes("RTU-OTHER"), "the log line carries counts, never keys");
}

/** A gateway the plan has no entry for (no RTUs yet) writes nothing and still records the gateway. */
export async function aGatewayWithNoRtusCountsEverythingForeign(): Promise<void> {
  const h = harness({ served: new Map() });
  const response = await h.receive(GW, batch(wire(), wire()));
  assert(response.accepted === 0 && response.rejected.foreignDevice === 2, "both samples foreign");
  assert(
    h.calls.some((c) => c.text.includes("UPDATE bms.edge_gateways")),
    "the gateway's report is still recorded",
  );
}

/** A failed write rejects (the listener answers 503) and the client is still released. */
export async function aFailedWriteRejectsAndReleases(): Promise<void> {
  const h = harness({ failOn: /INSERT INTO telemetry/ });
  let threw = false;
  try {
    await h.receive(GW, batch(wire()));
  } catch {
    threw = true;
  }
  assert(threw, "a failed write must reject");
  assert(h.released() === 1, "the client must be released after a failure");
}

/** A batch of late rows logs the not-notified count. */
export async function lateRowsAreLoggedAsNotNotified(): Promise<void> {
  const h = harness();
  await h.receive(GW, batch(wire({ rx: new Date(NOW.getTime() - 4 * 3_600_000).toISOString() })));
  assert(
    h.lines.some((l) => l.includes("not notified") && l.includes('"rowsNotNotified":1')),
    "a late row must be logged as not notified",
  );
  assert(!h.calls.some((c) => c.text.includes("pg_notify")), "a 4 h old row is not notified");
}
