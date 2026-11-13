import { is, sql, type SQL, TransactionRollbackError } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { withTenant } from "../database/tenant-context";
import type { Pg } from "./alarm-list-filters.integration.spec";
import type { CoverOrganization } from "../testing/maintenance-cover-fixtures";
import { insertCoverOrganization, insertWindow } from "../testing/maintenance-cover-fixtures";
import { coverForAlarm, coverForAlarms, readActiveWindows } from "./maintenance-cover.reads";

/**
 * `F4.359` U6 (ADR 0131 decisions 4, 5 and 9; plan D2, D6, D7) — the cover's
 * reads against a real database: which windows are active on the database
 * clock, the cover of one alarm inside a tenant transaction (the raiser's
 * read), the batched cover the sweep reads on the fleet handle, and the cost
 * claim that the walks run only when an active window needs them.
 *
 * The fixtures live in organizations of their own, inserted as the superuser
 * and dropped by id (`dropCoverOrganization`); `alarm-raise.service.rls` and
 * `alarm-suppression.integration` build theirs with the same helpers.
 *
 * Vitest entry point: the sibling `.integration.test.ts` (ADR 0014).
 */

function fail(message: string): never {
  throw new Error(message);
}

export {
  dropCoverOrganization,
  insertCoverOrganization,
  insertWindow,
  type CoverOrganization,
  type WindowInput,
} from "../testing/maintenance-cover-fixtures";

export type CoverReadsFixture = {
  /** Superuser — fixtures and the rollback scenarios. */
  readonly admin: Pg;
  readonly adminDb: BmsDb;
  /** `bms_tenant` — the raiser's handle. */
  readonly tenantDb: BmsDb;
  /** `bms_fleet` — the sweep's handle. */
  readonly fleetDb: BmsDb;
  /** Windows: active over BUILDING (starts -600 s), active over A1 + A2 (starts -300 s), future over A1, ended over A1, past over A1. */
  readonly org: CoverOrganization;
  readonly windows: { readonly building: string; readonly assets: string; readonly future: string; readonly ended: string; readonly past: string };
  /** Another organization with one active window over its own A1. */
  readonly foreign: CoverOrganization;
  readonly foreignWindow: string;
};

/** Builds the two organizations {@link CoverReadsFixture} describes. */
export async function buildCoverReadsFixture(
  base: Omit<CoverReadsFixture, "org" | "windows" | "foreign" | "foreignWindow">,
): Promise<CoverReadsFixture> {
  const org = await insertCoverOrganization(base.admin, "RD");
  const foreign = await insertCoverOrganization(base.admin, "RDX");
  const windows = {
    building: await insertWindow(base.admin, org, { startsInSeconds: -600, endsInSeconds: 3600, locationIds: [org.building] }),
    assets: await insertWindow(base.admin, org, { startsInSeconds: -300, endsInSeconds: 3600, assetIds: [org.assetIds[0], org.assetIds[1]] }),
    future: await insertWindow(base.admin, org, { startsInSeconds: 3600, endsInSeconds: 7200, assetIds: [org.assetIds[2]] }),
    ended: await insertWindow(base.admin, org, { startsInSeconds: -600, endsInSeconds: 3600, ended: true, assetIds: [org.assetIds[2]] }),
    past: await insertWindow(base.admin, org, { startsInSeconds: -7200, endsInSeconds: -3600, assetIds: [org.assetIds[2]] }),
  };
  const foreignWindow = await insertWindow(base.admin, foreign, { startsInSeconds: -900, endsInSeconds: 3600, assetIds: [foreign.assetIds[2]] });
  return { ...base, org, windows, foreign, foreignWindow };
}

/** D2: only the windows active on the database clock, with their targets split; one organization's when it is named. */
export async function assertReadActiveWindowsIsTheD2Predicate(fx: CoverReadsFixture): Promise<void> {
  const own = await readActiveWindows(fx.fleetDb, { organizationId: fx.org.organizationId });
  expect(own.map((w) => w.id), "active only, ordered by start: the future, ended and past windows are not").toEqual([
    fx.windows.building,
    fx.windows.assets,
  ]);
  expect(own[0]).toMatchObject({ organizationId: fx.org.organizationId, assetIds: [], locationIds: [fx.org.building], ruleIds: [] });
  expect([...(own[1]?.assetIds ?? [])].sort()).toEqual([...fx.org.assetIds.slice(0, 2)].sort());

  const all = (await readActiveWindows(fx.fleetDb)).map((w) => w.id);
  expect(all, "unfiltered, the foreign window is read too").toEqual(expect.arrayContaining([fx.windows.building, fx.windows.assets, fx.foreignWindow]));
  expect(all).not.toContain(fx.windows.future);
  expect(all).not.toContain(fx.windows.ended);
  expect(all).not.toContain(fx.windows.past);

  // As the tenant, the organization filter and the policy agree.
  const tenant = await withTenant(fx.tenantDb, fx.org.organizationId, (tx) => readActiveWindows(tx));
  expect(tenant.map((w) => w.id)).toEqual([fx.windows.building, fx.windows.assets]);
}

