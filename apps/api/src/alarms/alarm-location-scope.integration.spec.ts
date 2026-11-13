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
 * `F4.359` U5 (owner ruling Q4, ADR 0131 decision 19): one active,
 * unacknowledged `high` alarm at S and one cleared `high` alarm at S carry a
 * suppression stamp (a real window row of A, for the foreign key).
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
    /** U2b: an active, acknowledged `high` alarm at S. */
    readonly ackedS: string;
    /** U2b: an active, unacknowledged `lowest` alarm at S. */
    readonly infoS: string;
    /** F4.359 U5: an active, unacknowledged `high` alarm at S, stamped by a maintenance window. */
    readonly suppressedS: string;
    /** F4.359 U5: a cleared `high` alarm at S that a window had stamped. */
    readonly clearedSuppressedS: string;
  };
  readonly high: string;
  readonly low: string;
  /** U2b: the lowest-ranked severity (`info` in the seed), below `low`. */
  readonly lowest: string;
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
  const { rows: lowestRows } = await db.query<{ code: string }>(
    "SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank ASC LIMIT 1",
  );
  const lowest = lowestRows[0]?.code ?? fail("bms.alarm_severities is empty — run pnpm db:seed");
  if (lowest === low || lowest === high) fail("need three active alarm_severities rows — run pnpm db:seed");
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
    ackedS: await insertAlarm(db, orgA, { assetId: asset.S, severity: high, raisedAt: minutesAgo(4), acknowledgedAt: minutesAgo(2) }),
    infoS: await insertAlarm(db, orgA, { assetId: asset.S, severity: lowest, raisedAt: minutesAgo(3) }),
    suppressedS: await insertAlarm(db, orgA, { assetId: asset.S, severity: high, raisedAt: minutesAgo(1) }),
    clearedSuppressedS: await insertAlarm(db, orgA, { assetId: asset.S, severity: high, raisedAt: minutesAgo(40), clearedAt: minutesAgo(35) }),
  };
  const { rows: userRows } = await db.query<{ id: string }>("SELECT id FROM bms.users LIMIT 1");
  const userId = userRows[0]?.id ?? fail("need a users row — run pnpm db:seed");
  const { rows: windowRows } = await db.query<{ id: string }>(
    `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by)
     VALUES ($1, 'F4.359 U5', now() - interval '1 hour', now() + interval '1 hour', $2) RETURNING id`,
    [orgA, userId],
  );
  const windowId = windowRows[0]?.id ?? fail("the maintenance window was not inserted");
  await db.query(
    "UPDATE bms.alarms SET suppressed_at = now(), suppressed_by_window_id = $1 WHERE id = ANY($2::uuid[])",
    [windowId, [alarm.suppressedS, alarm.clearedSuppressedS]],
  );
  return { svc, orgA, orgB, site: { S, C, T, U }, asset, alarm, high, low, lowest };
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

/** The S subtree's active alarms: S's four (the suppressed one too), C and C's RTU — not T, not the host alarm, not B. */
const subtreeOfS = (fx: LocationScopeFixture): string[] =>
  sorted([fx.alarm.S, fx.alarm.ackedS, fx.alarm.infoS, fx.alarm.suppressedS, fx.alarm.C, fx.alarm.comms]);

/** F4.359 U5 (ADR 0131 decision 19): the summary counts the subtree less its suppressed alarm. */
const countedInS = (fx: LocationScopeFixture): string[] => subtreeOfS(fx).filter((id) => id !== fx.alarm.suppressedS);

/** 1 — the positive neighbour: `organizationId` A, no location, lists every active A alarm. */
export async function assertTheOrganizationListsEveryActiveAlarm(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, organizationId: fx.orgA })).toEqual(
    sorted([fx.alarm.S, fx.alarm.ackedS, fx.alarm.infoS, fx.alarm.suppressedS, fx.alarm.C, fx.alarm.T, fx.alarm.comms, fx.alarm.host]),
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

/**
 * 4 — the summary for S agrees with claim 2 less the suppressed alarm, per
 * severity; a severity with no alarm keeps its row at 0.
 */
export async function assertTheSiteSummaryAgreesWithTheList(fx: LocationScopeFixture): Promise<void> {
  const summary = await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S));
  expect(summary.total).toBe(countedInS(fx).length);
  const counts = countsOf(summary);
  expect({ high: counts[fx.high], low: counts[fx.low], lowest: counts[fx.lowest] }).toEqual({ high: 3, low: 1, lowest: 1 });
  const child = countsOf(await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.C)));
  expect(child[fx.lowest], "C has no info alarm: the row stays, at 0").toBe(0);
}

