import {
  createDeviceHealth,
  type DeviceHealth,
  hourOf,
  monitoredRtuIds,
  RESTORE_MAX_HOURS,
} from "./device-health.js";
import type { DeviceActivity, DropTallies, DropTally } from "./normaliser.js";

/**
 * `F3.16` / ADR 0127 decisions 9, 10 and 17 — the in-memory accumulator the
 * flush timer drains. Pure: the clock is a variable here, so every timing rule
 * is asserted without waiting.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const BOOT = new Date("2026-11-11T10:59:50.000Z");
const FLUSH_MS = 10_000;

function clock(start: Date): { now: () => Date; advance: (ms: number) => void; set: (d: Date) => void } {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
    set: (d) => {
      t = d.getTime();
    },
  };
}

function tally(count: number, firstAt: Date, first: Partial<DropTally["first"]> = {}): DropTally {
  return {
    count,
    firstAt,
    first: { assetId: null, pointKey: null, sourceKey: null, deviceKey: null, ...first },
  };
}

function activity(lastReceivedAt: Date, drops: DropTallies = {}, skew: DeviceActivity["skew"] = null): DeviceActivity {
  return { lastReceivedAt, skew, drops };
}

const RTU_IDS: Record<string, string> = { "RTU-1": "rtu-1", "RTU-2": "rtu-2" };

function record(
  health: DeviceHealth,
  devices: Record<string, DeviceActivity>,
  unattributed: DropTallies = {},
  endpointKey = "mqtts://broker:8883",
): void {
  health.record({
    endpointKey,
    rtuIdOf: (deviceKey) => RTU_IDS[deviceKey],
    result: { devices: new Map(Object.entries(devices)), unattributed },
  });
}

/** Batches sum into the hour of their receive time; the first point in the hour is kept; `drain` empties. */
export function runAccumulateAndDrainTests(): void {
  const c = clock(BOOT);
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  const at1059 = new Date("2026-11-11T10:59:58.000Z");
  const at1100 = new Date("2026-11-11T11:00:03.000Z");
  record(health, {
    "RTU-1": activity(at1059, { outOfRange: tally(2, at1059, { assetId: "a-1", pointKey: "LEVEL", sourceKey: "lvl" }) }),
  });
  record(health, {
    "RTU-1": activity(new Date(at1059.getTime() + 1_000), {
      outOfRange: tally(3, at1059, { assetId: "a-2", pointKey: "OTHER", sourceKey: "oth" }),
    }),
  });
  record(health, {
    "RTU-1": activity(at1100, { outOfRange: tally(1, at1100, { assetId: "a-3", pointKey: "NEXT" }) }),
    "RTU-9": activity(at1100, { badQuality: tally(1, at1100) }),
  });
  record(health, {}, { unknownDevice: tally(4, at1059, { deviceKey: "STRANGER", sourceKey: "kw" }) });

  c.set(new Date("2026-11-11T11:00:05.000Z"));
  const flush = health.drain();
  const ten = flush.drops.find((d) => d.bucket.getTime() === hourOf(at1059).getTime());
  assert(ten?.dropped === 5, `the two 10:00 batches sum to 5, got ${ten?.dropped}`);
  assert(ten?.firstAssetId === "a-1" && ten.firstPointKey === "LEVEL", `the first point in the hour is kept: ${JSON.stringify(ten)}`);
  const eleven = flush.drops.find((d) => d.bucket.getTime() === hourOf(at1100).getTime());
  assert(eleven?.dropped === 1 && eleven.firstPointKey === "NEXT", "11:00 is its own bucket");
  assert(flush.drops.length === 2, `an unmapped device key (RTU-9) records nothing, got ${flush.drops.length} rows`);
  assert(flush.rtus.length === 1 && flush.rtus[0].rtuId === "rtu-1", "only the mapped RTU");
  assert(flush.rtus[0].lastSeenAt.getTime() === at1100.getTime(), "last-seen is the newest receive time");
  assert(flush.endpointDrops.length === 1, "one endpoint bucket");
  const ep = flush.endpointDrops[0];
  assert(
    ep.endpointKey === "mqtts://broker:8883" && ep.reason === "unknownDevice" && ep.dropped === 4 &&
      ep.firstDeviceKey === "STRANGER" && ep.firstSourceKey === "kw",
    `the unattributed bucket: ${JSON.stringify(ep)}`,
  );
  assert(flush.host.hostKey === "cloud" && flush.host.beatAt.getTime() === c.now().getTime(), "the beat is now");

  const empty = health.drain();
  assert(
    empty.rtus.length === 0 && empty.drops.length === 0 && empty.endpointDrops.length === 0,
    "drain empties the accumulator",
  );
}

