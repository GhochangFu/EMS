import { expect } from "vitest";

import type { AlarmSummaryResponse } from "@bms/shared";

import type { AlarmLocationFilter } from "./alarm-location-scope";
import {
  dropOrganization,
  insertAlarm,
  insertAsset,
  insertLocationRow,
  insertOrganization,
  twoSeverities,
  type Pg,
} from "./alarm-list-filters.integration.spec";
import type { AlarmsService } from "./alarms.service";

/**
 * `F4.357` U2 (ADR 0130 decision 15) — `locationId` on `AlarmsService.list` and
 * `activeCountsBySeverity` against a real database: the alarms of a location
 * and every location under it, inside the caller's read scope.
 *
 * Fixture, in two fresh organizations (inserted as the superuser, dropped by id):
 * organization A with site S, child C under S, sibling site T; organization B
 * with site U. Active rule alarms on an asset at S, at C, at T, at U; a cleared
 * rule alarm at C; an RTU at C (with a second C asset on it, so a caller of the
 * A assets reads its comms alarm) holding an open `rtu_comms` alarm; an open
 * `ingest_host` alarm of A. A rule alarm belongs to its asset's location, an
 * `rtu_comms` alarm to its RTU's, an `ingest_host` alarm to no location.
 *
 * The service runs on the real `bms_tenant` / `bms_fleet` pair. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */

export type LocationScopeFixture = {
  readonly svc: AlarmsService;
  readonly orgA: string;
  readonly orgB: string;
  readonly site: { readonly S: string; readonly C: string; readonly T: string; readonly U: string };
  readonly asset: { readonly S: string; readonly C: string; readonly onRtu: string; readonly T: string; readonly U: string };
  readonly alarm: {
    readonly S: string;
    readonly C: string;
    readonly T: string;
    readonly U: string;
    readonly clearedC: string;
    readonly comms: string;
    readonly host: string;
  };
  readonly high: string;
  readonly low: string;
};

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Builds the fixture. `created` receives each organization id as soon as it is
 * inserted, so the suite drops it even when a later insert throws.
 */
export async function buildLocationScopeFixture(
  db: Pg,
  run: string,
  svc: AlarmsService,
  created: (organizationId: string) => void,
): Promise<LocationScopeFixture> {
  const { high, low } = await twoSeverities(db);
  const orgA = await insertOrganization(db, `F4357-A-${run}`);
  created(orgA);
  const orgB = await insertOrganization(db, `F4357-B-${run}`);
  created(orgB);
  const S = await insertLocationRow(db, { organizationId: orgA, code: `F4357-S-${run}`, name: "F4.357 S", parentId: null });
  const C = await insertLocationRow(db, { organizationId: orgA, code: `F4357-C-${run}`, name: "F4.357 C", parentId: S });
  const T = await insertLocationRow(db, { organizationId: orgA, code: `F4357-T-${run}`, name: "F4.357 T", parentId: null });
  const U = await insertLocationRow(db, { organizationId: orgB, code: `F4357-U-${run}`, name: "F4.357 U", parentId: null });
  const at = (organizationId: string, locationId: string, code: string) =>
    insertAsset(db, { organizationId, locationId, code: `F4357-${code}-${run}`, name: `F4.357 ${code}` });
  const asset = {
    S: await at(orgA, S, "AS"),
    C: await at(orgA, C, "AC"),
    onRtu: await at(orgA, C, "AR"),
    T: await at(orgA, T, "AT"),
    U: await at(orgB, U, "AU"),
  };
  const { rows: rtuRows } = await db.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name) VALUES ($1, $2, $3, 'F4.357 RTU') RETURNING id`,
    [orgA, C, `F4357-R-${run}`],
  );
  const rtuId = rtuRows[0]?.id ?? fail("the RTU was not inserted");
  await db.query("UPDATE bms.assets SET rtu_id = $1 WHERE id = $2", [rtuId, asset.onRtu]);
  const now = Date.now();
  const minutesAgo = (n: number) => new Date(now - n * 60_000);
  const deviceAlarm = async (source: "rtu_comms" | "ingest_host", severity: string, raisedAt: Date) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO bms.alarms (organization_id, source, rtu_id, severity, message, raised_at)
       VALUES ($1, $2, $3, $4, 'F4.357 device alarm', $5) RETURNING id`,
      [orgA, source, source === "rtu_comms" ? rtuId : null, severity, raisedAt],
    );
    return rows[0]?.id ?? fail(`the ${source} alarm was not inserted`);
  };
  const alarm = {
    S: await insertAlarm(db, orgA, { assetId: asset.S, severity: high, raisedAt: minutesAgo(10) }),
    C: await insertAlarm(db, orgA, { assetId: asset.C, severity: low, raisedAt: minutesAgo(9) }),
    T: await insertAlarm(db, orgA, { assetId: asset.T, severity: high, raisedAt: minutesAgo(8) }),
    U: await insertAlarm(db, orgB, { assetId: asset.U, severity: high, raisedAt: minutesAgo(7) }),
    clearedC: await insertAlarm(db, orgA, { assetId: asset.C, severity: high, raisedAt: minutesAgo(30), clearedAt: minutesAgo(20) }),
    comms: await deviceAlarm("rtu_comms", high, minutesAgo(6)),
    host: await deviceAlarm("ingest_host", low, minutesAgo(5)),
  };
  return { svc, orgA, orgB, site: { S, C, T, U }, asset, alarm, high, low };
}

