import type pg from "pg";

import { EnergyBillService, type PfReader } from "./energy-bill.service";
import { readMappingsForAssets, readMappingsForLocation, type MappingRow } from "./location-tariff-read";
import { monthFirstDay, monthOf, monthWindow, previousMonth } from "./month-window";

/**
 * `F4.365` U4 — the monthly bill against a real database (ADR 0134 decisions
 * 4–8). The fixture is two organizations of its own, created and deleted by
 * the sibling `.test.ts`; register samples sit in the PREVIOUS local month, so
 * the bill is a complete month whatever the run's clock.
 */
const CODE = "F4365BILL";
const KOLKATA = "Asia/Kolkata";
export const MSEDCL_LT = "Maharashtra | MSEDCL | LT-I(B) Residential (single phase)";
export const MSEDCL_HT = "Maharashtra | MSEDCL | HT-I(A) HT Industry (11/22/33 kV)";
const EMPTY_LINE = "custom:F4365BILL no slabs";

export interface BillFixture {
  organizationA: string;
  organizationB: string;
  now: Date;
  month: string;
  thisMonth: string;
  lt: { locationId: string; meter: string };
  ht: { locationId: string; meter: string };
  estimated: { locationId: string; meter: string };
  single: { locationId: string; meter: string };
  falling: { locationId: string; meter: string };
  /** Mapped to an organization line with no slabs: `computeBill` refuses it. */
  empty: { locationId: string; meter: string };
  child: { locationId: string; asset: string };
  window: { start: Date; end: Date };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function org(pool: pg.Pool, suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id`,
    [`${CODE}-${suffix}`, `F4.365 ${suffix}`, KOLKATA],
  );
  return rows[0]!.id;
}

async function location(pool: pg.Pool, organizationId: string, suffix: string, parentId: string | null = null): Promise<string> {
  const code = `${CODE}-${suffix}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, parent_id, timezone)
     VALUES ($1, $2, $3, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $4, $5, $6) RETURNING id`,
    [code, code.toLowerCase(), `F4.365 ${suffix}`, organizationId, parentId, KOLKATA],
  );
  return rows[0]!.id;
}

async function asset(pool: pg.Pool, organizationId: string, locationId: string, suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, active)
     VALUES ($1, $2, 'F4.365', $3, $4, 'electrical', true) RETURNING id`,
    [`${CODE}-${suffix}`, `F4.365 ${suffix}`, organizationId, locationId],
  );
  return rows[0]!.id;
}

async function mapTo(pool: pg.Pool, organizationId: string, locationId: string, key: string, meter: string, load: number, unit: string, from: string): Promise<void> {
  await pool.query(
    `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id, sanctioned_load, sanctioned_load_unit, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, locationId, key, meter, load, unit, from],
  );
}

async function samples(pool: pg.Pool, rows: [Date, string, string, number][]): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a, k, v, 'u' FROM unnest($1::timestamptz[], $2::uuid[], $3::varchar[], $4::float8[]) AS x(t, a, k, v)
     ON CONFLICT DO NOTHING`,
    [rows.map((r) => r[0].toISOString()), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])],
  );
}