/** Skew is the newest device time, in whole seconds, positive when the device is ahead. */
export function runSkewTests(): void {
  const c = clock(BOOT);
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  const rx = new Date("2026-11-11T11:00:00.000Z");
  record(health, { "RTU-1": activity(rx, {}, { deviceTime: new Date(rx.getTime() + 90_400), receivedAt: rx }) });
  const older = new Date(rx.getTime() - 5_000);
  record(health, { "RTU-1": activity(older, {}, { deviceTime: new Date(older.getTime() - 3_600_000), receivedAt: older }) });
  const [row] = health.drain().rtus;
  assert(row.clockSkewSeconds === 90 && row.clockSkewAt?.getTime() === rx.getTime(), `newest skew wins: ${JSON.stringify(row)}`);
  record(health, { "RTU-2": activity(rx) });
  const [none] = health.drain().rtus;
  assert(none.clockSkewSeconds === null && none.clockSkewAt === null, "no device time: no skew");
  record(health, { "RTU-2": activity(rx, {}, { deviceTime: new Date(-8.64e15), receivedAt: rx }) });
  const [clamped] = health.drain().rtus;
  assert(clamped.clockSkewSeconds === -2_147_483_648, `skew is clamped to int4, got ${clamped.clockSkewSeconds}`);
}

/** `restore` merges a failed flush back, keeps the earlier first point, and drops buckets past the bound. */
export function runRestoreTests(): void {
  const c = clock(new Date("2026-11-12T12:00:00.000Z"));
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  const recent = new Date("2026-11-12T11:30:00.000Z");
  const ancient = new Date(recent.getTime() - (RESTORE_MAX_HOURS + 1) * 3_600_000);
  record(health, {
    "RTU-1": activity(recent, {
      badQuality: tally(2, recent, { assetId: "a-old", pointKey: "OLD" }),
    }),
    "RTU-2": activity(ancient, { badQuality: tally(7, ancient) }),
  });
  const failed = health.drain();
  record(health, {
    "RTU-1": activity(new Date(recent.getTime() + 1_000), {
      badQuality: tally(3, new Date(recent.getTime() + 1_000), { assetId: "a-new", pointKey: "NEW" }),
    }),
  });
  const { discarded } = health.restore(failed);
  assert(discarded === 7, `the bucket older than ${RESTORE_MAX_HOURS} h is dropped and counted, got ${discarded}`);
  const next = health.drain();
  const bucket = next.drops.find((d) => d.rtuId === "rtu-1");
  assert(bucket?.dropped === 5, `restored and new sum, got ${bucket?.dropped}`);
  assert(bucket?.firstPointKey === "OLD", "the restored (earlier) first point is kept");
  assert(!next.drops.some((d) => d.rtuId === "rtu-2"), "the ancient bucket is gone");
  assert(next.rtus.find((r) => r.rtuId === "rtu-1")?.lastSeenAt.getTime() === recent.getTime() + 1_000, "last-seen merges by max");
  assert(next.rtus.some((r) => r.rtuId === "rtu-2"), "last-seen is restored even when its drops were too old");
}

/** `healthy_since` starts at boot and restarts after a missed beat; a failed flush is not a beat. */
export function runHeartbeatTests(): void {
  const c = clock(BOOT);
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  c.advance(FLUSH_MS);
  const first = health.drain();
  assert(first.host.startedAt.getTime() === BOOT.getTime(), "started_at is boot");
  assert(first.host.healthySince.getTime() === BOOT.getTime(), "healthy since boot");
  health.committed(first);

  c.advance(FLUSH_MS);
  const second = health.drain();
  assert(second.host.healthySince.getTime() === BOOT.getTime(), "an on-time beat keeps healthy_since");
  health.restore(second);

  // The flush failed: the next one, 25 s after the last committed beat, finds a gap.
  c.advance(15_000);
  const late = health.drain();
  assert(late.host.healthySince.getTime() === c.now().getTime(), `a missed beat restarts healthy_since: ${late.host.healthySince.toISOString()}`);
  health.committed(late);
  c.advance(FLUSH_MS);
  assert(health.drain().host.healthySince.getTime() === late.host.beatAt.getTime(), "and it holds from there");
}