/** Every row of both organizations, the RTU included (it holds a location). */
export async function dropLocationScopeFixture(db: Pg, organizationId: string): Promise<void> {
  await db.query("DELETE FROM bms.alarms WHERE organization_id = $1", [organizationId]);
  await db.query("UPDATE bms.assets SET rtu_id = NULL WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.rtus WHERE organization_id = $1", [organizationId]);
  await dropOrganization(db, organizationId);
}

/** The unrestricted admin's filter: both readable sets `null`. */
const adminAt = (id: string): AlarmLocationFilter => ({ id, readableLocationIds: null, readableOrganizationIds: null });

/** Every A asset — a single-organization scope, so `withReadScope` takes the tenant path. */
const assetsOfA = (fx: LocationScopeFixture): string[] => [fx.asset.S, fx.asset.C, fx.asset.onRtu, fx.asset.T];

async function listedIds(
  fx: LocationScopeFixture,
  opts: { assetIds: string[] | null; location?: AlarmLocationFilter; organizationId?: string },
): Promise<string[]> {
  const page = await fx.svc.list({ limit: 100, state: "active", ...opts });
  return page.items.map((item) => item.id).sort();
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

function countsOf(summary: AlarmSummaryResponse): Record<string, number> {
  return Object.fromEntries(summary.items.map((row) => [row.code, row.count]));
}

/** The S subtree's active alarms: S, C and C's RTU — not T, not the host alarm, not B. */
const subtreeOfS = (fx: LocationScopeFixture): string[] => sorted([fx.alarm.S, fx.alarm.C, fx.alarm.comms]);

/** 1 — the positive neighbour: `organizationId` A, no location, lists every active A alarm. */
export async function assertTheOrganizationListsEveryActiveAlarm(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, organizationId: fx.orgA })).toEqual(
    sorted([fx.alarm.S, fx.alarm.C, fx.alarm.T, fx.alarm.comms, fx.alarm.host]),
  );
}

/** 2 — `location` S: the subtree's rule alarms and the RTU's comms alarm (fleet path). */
export async function assertTheSiteListsItsSubtree(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, location: adminAt(fx.site.S) })).toEqual(subtreeOfS(fx));
}

/** 3 — `location` C: C's rule alarm and C's comms alarm only. */
export async function assertTheChildListsItselfOnly(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, location: adminAt(fx.site.C) })).toEqual(sorted([fx.alarm.C, fx.alarm.comms]));
}

/** 4 — the summary for S agrees with claim 2, per severity; a severity with no alarm keeps its row at 0. */
export async function assertTheSiteSummaryAgreesWithTheList(fx: LocationScopeFixture): Promise<void> {
  const summary = await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S));
  expect(summary.total).toBe(subtreeOfS(fx).length);
  const counts = countsOf(summary);
  expect({ high: counts[fx.high], low: counts[fx.low] }).toEqual({ high: 2, low: 1 });
  for (const row of summary.items.filter((item) => item.code !== fx.high && item.code !== fx.low)) {
    expect(row.count, `${row.code} keeps its row at 0`).toBe(0);
  }
}

/** 5 — a scoped caller (the S asset only) at S sees the S alarm only; the comms alarm stays hidden. */
export async function assertTheReadScopeStillBinds(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: [fx.asset.S], location: adminAt(fx.site.S) })).toEqual([fx.alarm.S]);
}

/** 6 — owner ruling P2: a caller who reads C but not S, asking for S, gets nothing — list and summary. */
export async function assertAnUnreadableAncestorAnswersNothing(fx: LocationScopeFixture): Promise<void> {
  const location: AlarmLocationFilter = { id: fx.site.S, readableLocationIds: [fx.site.C], readableOrganizationIds: [fx.orgA] };
  const control = await listedIds(fx, {
    assetIds: [fx.asset.C],
    location: { id: fx.site.C, readableLocationIds: [fx.site.C], readableOrganizationIds: [fx.orgA] },
  });
  expect(control, "the positive neighbour: the caller reads C's alarm at C").toEqual([fx.alarm.C]);
  expect(await listedIds(fx, { assetIds: [fx.asset.C], location })).toEqual([]);
  expect((await fx.svc.activeCountsBySeverity([fx.asset.C], undefined, location)).total).toBe(0);
}

/** 7 — cross-tenant: B's site U, with A as the only readable organization, answers empty. */
export async function assertAForeignSiteAnswersNothing(fx: LocationScopeFixture): Promise<void> {
  const location: AlarmLocationFilter = { id: fx.site.U, readableLocationIds: null, readableOrganizationIds: [fx.orgA] };
  expect(await listedIds(fx, { assetIds: null, location: adminAt(fx.site.U) }), "the positive neighbour").toEqual([fx.alarm.U]);
  expect(await listedIds(fx, { assetIds: null, location })).toEqual([]);
  expect((await fx.svc.activeCountsBySeverity(null, undefined, location)).total).toBe(0);
}

/** 8 — claims 2 and 4 on the tenant path: a single-organization scope (every A asset). */
export async function assertTheSubtreeHoldsOnTheTenantPath(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: assetsOfA(fx), location: adminAt(fx.site.S) })).toEqual(subtreeOfS(fx));
  const summary = await fx.svc.activeCountsBySeverity(assetsOfA(fx), undefined, adminAt(fx.site.S));
  expect(summary.total).toBe(subtreeOfS(fx).length);
}

/** 9 — `location` S with `organizationId` B: the two narrowings meet in nothing. */
export async function assertALocationOfAnotherOrganizationAnswersNothing(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, location: adminAt(fx.site.S), organizationId: fx.orgB })).toEqual([]);
  expect((await fx.svc.activeCountsBySeverity(null, fx.orgB, adminAt(fx.site.S))).total).toBe(0);
}
