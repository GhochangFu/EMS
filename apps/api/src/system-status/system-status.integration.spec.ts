import { randomUUID } from "node:crypto";

import { inArray, sql } from "drizzle-orm";

import { assets, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { LivenessResponse, StorageHealth, SystemStatusResponse } from "@bms/shared";

import type { QueueHealthService } from "../queue/queue-health.service";
import type { StorageHealthService } from "../storage/storage-health.service";
import { countingDb } from "../testing/counting-db";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { withRollback } from "../testing/with-rollback";
import { SystemStatusService } from "./system-status.service";

/**
 * `F3.30` (ADR 0075 decisions 1, 3) — `SystemStatusService.read` against a
 * real database. Assertions live here; the sibling `.test.ts` is the Vitest
 * entry point (ADR 0014) and owns the pool.
 *
 * **Rollback-isolated.** Every case builds its scene inside one
 * `withRollback` transaction and ends with `tx.rollback()`, so the RTUs,
 * assets and samples it writes never survive. The service is constructed over
 * that transaction for both pools, so its `withReadScope` / `withTenant`
 * transactions nest as savepoints and read the uncommitted scene. Samples are
 * stamped `now() - make_interval(...)` inside the same transaction, so a 5 s
 * sample is 5 s old to the service's query exactly.
 *
 * **The scene**, at the seeded fixture location:
 *
 * | asset | RTU `source_type` | streaming |
 * |-------|-------------------|-----------|
 * | A     | `mqtt`            | yes       |
 * | B     | `simulator`       | yes       |
 * | C     | none              | no        |
 *
 * Each case adds only its own samples. Queue and storage are fakes with fixed
 * bodies; both read `ok` unless the case says otherwise, so the verdict turns
 * on `field_data` alone.
 *
 * **The ingest host** (`F3.16`, ADR 0127 decision 21). The scene inserts its
 * own `bms.ingest_hosts` row (`f330ss-<run>`, beating at `now()`, healthy for
 * an hour) and a `bms.rtu_health` row that has the mqtt RTU monitored by it
 * for an hour and never heard. So `field_data` follows that host, never any
 * other host row the database holds, and `devices` reads `{ 1, 1 }` for a
 * scope holding A. A case moves the beat with {@link setHostBeat}.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Tx = Parameters<Parameters<BmsDb["transaction"]>[0]>[0];

interface Scene {
  readonly tx: Tx;
  readonly hostKey: string;
  readonly mqttRtuId: string;
  readonly a: string;
  readonly b: string;
  readonly c: string;
}

const HEALTHY_LIVENESS: LivenessResponse = {
  status: "ok",
  queue: {
    configured: true,
    connected: true,
    queues: [],
    lastHeartbeatAt: "2026-09-25T12:00:00.000Z",
    heartbeatStale: false,
    lastRuleSweep: null,
  },
};

const HEALTHY_STORAGE: StorageHealth = { configured: true, reachable: true, bucket: "fixture" };

function fakeQueue(body: LivenessResponse): QueueHealthService {
  return { read: async () => body } as unknown as QueueHealthService;
}

function fakeStorage(body: StorageHealth): StorageHealthService {
  return { read: async () => body } as unknown as StorageHealthService;
}

function serviceOver(db: BmsDb, queue: LivenessResponse = HEALTHY_LIVENESS): SystemStatusService {
  return new SystemStatusService(db, db, fakeQueue(queue), fakeStorage(HEALTHY_STORAGE));
}

async function buildScene(tx: Tx): Promise<Scene> {
  const txDb = tx as unknown as BmsDb;
  const run = randomUUID().replace(/-/g, "").slice(0, 12);
  const location = await fixtureLocation(txDb);
  const [mqttRtu, simRtu] = await tx
    .insert(rtus)
    .values([
      {
        organizationId: location.organizationId,
        locationId: location.locationId,
        code: `F330SS-${run}-M`,
        displayName: `F330SS ${run} mqtt RTU`,
        sourceType: "mqtt",
        // F4.350 (ADR 0075 Amendment 3): the real MQTT devices report every 60 s, so the window is 150 s.
        expectedIntervalSeconds: 60,
      },
      {
        organizationId: location.organizationId,
        locationId: location.locationId,
        code: `F330SS-${run}-S`,
        displayName: `F330SS ${run} simulator RTU`,
        sourceType: "simulator",
      },
    ])
    .returning({ id: rtus.id });
  assert(mqttRtu !== undefined && simRtu !== undefined, "the two fixture RTUs insert");

  const [a, b, c] = (await createFixtureAssets(txDb, 3, "F330SS", location)) as [string, string, string];
  await tx
    .update(assets)
    .set({ rtuId: mqttRtu?.id as string })
    .where(inArray(assets.id, [a]));
  await tx
    .update(assets)
    .set({ rtuId: simRtu?.id as string })
    .where(inArray(assets.id, [b]));
  const hostKey = `f330ss-${run}`;
  await tx.execute(sql`
    INSERT INTO bms.ingest_hosts (host_key, started_at, healthy_since, last_beat_at)
    VALUES (${hostKey}, now() - interval '1 hour', now() - interval '1 hour', now())
  `);
  await tx.execute(sql`
    INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, monitored_since)
    VALUES (${mqttRtu?.id as string}, ${location.organizationId}, ${hostKey}, now() - interval '1 hour')
  `);
  return { tx, hostKey, mqttRtuId: mqttRtu?.id as string, a, b, c };
}

/** Moves the scene host's last beat to `ageSeconds` before the transaction's `now()`. */
async function setHostBeat(scene: Scene, ageSeconds: number): Promise<void> {
  await scene.tx.execute(sql`
    UPDATE bms.ingest_hosts SET last_beat_at = now() - make_interval(secs => ${ageSeconds}) WHERE host_key = ${scene.hostKey}
  `);
}

/** Inserts one sample `ageSeconds` old, relative to the transaction's `now()` — `temp_c` unless a key is given. */
async function addSample(scene: Scene, assetId: string, ageSeconds: number, pointKey = "temp_c"): Promise<void> {
  await scene.tx.execute(sql`
    INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
    VALUES (now() - make_interval(secs => ${ageSeconds}), ${assetId}, ${pointKey}, 1)
  `);
}

async function withScene(db: BmsDb, check: (scene: Scene) => Promise<void>): Promise<void> {
  await withRollback(db, async (tx) => {
    await check(await buildScene(tx));
    tx.rollback();
  });
}

function fieldData(response: SystemStatusResponse): string | undefined {
  return response.components.find((c) => c.key === "field_data")?.state;
}

function summary(response: SystemStatusResponse): string {
  return JSON.stringify({
    status: response.status,
    components: response.components,
    dq: response.dataQuality,
    devices: response.devices,
  });
}

/** Case 1 — A (mqtt) fresh, B (simulator) silent, C not streaming. */
export async function assertOneFreshOfTwoStreaming(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 5);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    assert(
      r.dataQuality.streamingAssets === 2 &&
        r.dataQuality.freshAssets === 1 &&
        r.dataQuality.percent === 50 &&
        r.dataQuality.windowSeconds === 25 &&
        fieldData(r) === "ok" &&
        r.status === "operational",
      `expected streaming 2, fresh 1, 50 %, window 25 (the floor), field_data ok, operational; got ${summary(r)}`,
    );
  });
}