/** An organization revision of `key` with one slab at `rate`. */
async function revision(pool: pg.Pool, organizationId: string, key: string, from: string, rate: number): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.org_tariff_categories
       (organization_id, key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, effective_from, reason)
     SELECT $1, key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, $3, 'F4.365 fixture'
       FROM bms.tariff_categories WHERE key = $2 ORDER BY effective_from DESC LIMIT 1
     RETURNING id`,
    [organizationId, key, from],
  );
  await pool.query(
    `INSERT INTO bms.org_tariff_slabs (category_id, organization_id, slab_no, from_units, to_units, energy_rate, fixed_rate)
     VALUES ($1, $2, 1, 0, NULL, $3, 0)`,
    [rows[0]!.id, organizationId, rate],
  );
}

export async function seedBillFixture(superuser: pg.Pool): Promise<BillFixture> {
  const now = new Date();
  const thisMonth = monthOf(now, KOLKATA);
  const month = previousMonth(thisMonth);
  const window = monthWindow(month, KOLKATA);
  const day = (n: number) => new Date(window.start.getTime() + (n - 1) * 86_400_000 + 6 * 3_600_000);
  const mappedFrom = monthFirstDay(previousMonth(month));

  const organizationA = await org(superuser, "A");
  const organizationB = await org(superuser, "B");
  const site = async (suffix: string, key: string, load: number, unit: string) => {
    const locationId = await location(superuser, organizationA, suffix);
    const meter = await asset(superuser, organizationA, locationId, `${suffix}-M`);
    await mapTo(superuser, organizationA, locationId, key, meter, load, unit, mappedFrom);
    return { locationId, meter };
  };
  const lt = await site("LT", MSEDCL_LT, 3, "kw");
  const ht = await site("HT", MSEDCL_HT, 500, "kva");
  const estimated = await site("EST", MSEDCL_HT, 500, "kva");
  const single = await site("ONE", MSEDCL_LT, 3, "kw");
  const falling = await site("DOWN", MSEDCL_LT, 3, "kw");
  // An organization line with no slab rows, in force from before the mapping.
  await superuser.query(
    `INSERT INTO bms.org_tariff_categories
       (organization_id, key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, effective_from, reason)
     SELECT $1, $3, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, $4, 'F4.365 fixture'
       FROM bms.tariff_categories WHERE key = $2 ORDER BY effective_from DESC LIMIT 1`,
    [organizationA, MSEDCL_LT, EMPTY_LINE, mappedFrom],
  );
  const empty = await site("EMPTY", EMPTY_LINE, 3, "kw");
  const childLocation = await location(superuser, organizationA, "CHILD", lt.locationId);
  const child = { locationId: childLocation, asset: await asset(superuser, organizationA, childLocation, "CHILD-A") };

  await samples(superuser, [
    [day(10), lt.meter, "kwh_total", 1000],
    [day(20), lt.meter, "kwh_total", 1250],
    // On the window's exclusive end: must not count (it belongs to this month).
    [window.end, lt.meter, "kwh_total", 99999],
    [day(2), ht.meter, "kvah_total", 5000],
    [day(28), ht.meter, "kvah_total", 125000],
    [day(2), ht.meter, "kwh_total", 4000],
    [day(28), ht.meter, "kwh_total", 100000],
    [day(2), estimated.meter, "kwh_total", 0],
    [day(28), estimated.meter, "kwh_total", 96000],
    [day(5), single.meter, "kwh_total", 10],
    [day(5), falling.meter, "kwh_total", 500],
    [day(25), falling.meter, "kwh_total", 400],
    [day(10), empty.meter, "kwh_total", 0],
    [day(20), empty.meter, "kwh_total", 50],
  ]);
  // Org A revises the LT line from THIS month; org B revises it from last month (must never serve A).
  await revision(superuser, organizationA, MSEDCL_LT, monthFirstDay(thisMonth), 1);
  await revision(superuser, organizationB, MSEDCL_LT, monthFirstDay(month), 100);
  return { organizationA, organizationB, now, month, thisMonth, lt, ht, estimated, single, falling, empty, child, window };
}

export async function cleanupBillFixture(superuser: pg.Pool, fx?: BillFixture): Promise<void> {
  const { rows } = await superuser.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code LIKE $1`, [`${CODE}%`]);
  const orgs = rows.map((r) => r.id);
  if (orgs.length === 0) return;
  const assets = (await superuser.query<{ id: string }>(`SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs])).rows.map((r) => r.id);
  if (fx) {
    await superuser.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time <= $3`, [
      assets, fx.window.start, fx.window.end,
    ]);
  }
  await superuser.query(`DELETE FROM bms.location_tariffs WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.org_tariff_categories WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[]) AND parent_id IS NOT NULL`, [orgs]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
}

async function billOf(fleet: pg.Pool, fx: BillFixture, site: { locationId: string }, month = fx.month, pf?: PfReader) {
  const [mapping] = await readMappingsForLocation(fleet, fx.organizationA, site.locationId);
  assert(mapping !== undefined, "the site is mapped");
  const service = new EnergyBillService(fleet, pf);
  const [bill] = await service.computeBills([{ mapping: mapping as MappingRow, month }], fx.now);
  return bill!;
}

