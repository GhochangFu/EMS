import type pg from "pg";

import { insertAsset, insertLocationRow, insertOrganization, type Pg } from "../alarms/alarm-list-filters.integration.spec";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { LocationSummaryService, type LocationSummaryRow } from "./location-summary.service";
import { energyReportRange } from "./reports.service";

/**
 * `F4.290` PR 2 (ADR 0099 Amendment 9 E4) — `LocationSummaryService` over a
 * real database. Assertions; the Vitest entry point (and the fixture's
 * lifecycle) is the sibling `.test.ts`.
 *
 * The fixture is a fresh organization O of its own, so "the roots of the
 * whole organization" are the fixture's roots and no seeded row is read:
 *
 *     O:  S ── C ── G     T        V (inactive)        P:  U
 *        A1 A2  A3         A4       A5                       A6
 *
 * The roots S and T are named so their name order is the reverse of their id
 * order (`first` is the root with the larger id and the earlier name).
 * `kw` on day D (two days ago, UTC): A1 10 at 10:15 and 20 at 11:15, A3 5 at
 * 10:30; no other asset has telemetry. Alarms on A1: `critical` raised D
 * 10:00 and open, `warning` raised D 11:00 and cleared D 12:00, and
 * `critical` raised D − 3 days and open (outside the range).
 */

function fail(message: string): never {
  throw new Error(message);
}

export interface SummaryFixture {
  readonly svc: LocationSummaryService;
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly site: string;
  readonly child: string;
  /** C's child, no assets: a scope of S and G only has a gap at C. */
  readonly grandchild: string;
  readonly sibling: string;
  readonly inactive: string;
  readonly foreign: string;
  /** The root whose name sorts first (it holds the larger id). */
  readonly first: string;
  readonly second: string;
  readonly assets: { readonly a1: string; readonly a2: string; readonly a3: string; readonly a4: string; readonly a5: string };
  readonly a2Code: string;
  readonly day: string;
  readonly allAssets: readonly string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Builds the fixture as the superuser (`admin`); `created` receives each
 * organization id as soon as it is inserted, so the suite drops it even when a
 * later insert throws.
 */
export async function buildSummaryFixture(
  admin: pg.Pool,
  svc: LocationSummaryService,
  run: string,
  created: (organizationId: string) => void,
): Promise<SummaryFixture> {
  const db: Pg = admin;
  const organizationId = await insertOrganization(db, `F4290-${run}-O`);
  created(organizationId);
  const otherOrganizationId = await insertOrganization(db, `F4290-${run}-P`);
  created(otherOrganizationId);
  const location = (tag: string, parentId: string | null, org = organizationId) =>
    insertLocationRow(db, { organizationId: org, code: `F4290-${run}-${tag}`, name: `F4.290 ${run} ${tag}`, parentId });
  const site = await location("S", null);
  const child = await location("C", site);
  const grandchild = await location("G", child);
  const sibling = await location("T", null);
  const inactive = await location("V", null);
  const foreign = await location("U", null, otherOrganizationId);
  await db.query("UPDATE bms.locations SET active = false WHERE id = $1", [inactive]);
  const [first, second] = site > sibling ? [site, sibling] : [sibling, site];
  await db.query("UPDATE bms.locations SET name = $2 WHERE id = $1", [first, `F4.290 ${run} Alpha`]);
  await db.query("UPDATE bms.locations SET name = $2 WHERE id = $1", [second, `F4.290 ${run} Beta`]);

  const asset = (tag: string, locationId: string, org = organizationId) =>
    insertAsset(db, { organizationId: org, locationId, code: `F4290-${run}-${tag}`, name: `F4.290 ${tag}` });
  const a1 = await asset("A1", site);
  const a2 = await asset("A2", site);
  const a3 = await asset("A3", child);
  const a4 = await asset("A4", sibling);
  const a5 = await asset("A5", inactive);
  await asset("A6", foreign, otherOrganizationId);

  const dayStart = Math.floor(Date.now() / DAY) * DAY - 2 * DAY;
  const at = (hours: number) => new Date(dayStart + hours * HOUR).toISOString();
  await db.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a, 'kw', v, 'kW' FROM unnest($1::timestamptz[], $2::uuid[], $3::float8[]) AS x(t, a, v)`,
    [[at(10.25), at(11.25), at(10.5)], [a1, a1, a3], [10, 20, 5]],
  );
  await db.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'critical', 'F4.290 fixture', $3, NULL),
            ($1, $2, 'warning', 'F4.290 fixture', $4, $5),
            ($1, $2, 'critical', 'F4.290 fixture', $6, NULL)`,
    [organizationId, a1, at(10), at(11), at(12), at(-72)],
  );
  await materializeCompleteBuckets(admin, dayStart - DAY, dayStart + 2 * DAY, Date.now());
  return {
    svc,
    organizationId,
    otherOrganizationId,
    site,
    child,
    grandchild,
    sibling,
    inactive,
    foreign,
    first,
    second,
    assets: { a1, a2, a3, a4, a5 },
    a2Code: `F4290-${run}-A2`,
    day: new Date(dayStart).toISOString().slice(0, 10),
    allAssets: [a1, a2, a3, a4, a5],
  };
}