/**
 * Case 2 — `F3.16` (ADR 0127 decision 21): the ingest host last beat 31 s ago,
 * past the 30 s stale bound, so `field_data` is degraded although A's sample
 * is fresh; with the host's row gone (`never`) it is degraded too.
 */
export async function assertStaleHostIsDegraded(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 5);
    await setHostBeat(scene, 30);
    const atBound = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    await setHostBeat(scene, 31);
    const stale = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    await scene.tx.execute(sql`DELETE FROM bms.ingest_hosts WHERE host_key = ${scene.hostKey}`);
    const absent = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    assert(
      fieldData(atBound) === "ok" &&
        stale.dataQuality.freshAssets === 1 &&
        fieldData(stale) === "degraded" &&
        stale.status === "degraded" &&
        fieldData(absent) === "degraded",
      `expected ok at 30 s, degraded at 31 s with A fresh, degraded with no host row; got ` +
        `${summary(atBound)} / ${summary(stale)} / ${summary(absent)}`,
    );
  });
}

/** Case 3 — scope [B]: B fresh on a simulator RTU, so no mqtt asset is in scope. */
export async function assertNoMqttInScopeIsNotMonitored(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.b, 5);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.b]);
    // F3.16: B's simulator RTU is not monitored and A's monitored RTU is out of scope, so no device counts.
    assert(
      fieldData(r) === "not_monitored" &&
        r.dataQuality.percent === 100 &&
        r.status === "operational" &&
        r.devices.monitored === 0 &&
        r.devices.offline === 0,
      `expected field_data not_monitored, 100 %, operational, devices 0/0; got ${summary(r)}`,
    );
  });
}

/** Case 4 — scope [C]: C has no RTU, so nothing streams. */
export async function assertNoRtuIsNotStreaming(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.c, 5);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.c]);
    assert(
      r.dataQuality.streamingAssets === 0 &&
        r.dataQuality.percent === null &&
        fieldData(r) === "not_monitored",
      `expected streaming 0, percent null, field_data not_monitored; got ${summary(r)}`,
    );
  });
}

/**
 * Case 5 — scope []: the same answer as case 4, and no query runs. The
 * positive control is the same counting service reading [A] first, which must
 * open a transaction.
 */