/** `monitored_since` is stamped on plan entry and cleared on exit; the boot plan is a full sweep. */
export function runPlanTests(): void {
  const c = clock(BOOT);
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  health.planChanged(["rtu-1", "rtu-2"], 2);
  const boot = health.drain();
  assert(boot.host.endpoints === 2, "endpoints from the plan");
  assert(
    boot.monitoring.entered.map((e) => e.rtuId).sort().join() === "rtu-1,rtu-2" &&
      boot.monitoring.entered.every((e) => e.since.getTime() === BOOT.getTime()),
    `both enter at boot: ${JSON.stringify(boot.monitoring.entered)}`,
  );
  assert(boot.monitoring.keep?.slice().sort().join() === "rtu-1,rtu-2", "the first plan is a full sweep");
  health.committed(boot);

  c.advance(FLUSH_MS);
  assert(health.drain().monitoring.entered.length === 0, "an unchanged plan stamps nothing");

  health.planChanged(["rtu-2", "rtu-3"], 1);
  const reload = health.drain();
  assert(reload.monitoring.entered.map((e) => e.rtuId).join() === "rtu-3", "rtu-3 enters");
  assert(reload.monitoring.exited.join() === "rtu-1", "rtu-1 exits");
  assert(reload.monitoring.keep === null, "a reload is a delta, not a sweep");

  // A failed flush puts the delta back, unless the plan moved on meanwhile.
  health.planChanged(["rtu-2"], 1);
  health.restore(reload);
  const after = health.drain();
  assert(after.monitoring.entered.length === 0, `rtu-3 left again: no stamp, got ${JSON.stringify(after.monitoring.entered)}`);
  assert(after.monitoring.exited.slice().sort().join() === "rtu-1,rtu-3", "both exits are written");
}

/** A 200-character source key is cut to 128, and a newline is stripped. */
export function runLabelCleaningTests(): void {
  const c = clock(BOOT);
  const health = createDeviceHealth({ hostKey: "cloud", now: c.now, flushMs: FLUSH_MS });
  record(
    health,
    { "RTU-1": activity(BOOT, { unmappedSourceKey: tally(1, BOOT, { sourceKey: "s".repeat(200) }) }) },
    { unknownDevice: tally(1, BOOT, { deviceKey: "bad\nkey", sourceKey: "x\r\ny" }) },
    `edge:${"e".repeat(300)}`,
  );
  const flush = health.drain();
  assert(flush.drops[0].firstSourceKey?.length === 128, `cut to 128, got ${flush.drops[0].firstSourceKey?.length}`);
  assert(
    flush.endpointDrops[0].firstDeviceKey === "badkey" && flush.endpointDrops[0].firstSourceKey === "xy",
    `newlines stripped: ${JSON.stringify(flush.endpointDrops[0])}`,
  );
  assert(flush.endpointDrops[0].endpointKey.length === 255, "the endpoint key fits varchar(255)");
}

/** The monitored set is every cloud binding plus every edge-served RTU. */
export function runMonitoredRtuIdsTests(): void {
  const binding = (rtuId: string) => ({ rtuId, rtuCode: rtuId, deviceKey: rtuId, device: {}, sourceKeys: [] });
  const ids = monitoredRtuIds(
    [{ bindings: [binding("a"), binding("b")] }, { bindings: [binding("c")] }],
    new Map([["gw", { deviceKeys: new Set(["E"]), rtuIdByDeviceKey: new Map([["E", "e"]]), pointIndex: new Map() }]]),
  );
  assert(ids.slice().sort().join() === "a,b,c,e", `cloud and edge RTUs: ${ids.join()}`);
}