/** 5 — a scoped caller (the S asset only) at S sees the S alarms only; the comms alarm stays hidden. */
export async function assertTheReadScopeStillBinds(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: [fx.asset.S], location: adminAt(fx.site.S) })).toEqual(
    sorted([fx.alarm.S, fx.alarm.ackedS, fx.alarm.infoS, fx.alarm.suppressedS]),
  );
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
  expect(summary.total).toBe(countedInS(fx).length);
}

/** 9 — `location` S with `organizationId` B: the two narrowings meet in nothing. */
export async function assertALocationOfAnotherOrganizationAnswersNothing(fx: LocationScopeFixture): Promise<void> {
  expect(await listedIds(fx, { assetIds: null, location: adminAt(fx.site.S), organizationId: fx.orgB })).toEqual([]);
  expect((await fx.svc.activeCountsBySeverity(null, fx.orgB, adminAt(fx.site.S))).total).toBe(0);
}

/*
 * `F4.357` U2b (plan Q1 ruling) — the unacknowledged read: active and not
 * acknowledged, ordered by severity rank then newest; `minSeverityRank`; and
 * the summary's per-severity `unacknowledged` count.
 */

async function unacknowledgedAt(fx: LocationScopeFixture, locationId: string, minSeverityRank?: number): Promise<string[]> {
  const page = await fx.svc.list({
    limit: 50,
    state: "unacknowledged",
    assetIds: null,
    location: adminAt(locationId),
    ...(minSeverityRank === undefined ? {} : { minSeverityRank }),
  });
  return page.items.map((item) => item.id);
}

/** 10 — S's unacknowledged alarms: no acknowledged one; critical, then warning, then info; newest first in a rank. */
export async function assertTheUnacknowledgedReadOrdersByRankThenNewest(fx: LocationScopeFixture): Promise<void> {
  // comms (high, 6 min ago) is newer than S (high, 10 min ago); C (low) is newer than S but ranks lower.
  expect(await unacknowledgedAt(fx, fx.site.S)).toEqual([fx.alarm.comms, fx.alarm.S, fx.alarm.C, fx.alarm.infoS]);
}

/** 11 — `minSeverityRank` 20 drops the info alarm and keeps the rest in order. */
export async function assertMinSeverityRankDropsLowerRanks(fx: LocationScopeFixture): Promise<void> {
  expect(await unacknowledgedAt(fx, fx.site.S, 20)).toEqual([fx.alarm.comms, fx.alarm.S, fx.alarm.C]);
}

/** 12 — the summary's `unacknowledged` for the high severity at S is its `count` less the acknowledged one. */
export async function assertTheSummaryCountsTheUnacknowledged(fx: LocationScopeFixture): Promise<void> {
  const row = (await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S))).items.find((item) => item.code === fx.high);
  expect({ count: row?.count, unacknowledged: row?.unacknowledged }).toEqual({ count: 3, unacknowledged: 2 });
}

/** 13 — a cleared, unacknowledged alarm (C's) is in neither the unacknowledged list nor the counts. */
export async function assertAClearedAlarmIsNotUnacknowledged(fx: LocationScopeFixture): Promise<void> {
  expect(await unacknowledgedAt(fx, fx.site.C)).toEqual([fx.alarm.comms, fx.alarm.C]);
  const row = (await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.C))).items.find((item) => item.code === fx.high);
  expect({ count: row?.count, unacknowledged: row?.unacknowledged }).toEqual({ count: 1, unacknowledged: 1 });
}

/*
 * `F4.359` U5 (owner ruling Q4, ADR 0131 decision 19) — the suppressed state.
 * `state=suppressed` is active and stamped; `unacknowledged` leaves a stamped
 * alarm out; `active` and `all` keep it; the summary's `count` and
 * `unacknowledged` leave it out and its `suppressed` counts it.
 */