/** Telemetry first (time-bounded), the aggregates re-covered, then the organizations' rows by id. */
export async function dropSummaryFixture(admin: pg.Pool, organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return;
  const dayStart = Math.floor(Date.now() / DAY) * DAY - 2 * DAY;
  // The ids first, then a constant segmentby filter (ADR 0024: no subquery in a telemetry DELETE).
  const { rows: assetRows } = await admin.query<{ id: string }>(
    "SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])",
    [organizationIds],
  );
  await admin.query(
    `DELETE FROM telemetry.point_values
      WHERE asset_id = ANY($1::uuid[])
        AND time >= $2::timestamptz AND time < $3::timestamptz`,
    [assetRows.map((r) => r.id), new Date(dayStart - DAY).toISOString(), new Date(dayStart + 2 * DAY).toISOString()],
  );
  await materializeCompleteBuckets(admin, dayStart - DAY, dayStart + 2 * DAY, Date.now());
  for (const id of organizationIds) {
    await admin.query("DELETE FROM bms.alarms WHERE organization_id = $1", [id]);
    await admin.query("DELETE FROM bms.assets WHERE organization_id = $1", [id]);
    await admin.query("DELETE FROM bms.locations WHERE organization_id = $1 AND parent_id IS NOT NULL", [id]);
    await admin.query("DELETE FROM bms.locations WHERE organization_id = $1", [id]);
    const { rowCount } = await admin.query("DELETE FROM bms.organizations WHERE id = $1", [id]);
    if (rowCount !== 1) fail(`organization ${id}: deleted ${String(rowCount)}, expected 1`);
  }
}

const fixtureScope = (fx: SummaryFixture) => [fx.site, fx.child, fx.sibling, fx.inactive];

async function defaultRows(fx: SummaryFixture, readable: readonly string[] = fx.allAssets): Promise<LocationSummaryRow[]> {
  const rows = await fx.svc.rows(fx.organizationId, fixtureScope(fx));
  if (!rows.ok) fail(`the default rows were refused: ${rows.reason}`);
  return fx.svc.summarise(fx.organizationId, rows.rows, readable, energyReportRange({ startDate: fx.day, endDate: fx.day }));
}

function rowOf(rows: readonly LocationSummaryRow[], id: string): LocationSummaryRow {
  return rows.find((row) => row.id === id) ?? fail(`no row for ${id} in ${JSON.stringify(rows)}`);
}

/** (1) No locationIds: the roots of the readable scope, in name order — not C (a child), not V (inactive). */
export async function assertTheDefaultRowsAreTheReadableRootsInNameOrder(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, fixtureScope(fx));
  const ids = rows.ok ? rows.rows.map((row) => row.id) : rows.reason;
  if (JSON.stringify(ids) !== JSON.stringify([fx.first, fx.second])) fail(`rows: ${JSON.stringify(ids)}, expected [first, second]`);
}

/** (2) The global admin's scope (`null`): every root of the organization, and not P's. */
export async function assertTheUnrestrictedRowsAreTheOrganizationsRoots(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, null);
  const ids = rows.ok ? rows.rows.map((row) => row.id) : rows.reason;
  if (JSON.stringify(ids) !== JSON.stringify([fx.first, fx.second])) fail(`rows: ${JSON.stringify(ids)}, expected [first, second]`);
}

/** (3) A row rolls its subtree up: S counts A1, A2 and C's A3; T counts A4. */
export async function assertARowCountsItsSubtreesAssets(fx: SummaryFixture): Promise<void> {
  const rows = await defaultRows(fx);
  const counts = [rowOf(rows, fx.site).assets, rowOf(rows, fx.sibling).assets];
  if (JSON.stringify(counts) !== "[3,1]") fail(`assets S, T: ${JSON.stringify(counts)}, expected [3, 1]`);
}