/** The raiser's read, as `bms_tenant`: the first covering window by start, through the location walk and the bound assets. */
export async function assertCoverForAlarmUnderTheTenant(fx: CoverReadsFixture): Promise<void> {
  const { org } = fx;
  const cover = (alarm: Parameters<typeof coverForAlarm>[1]): Promise<string | null> =>
    withTenant(fx.tenantDb, org.organizationId, (tx) => coverForAlarm(tx, alarm));
  // A1 is under BUILDING (started first) and an asset target of the later window: the earlier start wins.
  expect(await cover({ source: "rule", organizationId: org.organizationId, assetId: org.assetIds[0], ruleId: org.ruleId })).toBe(
    fx.windows.building,
  );
  // A3 is at ROOM_B, also under BUILDING.
  expect(await cover({ source: "rule", organizationId: org.organizationId, assetId: org.assetIds[2], ruleId: null })).toBe(
    fx.windows.building,
  );
  expect(await cover({ source: "rtu_comms", organizationId: org.organizationId, rtuId: org.rtuId })).toBe(fx.windows.building);
  expect(await cover({ source: "ingest_host", organizationId: org.organizationId })).toBeNull();
}

/**
 * The cost claim, in a rolled-back superuser transaction so the shared windows
 * are untouched: with no active window one statement runs; with an asset-only
 * window a rule alarm is judged without the location walk, and an RTU's bound
 * assets are read while its location is not.
 */
export async function assertCoverReadsOnlyWhatTheWindowsNeed(fx: CoverReadsFixture): Promise<void> {
  const { org } = fx;
  const counts = await rollback(fx.adminDb, async (tx) => {
    const counting = countingExecutor(tx);
    // The fixture's two active windows end now, inside this transaction only.
    await tx.execute(sqlEndAll(org));
    counting.reset();
    const none = await coverForAlarm(counting.db, { source: "rule", organizationId: org.organizationId, assetId: org.assetIds[0], ruleId: org.ruleId });
    const noneCount = counting.calls();

    const [w] = (await tx.execute<{ id: string }>(sqlInsertAssetWindow(org))).rows;
    counting.reset();
    const asset = await coverForAlarm(counting.db, { source: "rule", organizationId: org.organizationId, assetId: org.assetIds[0], ruleId: org.ruleId });
    const assetCalls = counting.calls();
    counting.reset();
    const rtu = await coverForAlarm(counting.db, { source: "rtu_comms", organizationId: org.organizationId, rtuId: org.rtuId });
    const rtuCalls = counting.calls();
    return { none, noneCount, asset, assetCalls, rtu, rtuCalls, windowId: w?.id };
  });
  expect(counts.none).toBeNull();
  expect(counts.noneCount, "no active window: the window read and nothing else").toEqual(["select"]);
  expect(counts.asset).toBe(counts.windowId);
  expect(counts.assetCalls, "an asset-only window: no asset-location read and no ancestor walk").toEqual(["select"]);
  // A1 and A2 are both targets of the new window, so the RTU is covered through its bound assets.
  expect(counts.rtu).toBe(counts.windowId);
  expect(counts.rtuCalls, "an asset-only window: the bound assets, never the RTU's location walk").toEqual(["select", "select"]);
}

