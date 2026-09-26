import { EventEmitter } from "node:events";

import type { TelemetryReading } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { MetricsService } from "../observability/metrics.service";
import { ExistingAssetIds } from "./existing-asset-ids";
import type { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";
import { TelemetryGateway } from "./telemetry.gateway";

/**
 * `F4.159` post-merge review — the socket filter for readings of an asset id
 * with no `bms.assets` row. The cache is driven by a fake clock and a fake
 * load, so each case controls when a reload starts and what it returns. The
 * last case wires the filter through a real `TelemetryGateway` with a fake hub
 * and socket, which is the only gate on the gateway calling it at all.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const A = "00000000-0000-4000-8000-00000000000a";
const NEW = "00000000-0000-4000-8000-00000000000b";
const ORPHAN = "00000000-0000-4000-8000-00000000000c";

const reading = (assetId: string, value = 1): TelemetryReading => ({
  time: "2026-09-26T00:00:00.000Z",
  assetId,
  pointKey: "kw",
  value,
  unit: "kW",
});

const ids = (rs: readonly TelemetryReading[]): string => rs.map((r) => r.assetId).join(",");

/** A cache whose loads return `sets` in order (the last repeats), on a clock the case moves. */
function harness(sets: ReadonlyArray<ReadonlySet<string> | Error>) {
  let t = 1_000_000;
  let loads = 0;
  const errors: unknown[] = [];
  const cache = new ExistingAssetIds({
    load: async () => {
      const next = sets[Math.min(loads, sets.length - 1)];
      loads += 1;
      if (next instanceof Error) {
        throw next;
      }
      return next as ReadonlySet<string>;
    },
    now: () => t,
    maxAgeMs: 60_000,
    unknownReloadMs: 5_000,
    onLoadError: (err) => errors.push(err),
  });
  return {
    cache,
    advance: (ms: number) => {
      t += ms;
    },
    loads: () => loads,
    errors,
  };
}

/** Before the first load completes every reading is forwarded, orphans included (fail-open). */
export async function assertForwardsEverythingBeforeTheFirstLoad(): Promise<void> {
  const h = harness([new Set([A])]);
  const got = h.cache.filter([reading(A), reading(ORPHAN)]);
  assert(ids(got) === `${A},${ORPHAN}`, `the first batch must pass whole, got ${ids(got)}`);
}

/** Once the set has loaded, a reading of an id with no asset row is dropped. */
export async function assertDropsAnOrphanReadingOnceLoaded(): Promise<void> {
  const h = harness([new Set([A])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  const got = h.cache.filter([reading(A), reading(ORPHAN)]);
  assert(!got.some((r) => r.assetId === ORPHAN), `the orphan reading must be dropped, got ${ids(got)}`);
}

/** Positive control: an existing asset's reading is forwarded once the set has loaded. */
export async function assertForwardsAnExistingAssetsReading(): Promise<void> {
  const h = harness([new Set([A])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  const got = h.cache.filter([reading(A), reading(ORPHAN)]);
  assert(ids(got) === A, `the existing asset's reading must pass, got ${ids(got)}`);
}

/** A new asset: its first batch after the rate limit starts a reload, and the next batch reaches the socket. */
export async function assertANewAssetIsForwardedAfterOneReload(): Promise<void> {
  const h = harness([new Set([A]), new Set([A, NEW])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  h.advance(5_000);
  h.cache.filter([reading(NEW)]);
  await h.cache.settled();
  const got = h.cache.filter([reading(NEW)]);
  assert(ids(got) === NEW, `a new asset must reach the socket after one reload, got ${ids(got)}`);
}

/** An unknown id inside the rate limit does not reload — a deleted asset that keeps writing cannot reload every batch. */
export async function assertAnUnknownIdReloadsAtMostOncePerInterval(): Promise<void> {
  const h = harness([new Set([A])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  h.advance(4_999);
  h.cache.filter([reading(ORPHAN)]);
  await h.cache.settled();
  assert(h.loads() === 1, `an unknown id 4999 ms after a load must not reload, loads = ${h.loads()}`);
}

/** A deleted asset is still known until the periodic reload; after it, its readings are dropped. */
export async function assertADeletedAssetLeavesOnThePeriodicReload(): Promise<void> {
  const h = harness([new Set([A, ORPHAN]), new Set([A])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  h.advance(60_000);
  h.cache.filter([reading(ORPHAN)]);
  await h.cache.settled();
  const got = h.cache.filter([reading(ORPHAN)]);
  assert(got.length === 0, `a deleted asset must be dropped after the periodic reload, got ${ids(got)}`);
}

/** A failed first load forwards everything and reports the error. */
export async function assertAFailedFirstLoadFailsOpen(): Promise<void> {
  const h = harness([new Error("database unavailable")]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  const got = h.cache.filter([reading(A), reading(ORPHAN)]);
  assert(ids(got) === `${A},${ORPHAN}` && h.errors.length === 1, `a failed load must forward all and report once, got ${ids(got)} with ${h.errors.length} errors`);
}

/**
 * Two batches while a load is in flight start one load, not two — even when the
 * clock has passed `maxAgeMs` between them, so the rate limit alone cannot
 * be what holds the second one back.
 */
export async function assertOneLoadAtATime(): Promise<void> {
  const h = harness([new Set([A])]);
  h.cache.filter([reading(A)]);
  h.advance(60_000);
  h.cache.filter([reading(ORPHAN)]);
  await h.cache.settled();
  assert(h.loads() === 1, `two batches during one load must not start a second, loads = ${h.loads()}`);
}

/** The gateway sends a global socket the filtered batch, not the raw one. */
export async function assertTheGatewayFiltersBeforeItEmits(): Promise<void> {
  const h = harness([new Set([A])]);
  h.cache.filter([reading(A)]);
  await h.cache.settled();
  const hub = new EventEmitter() as unknown as TelemetryBroadcastHub;
  const metrics = { countWebsocketEvent: () => undefined, countTelemetryReadings: () => undefined } as unknown as MetricsService;
  const gateway = new TelemetryGateway(
    hub,
    metrics,
    {} as JwtAuthGuard,
    {} as AccessControlService,
    h.cache,
  );
  const sent: TelemetryReading[][] = [];
  const socket = { data: { assetIds: null }, emit: (_: string, payload: { readings: TelemetryReading[] }) => sent.push(payload.readings) };
  (gateway as unknown as { server: { sockets: Map<string, unknown> } }).server = { sockets: new Map([["s1", socket]]) };
  gateway.afterInit();
  (hub as unknown as EventEmitter).emit("readings", [reading(A, 7), reading(ORPHAN, 1000)]);
  assert(sent.length === 1 && ids(sent[0] ?? []) === A, `a global socket must get only the existing asset's reading, got ${JSON.stringify(sent.map(ids))}`);
}