/** (4) kWh is the subtree's `kw` buckets (10 + 20 + 5), and `null` where no asset has any. */
export async function assertKwhRollsUpAndIsNullWithoutData(fx: SummaryFixture): Promise<void> {
  const rows = await defaultRows(fx);
  const kwh = [rowOf(rows, fx.site).kwh, rowOf(rows, fx.sibling).kwh];
  if (JSON.stringify(kwh) !== "[35,null]") fail(`kWh S, T: ${JSON.stringify(kwh)}, expected [35, null]`);
}

/** (5) Alarms raised in the range by severity, and the open ones of those; the alarm before the range is out. */
export async function assertAlarmsRaisedAndOpenBySeverity(fx: SummaryFixture): Promise<void> {
  const s = rowOf(await defaultRows(fx), fx.site);
  const got = JSON.stringify({ raised: s.raised, open: s.open });
  const expected = JSON.stringify({ raised: { critical: 1, warning: 1 }, open: { critical: 1 } });
  if (JSON.stringify({ raised: sorted(s.raised), open: sorted(s.open) }) !== expected) fail(`S alarms: ${got}, expected ${expected}`);
}

/** (6) An asset with no telemetry in the range is counted and named by code. */
export async function assertNoDataAssetsAreCountedAndNamed(fx: SummaryFixture): Promise<void> {
  const s = rowOf(await defaultRows(fx), fx.site);
  if (s.noData !== 1 || JSON.stringify(s.noDataCodes) !== JSON.stringify([fx.a2Code])) {
    fail(`S no data: ${s.noData} ${JSON.stringify(s.noDataCodes)}, expected 1 [${fx.a2Code}]`);
  }
}

/** (7) The owed case: A2 and A3 inside S's subtree and outside the readable ids are not counted. */
export async function assertAnAssetOutsideTheReadableIdsIsNotCounted(fx: SummaryFixture): Promise<void> {
  const s = rowOf(await defaultRows(fx, [fx.assets.a1, fx.assets.a4]), fx.site);
  if (s.assets !== 1 || s.kwh !== 30 || s.noData !== 0) fail(`S read with A1 only: ${JSON.stringify(s)}, expected 1 asset, 30 kWh, no gap`);
}

/** (8) Named locationIds are the rows: C alone, with its one asset. */
export async function assertANamedLocationIsItsOwnRow(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, fixtureScope(fx), [fx.child]);
  if (!rows.ok) fail(`C was refused: ${rows.reason}`);
  const summary = await fx.svc.summarise(fx.organizationId, rows.rows, fx.allAssets, energyReportRange({ startDate: fx.day, endDate: fx.day }));
  if (summary.length !== 1 || summary[0]?.id !== fx.child || summary[0].assets !== 1) fail(`C: ${JSON.stringify(summary)}`);
}

/** (9) A location of another organization is not found. */
export async function assertALocationOfAnotherOrganizationIsNotFound(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, null, [fx.foreign]);
  if (rows.ok || rows.reason !== "not_found") fail(`U named in O: ${JSON.stringify(rows)}, expected not_found`);
}

/** (10) The plan critic's scope leak: a scoped caller naming a location of the organization outside its scope is refused, no row and no name. */
export async function assertALocationOutsideTheScopeIsRefused(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, [fx.site, fx.child], [fx.sibling]);
  if (rows.ok || rows.reason !== "outside_grant") fail(`T named by a caller scoped to S: ${JSON.stringify(rows)}, expected outside_grant`);
}

/**
 * (11) A scope with a gap (an asset_group grant on S and on G, not on C, whose
 * locations come with no subtree closure) still has one root: G sits under S,
 * so it is not a row of its own and S's rollup counts G's assets once.
 */
export async function assertAScopeWithAGapHasOnlyItsTopRoot(fx: SummaryFixture): Promise<void> {
  const rows = await fx.svc.rows(fx.organizationId, [fx.site, fx.grandchild]);
  const ids = rows.ok ? rows.rows.map((row) => row.id) : rows.reason;
  if (JSON.stringify(ids) !== JSON.stringify([fx.site])) fail(`rows for scope [S, G]: ${JSON.stringify(ids)}, expected [S]`);
}

function sorted(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
}