/** (a) kWh category: 250 units on the MSEDCL LT-I(B) line = the golden 2546.00; the end-boundary sample is excluded. */
export async function assertAKwhMonthMatchesTheGoldenBill(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const bill = await billOf(fleet, fx, fx.lt);
  assert(bill.ok, `expected a bill, got ${bill.ok ? "" : bill.reason}`);
  if (!bill.ok) return;
  assert(bill.complete && bill.units === 250 && bill.bill.total === 2546, `units ${bill.units} total ${bill.bill.total}`);
  assert(bill.version.source === "catalog", "last month is the catalog's version");
}

/** (b) measured kVAh on HT-I(A): 120000 kVAh at 500 kVA = 1435000.00, not estimated. */
export async function assertAMeasuredKvahMonthBills(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const bill = await billOf(fleet, fx, fx.ht);
  assert(bill.ok && bill.unitType === "kvah" && !bill.estimated && bill.units === 120000 && bill.bill.total === 1435000, JSON.stringify(bill.ok ? bill.bill : bill));
  assert(bill.ok && bill.kwh === 96000, "the kWh divisor is read beside the kVAh");
}

/** (c, d) no kVAh register: kWh ÷ pf, marked estimated; no pf → kvah_unavailable. */
export async function assertKvahIsEstimatedFromPf(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const est = await billOf(fleet, fx, fx.estimated, fx.month, async () => 0.8);
  assert(est.ok && est.estimated && Math.abs(est.units - 120000) < 1e-6 && est.bill.total === 1435000, JSON.stringify(est.ok ? est.units : est));
  const none = await billOf(fleet, fx, fx.estimated, fx.month, async () => null);
  assert(!none.ok && none.reason === "kvah_unavailable", JSON.stringify(none));
}

/** (e, f) one sample → meter_no_reading; a falling register → meter_decreasing. */
export async function assertBadRegistersAnswerAReason(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const one = await billOf(fleet, fx, fx.single);
  assert(!one.ok && one.reason === "meter_no_reading", JSON.stringify(one));
  const down = await billOf(fleet, fx, fx.falling);
  assert(!down.ok && down.reason === "meter_decreasing", JSON.stringify(down));
}

/** (g, h) A's revision dated this month serves this month only; B's revision never serves A. */
export async function assertVersionsAreDatedAndIsolated(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const last = await billOf(fleet, fx, fx.lt, fx.month);
  assert(last.version?.source === "catalog", `last month: ${last.version?.source} (org B's revision must not serve A)`);
  const current = await billOf(fleet, fx, fx.lt, fx.thisMonth);
  assert(current.version?.source === "organization" && current.version.organizationId === fx.organizationA, `this month: ${JSON.stringify(current.version)}`);
}

/** A child location's asset takes its nearest mapped ancestor's mappings. */
export async function assertAnAssetInheritsTheNearestMapping(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const map = await readMappingsForAssets(fleet, [fx.child.asset, fx.lt.meter]);
  assert(map.get(fx.child.asset)?.[0]?.locationId === fx.lt.locationId, "child asset → parent's mapping");
  assert(map.get(fx.lt.meter)?.[0]?.locationId === fx.lt.locationId, "meter → own location's mapping");
}

/** A malformed version (no slabs) fails its own target with `version_invalid`; the batch still bills the rest. */
export async function assertAMalformedVersionFailsOnlyItsTarget(fleet: pg.Pool, fx: BillFixture): Promise<void> {
  const [lt] = await readMappingsForLocation(fleet, fx.organizationA, fx.lt.locationId);
  const [empty] = await readMappingsForLocation(fleet, fx.organizationA, fx.empty.locationId);
  assert(lt !== undefined && empty !== undefined, "both sites are mapped");
  const [bad, good] = await new EnergyBillService(fleet).computeBills(
    [
      { mapping: empty as MappingRow, month: fx.month },
      { mapping: lt as MappingRow, month: fx.month },
    ],
    fx.now,
  );
  assert(bad !== undefined && !bad.ok && bad.reason === "version_invalid", `expected version_invalid, got ${JSON.stringify(bad)}`);
  assert(good !== undefined && good.ok && good.bill.total === 2546, `the neighbour still bills: ${JSON.stringify(good)}`);
}