export async function assertEmptyScopeRunsNoQuery(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const counted = countingDb(scene.tx as unknown as BmsDb);
    const service = serviceOver(counted.db);
    await service.read([scene.a]);
    const afterControl = counted.transactions();
    assert(afterControl >= 1, `control: a non-empty scope must open a transaction, got ${afterControl}`);
    const r = await service.read([]);
    assert(
      counted.transactions() === afterControl &&
        r.dataQuality.streamingAssets === 0 &&
        r.dataQuality.freshAssets === 0 &&
        r.dataQuality.percent === null &&
        fieldData(r) === "not_monitored",
      `expected no new transaction (${afterControl} → ${counted.transactions()}), streaming 0, ` +
        `fresh 0, percent null, field_data not_monitored; got ${summary(r)}`,
    );
  });
}

/** Case 6 — a stale queue heartbeat degrades the verdict while field data is ok. */
export async function assertStaleQueueDegradesTheVerdict(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 5);
    const staleQueue: LivenessResponse = {
      ...HEALTHY_LIVENESS,
      status: "degraded",
      queue: { ...HEALTHY_LIVENESS.queue, heartbeatStale: true },
    };
    const r = await serviceOver(scene.tx as unknown as BmsDb, staleQueue).read([scene.a, scene.b, scene.c]);
    const expected = JSON.stringify([
      { key: "queue", state: "degraded" },
      { key: "storage", state: "ok" },
      { key: "field_data", state: "ok" },
    ]);
    assert(
      JSON.stringify(r.components) === expected && r.status === "degraded",
      `expected components ${expected} and status degraded; got ${summary(r)}`,
    );
  });
}

/**
 * Case 7 — `F3.16` (ADR 0127 decision 21): the host beats, A (mqtt) is silent
 * and B (simulator) is fresh. Silent devices no longer degrade `field_data`:
 * it reads ok, data quality is 50 %, and the silent monitored RTU is the one
 * offline device (never heard, monitored for an hour, window 150 s).
 */
export async function assertFreshHostWithSilentDevicesIsOk(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.b, 5);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    assert(
      r.dataQuality.percent === 50 &&
        fieldData(r) === "ok" &&
        r.status === "operational" &&
        r.devices.monitored === 1 &&
        r.devices.offline === 1,
      `expected 50 %, field_data ok, operational, devices 1/1; got ${summary(r)}`,
    );
  });
}

/**
 * Case 7b — `F3.16`: the monitored RTU heard 60 s ago is Online in its 150 s
 * window (60 <= 0.6 x 150), so `devices` reads 1 monitored, 0 offline.
 */
export async function assertRecentlyHeardRtuIsNotOffline(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await scene.tx.execute(sql`
      UPDATE bms.rtu_health SET last_seen_at = now() - make_interval(secs => 60) WHERE rtu_id = ${scene.mqttRtuId}
    `);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a]);
    assert(
      r.devices.monitored === 1 && r.devices.offline === 0,
      `expected devices 1/0; got ${summary(r)}`,
    );
  });
}

/**
 * Case 8 — security L1: A (mqtt) fresh 5 s but outside the scope; the scope
 * is [B], and B's only sample is 200 s old, beyond the 150 s reporting
 * window. A must reach neither count: no
 * mqtt asset is in scope, nothing in scope is fresh, and B alone streams —
 * the positive control that the scoped read ran at all.
 */
export async function assertOutOfScopeFreshMqttIsNotCounted(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 5);
    await addSample(scene, scene.b, 200);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.b]);
    assert(
      r.dataQuality.streamingAssets === 1 &&
        r.dataQuality.freshAssets === 0 &&
        fieldData(r) === "not_monitored",
      `expected streaming 1, fresh 0, field_data not_monitored; got ${summary(r)}`,
    );
  });
}

/**
 * Case 9 — no fan-out: A carries three samples of different point keys
 * inside the window and still counts as one fresh asset. `reporting` is
 * `SELECT DISTINCT asset_id`, so the `LEFT JOIN` yields one row per asset.
 */
export async function assertThreeSamplesCountOneFreshAsset(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 5, "temp_c");
    await addSample(scene, scene.a, 4, "humidity_pct");
    await addSample(scene, scene.a, 3, "kw");
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a]);
    assert(
      r.dataQuality.freshAssets === 1 && r.dataQuality.streamingAssets === 1,
      `expected fresh 1 of streaming 1; got ${summary(r)}`,
    );
  });
}

/**
 * Case 10 — ADR 0075 Amendment 3: A's only sample is 60 s old, one real MQTT
 * reporting interval, and A's RTU is configured `expectedIntervalSeconds: 60`.
 * It is outside the 25 s floor but inside A's own 150 s window, so the status
 * read counts A as reporting. Case 1 holds `windowSeconds` (the floor).
 */
export async function assertSixtySecondMqttSampleIsReporting(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    await addSample(scene, scene.a, 60);
    const r = await serviceOver(scene.tx as unknown as BmsDb).read([scene.a, scene.b, scene.c]);
    assert(
      r.dataQuality.streamingAssets === 2 &&
        r.dataQuality.freshAssets === 1 &&
        fieldData(r) === "ok" &&
        r.status === "operational",
      `expected streaming 2, fresh 1, field_data ok, operational; got ${summary(r)}`,
    );
  });
}