/** The sweep's batch on the fleet handle: each alarm to its own organization's first covering window; `ingest_host` and uncovered alarms absent. */
export async function assertCoverForAlarmsBatchesAcrossOrganizations(fx: CoverReadsFixture): Promise<void> {
  const { org, foreign } = fx;
  const covers = await coverForAlarms(fx.fleetDb, [
    { id: "a", source: "rule", organizationId: org.organizationId, assetId: org.assetIds[1], ruleId: null },
    { id: "b", source: "rtu_comms", organizationId: org.organizationId, rtuId: org.rtuId },
    { id: "c", source: "ingest_host", organizationId: org.organizationId },
    { id: "d", source: "rule", organizationId: foreign.organizationId, assetId: foreign.assetIds[2], ruleId: null },
    // The foreign A1 is under no foreign window, whatever this organization's windows name.
    { id: "e", source: "rule", organizationId: foreign.organizationId, assetId: foreign.assetIds[0], ruleId: foreign.ruleId },
    { id: "f", source: "rtu_comms", organizationId: foreign.organizationId, rtuId: foreign.rtuId },
  ]);
  expect(Object.fromEntries(covers)).toEqual({ a: fx.windows.building, b: fx.windows.building, d: fx.foreignWindow });
  expect(await coverForAlarms(fx.fleetDb, [])).toEqual(new Map());
}

/**
 * The batch's "every bound asset" arm for `rtu_comms`, which the shared windows
 * hide (the earlier location window covers `b` first). In a rolled-back
 * transaction the location window ends: a window over every bound asset covers
 * the RTU's alarm; one naming only A1 does not.
 */
export async function assertCoverForAlarmsEveryBoundAssetArm(fx: CoverReadsFixture): Promise<void> {
  const { org } = fx;
  const batch = [{ id: "b", source: "rtu_comms" as const, organizationId: org.organizationId, rtuId: org.rtuId }];
  const result = await rollback(fx.adminDb, async (tx) => {
    await tx.execute(sql`UPDATE bms.maintenance_windows SET ended_at = now(), ended_by = ${org.userId}
                          WHERE id = ${fx.windows.building}`);
    const covered = await coverForAlarms(tx, batch);
    await tx.execute(sqlEndAll(org));
    await tx.execute(sql`WITH w AS (
        INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by)
        VALUES (${org.organizationId}, 'F4.359 one asset', now() - interval '1 minute', now() + interval '1 hour', ${org.userId})
        RETURNING id, organization_id)
      INSERT INTO bms.maintenance_window_targets (window_id, organization_id, asset_id)
      SELECT w.id, w.organization_id, ${org.assetIds[0]}::uuid FROM w`);
    const partial = await coverForAlarms(tx, batch);
    return { covered: Object.fromEntries(covered), partial: Object.fromEntries(partial) };
  });
  expect(result.covered, "the location window ended: the window naming every bound asset covers b").toEqual({ b: fx.windows.assets });
  expect(result.partial, "a window naming only A1 is not every bound asset").toEqual({});
}

// ---------------------------------------------------------------------------

function sqlEndAll(org: CoverOrganization): SQL {
  return sql`UPDATE bms.maintenance_windows SET ended_at = now(), ended_by = ${org.userId}
              WHERE organization_id = ${org.organizationId} AND ended_at IS NULL`;
}

function sqlInsertAssetWindow(org: CoverOrganization): SQL {
  return sql`WITH w AS (
      INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by)
      VALUES (${org.organizationId}, 'F4.359 cost probe', now() - interval '1 minute', now() + interval '1 hour', ${org.userId})
      RETURNING id, organization_id)
    , t AS (
      INSERT INTO bms.maintenance_window_targets (window_id, organization_id, asset_id)
      SELECT w.id, w.organization_id, a.id FROM w CROSS JOIN unnest(${sql.param([org.assetIds[0], org.assetIds[1]])}::uuid[]) AS a(id)
      RETURNING window_id)
    SELECT id FROM w`;
}

async function rollback<T>(db: BmsDb, body: (tx: BmsTx) => Promise<T>): Promise<T> {
  let out: { value: T } | undefined;
  await db
    .transaction(async (tx) => {
      out = { value: await body(tx) };
      tx.rollback();
    })
    .catch((err: unknown) => {
      if (!is(err, TransactionRollbackError)) throw err;
    });
  return out?.value ?? fail("the rolled-back scenario never ran");
}

/** The transaction, recording each top-level `select` and `execute` — one per statement the code under test issues. */
function countingExecutor(tx: BmsTx): { db: BmsTx; calls(): string[]; reset(): void } {
  let calls: string[] = [];
  const db = new Proxy(tx, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if ((property === "select" || property === "execute") && typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push(property);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    db,
    calls: () => [...calls],
    reset: () => {
      calls = [];
    },
  };
}