async function idsIn(
  fx: LocationScopeFixture,
  state: "all" | "active" | "unacknowledged" | "suppressed",
  opts: { assetIds?: string[] | null; locationId?: string } = {},
): Promise<string[]> {
  const page = await fx.svc.list({
    limit: 100,
    state,
    assetIds: opts.assetIds ?? null,
    location: adminAt(opts.locationId ?? fx.site.S),
  });
  return page.items.map((item) => item.id).sort();
}

/** 14 — `suppressed` at S lists the stamped active alarm alone; at the organization too. */
export async function assertTheSuppressedStateListsTheStampedAlarmAlone(fx: LocationScopeFixture): Promise<void> {
  expect(await idsIn(fx, "suppressed")).toEqual([fx.alarm.suppressedS]);
  const page = await fx.svc.list({ limit: 100, state: "suppressed", assetIds: null, organizationId: fx.orgA });
  expect(page.items.map((item) => item.id)).toEqual([fx.alarm.suppressedS]);
  expect(page.items[0]?.suppressed).toBe(true);
}

/** 15 — `unacknowledged` omits the stamped alarm, which is otherwise active and not acknowledged. */
export async function assertUnacknowledgedOmitsTheSuppressedAlarm(fx: LocationScopeFixture): Promise<void> {
  const unacknowledged = await idsIn(fx, "unacknowledged");
  expect(unacknowledged, "the positive neighbour: S's own unacknowledged alarm").toContain(fx.alarm.S);
  expect(unacknowledged).not.toContain(fx.alarm.suppressedS);
}

/** 16 — `active` and `all` keep the stamped alarm. */
export async function assertActiveAndAllKeepTheSuppressedAlarm(fx: LocationScopeFixture): Promise<void> {
  expect(await idsIn(fx, "active")).toContain(fx.alarm.suppressedS);
  expect(await idsIn(fx, "all")).toContain(fx.alarm.suppressedS);
}

/**
 * 17 — the summary at S: the high `count` and `unacknowledged` each leave the
 * stamped alarm out (the active list holds four high alarms, three of them
 * unacknowledged), `suppressed` is 1, and `total` is the sum of the counts.
 */
export async function assertTheSummaryLeavesTheSuppressedAlarmOut(fx: LocationScopeFixture): Promise<void> {
  const summary = await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S));
  const row = summary.items.find((item) => item.code === fx.high);
  expect({ count: row?.count, unacknowledged: row?.unacknowledged }).toEqual({ count: 3, unacknowledged: 2 });
  expect(summary.suppressed).toBe(1);
  expect(summary.total).toBe(countedInS(fx).length);
  expect(summary.total).toBe(summary.items.reduce((sum, item) => sum + item.count, 0));
}

/** 18 — a cleared stamped alarm is in `all` only: not `suppressed`, not `active`, not counted. */
export async function assertAClearedSuppressedAlarmIsInAllOnly(fx: LocationScopeFixture): Promise<void> {
  expect(await idsIn(fx, "all")).toContain(fx.alarm.clearedSuppressedS);
  expect(await idsIn(fx, "suppressed")).not.toContain(fx.alarm.clearedSuppressedS);
  expect(await idsIn(fx, "active")).not.toContain(fx.alarm.clearedSuppressedS);
  expect((await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S))).suppressed).toBe(1);
}

/** 19 — the tenant path (every A asset) and the fleet path agree on the list and the summary. */
export async function assertTheTenantAndFleetPathsAgreeOnSuppression(fx: LocationScopeFixture): Promise<void> {
  for (const state of ["suppressed", "unacknowledged", "active", "all"] as const) {
    expect(await idsIn(fx, state, { assetIds: assetsOfA(fx) }), state).toEqual(await idsIn(fx, state));
  }
  const fleet = await fx.svc.activeCountsBySeverity(null, undefined, adminAt(fx.site.S));
  const tenant = await fx.svc.activeCountsBySeverity(assetsOfA(fx), undefined, adminAt(fx.site.S));
  expect(tenant).toEqual(fleet);
  expect(tenant.suppressed).toBe(1);
}
