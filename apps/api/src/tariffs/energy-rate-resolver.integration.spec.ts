import type pg from "pg";

import { computeBill } from "@bms/shared";
import { createDb } from "@bms/db";

import { DashboardService } from "../dashboard/dashboard.service";
import { ReportsService } from "../reports/reports.service";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import { createEnergyRateResolver } from "./energy-rate-resolver";
import { elapsedShare, monthFirstDay, monthOf, monthWindow, previousMonth } from "./month-window";

/**
 * `F4.365` U7 — the cost reads price a mapped location at its bill's rate
 * against a real database (ADR 0134 decision 7, Amendment 1; plan D10, Q4).
 *
 * Organization A (INR, Asia/Kolkata, flat `energy_tariff_per_kwh` = 8) has two
 * locations: MAPPED, whose meter is mapped to MSEDCL LT-I(B) and reads 250 kWh
 * last month (the golden 2546.00), and FLAT, with no mapping. A third location
 * SEC is mapped to Rajasthan DS (data status `secondary`, 600 kWh → the golden
 * 5392.50). Organization B holds a mapping row pointing at A's FLAT location and
 * a revision of the MSEDCL line dated last month; neither may change A's cost.
 *
 * Last month's report reads full-month bills; the dashboard's trailing window
 * reads this month's bill to date, with the fixed charge prorated by the
 * elapsed share (Amendment 1). A fourth location EDGE (owner ruling
 * 2026-11-14) is mapped to the same line with a meter that reads 100 units the
 * month before last and 250 last month and nothing this month: a report whose
 * end date is last month's last local day is last month's full bill, and a
 * report spanning the two months prices each at its own rate. Rows are committed and the aggregates
 * materialised (`energy-cost.integration.spec.ts` gives the reason). The
 * sibling `.test.ts` is the Vitest entry point (ADR 0014).
 */
const CODE = "F4365RATE";
const KOLKATA = "Asia/Kolkata";
const FLAT_RATE = 8;
export const MSEDCL_LT = "Maharashtra | MSEDCL | LT-I(B) Residential (single phase)";
export const RAJASTHAN_DS = "Rajasthan | JVVNL/AVVNL/JdVVNL | DS Domestic";
/** MSEDCL LT-I(B) slabs (plan §1): energy for `units` ≤ 300 and the flat wheeling 1.6. */
const LT_SLABS = [
  { slabNo: 1, fromUnits: 0, toUnits: 100, energyRate: 3.96, fixedRate: 130, wheelingRate: 1.6 },
  { slabNo: 2, fromUnits: 101, toUnits: 300, energyRate: 10.8, fixedRate: 130, wheelingRate: 1.6 },
  { slabNo: 3, fromUnits: 301, toUnits: 500, energyRate: 15.03, fixedRate: 130, wheelingRate: 1.6 },
  { slabNo: 4, fromUnits: 501, toUnits: null, energyRate: 17.53, fixedRate: 130, wheelingRate: 1.6 },
];

export interface RateFixture {
  organizationA: string;
  organizationB: string;
  mapped: string;
  flat: string;
  sec: string;
  /** The report's UTC dates, inside last month in Kolkata. */
  report: { startDate: string; endDate: string };
  /** This month's meter delta, read by the dashboard's trailing window. */
  liveUnits: number;
  /**
   * Why the dashboard's live-month case cannot run now, or `null`. The case
   * needs the trailing kW and this month's registers inside this local month;
   * in the first {@link LIVE_MARGIN_MS} after a Kolkata month boundary there
   * is not yet room, so it is skipped with this reason rather than flaking.
   */
  liveSkip: string | null;
  edge: string;
  /** EDGE's report ending on last month's last local day (a UTC date that reaches into this month in Kolkata). */
  monthEndReport: { startDate: string; endDate: string };
  /** EDGE's report spanning the month before last's last day and last month's first. */
  twoMonthReport: { startDate: string; endDate: string };
  ranges: { fromMs: number; toMs: number }[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
/** The live-month case needs this much of the current local month behind `now`. */
const LIVE_MARGIN_MS = 30 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function org(pool: pg.Pool, suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id`,
    [`${CODE}-${suffix}`, `F4.365 rate ${suffix}`, KOLKATA],
  );
  return rows[0]!.id;
}

async function location(pool: pg.Pool, organizationId: string, suffix: string): Promise<string> {
  const code = `${CODE}-${suffix}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, timezone)
     VALUES ($1, $2, $3, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $4, $5) RETURNING id`,
    [code, code.toLowerCase(), `F4.365 rate ${suffix}`, organizationId, KOLKATA],
  );
  return rows[0]!.id;
}

async function asset(pool: pg.Pool, organizationId: string, locationId: string, suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, active)
     VALUES ($1, $2, 'F4.365 rate', $3, $4, 'electrical', true) RETURNING id`,
    [`${CODE}-${suffix}`, `F4.365 rate ${suffix}`, organizationId, locationId],
  );
  return rows[0]!.id;
}

async function mapTo(pool: pg.Pool, organizationId: string, locationId: string, key: string, meter: string, load: number, from: string): Promise<void> {
  await pool.query(
    `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id, sanctioned_load, sanctioned_load_unit, effective_from)
     VALUES ($1, $2, $3, $4, $5, 'kw', $6)`,
    [organizationId, locationId, key, meter, load, from],
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

/** One `kw` sample a minute over `[fromMs, toMs)` per `[asset, kW]`. */
function kwRows(fromMs: number, toMs: number, assets: [string, number][]): [Date, string, string, number][] {
  const out: [Date, string, string, number][] = [];
  for (let t = fromMs; t < toMs; t += 60_000) {
    for (const [id, kw] of assets) out.push([new Date(t), id, "kw", kw]);
  }
  return out;
}

export async function seedRateFixture(superuser: pg.Pool): Promise<RateFixture> {
  const now = new Date();
  const thisMonth = monthOf(now, KOLKATA);
  const lastMonth = previousMonth(thisMonth);
  const last = monthWindow(lastMonth, KOLKATA);
  const current = monthWindow(thisMonth, KOLKATA);
  const beforeLast = monthWindow(previousMonth(lastMonth), KOLKATA);
  const day = (n: number, hour = 6) => new Date(last.start.getTime() + (n - 1) * 86_400_000 + hour * 3_600_000);
  const mappedFrom = monthFirstDay(previousMonth(lastMonth));

  const organizationA = await org(superuser, "A");
  const organizationB = await org(superuser, "B");
  const mappedLocation = await location(superuser, organizationA, "MAPPED");
  const flatLocation = await location(superuser, organizationA, "FLAT");
  const secLocation = await location(superuser, organizationA, "SEC");
  const mapped = await asset(superuser, organizationA, mappedLocation, "M");
  const flat = await asset(superuser, organizationA, flatLocation, "F");
  const sec = await asset(superuser, organizationA, secLocation, "S");
  const edgeLocation = await location(superuser, organizationA, "EDGE");
  const edge = await asset(superuser, organizationA, edgeLocation, "E");
  await mapTo(superuser, organizationA, edgeLocation, MSEDCL_LT, edge, 3, mappedFrom);
  await mapTo(superuser, organizationA, mappedLocation, MSEDCL_LT, mapped, 3, mappedFrom);
  await mapTo(superuser, organizationA, secLocation, RAJASTHAN_DS, sec, 5, mappedFrom);
  await superuser.query(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from)
     VALUES ($1, $2, NULL, NULL, $3, '2020-01-01T00:00:00Z')`,
    [organizationA, ENERGY_TARIFF_KEY, FLAT_RATE],
  );

  // Organization B: a mapping row on A's FLAT location (B's meter) and a revision of the MSEDCL line.
  const bLocation = await location(superuser, organizationB, "B");
  const bMeter = await asset(superuser, organizationB, bLocation, "BM");
  await mapTo(superuser, organizationB, flatLocation, MSEDCL_LT, bMeter, 3, mappedFrom);
  const { rows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.org_tariff_categories
       (organization_id, key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, effective_from, reason)
     SELECT $1, key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, $3, 'F4.365 rate fixture'
       FROM bms.tariff_categories WHERE key = $2 ORDER BY effective_from DESC LIMIT 1
     RETURNING id`,
    [organizationB, MSEDCL_LT, monthFirstDay(lastMonth)],
  );
  await superuser.query(
    `INSERT INTO bms.org_tariff_slabs (category_id, organization_id, slab_no, from_units, to_units, energy_rate, fixed_rate)
     VALUES ($1, $2, 1, 0, NULL, 100, 0)`,
    [rows[0]!.id, organizationB],
  );

  // Last month: registers (250 and 600 units) and two hours of kW on day 12 (UTC dates 12–13 sit in the month in Kolkata).
  const reportFrom = day(12).getTime();
  const reportTo = reportFrom + 2 * 3_600_000;
  // This month: 100 units from the month's first minute (or 20 h ago) to a minute ago, and up to
  // the trailing two hours of kW — both clipped to this local month, so that the dashboard's
  // trailing window reads only this month's energy however soon after the boundary it runs.
  const liveSkip =
    now.getTime() - current.start.getTime() < LIVE_MARGIN_MS
      ? `within ${LIVE_MARGIN_MS / 60_000} min of the ${thisMonth} month boundary in ${KOLKATA}: no room for this month's kW and registers yet`
      : null;
  const monthFloor = Math.ceil((current.start.getTime() + 60_000) / 60_000) * 60_000;
  const liveFrom = new Date(Math.max(monthFloor, now.getTime() - 20 * 3_600_000));
  const liveTo = new Date(now.getTime() - 60_000);
  const trailingTo = Math.floor(now.getTime() / 60_000) * 60_000 - 10 * 60_000;
  const trailingFrom = Math.max(trailingTo - 2 * 3_600_000, monthFloor);
  // EDGE: registers in the month before last (0 → 100) and last month (200 → 450), none this
  // month; two whole UTC hours of kW on the month before last's last local day (10 kW), on last
  // month's first (30 kW) and on last month's last (10 kW). `base` is the UTC midnight of the
  // day the boundary falls on: in Kolkata a month starts at 18:30Z, so base + 10 h..12 h is the
  // last local day's 15:30..17:30 and base + 34 h..36 h is the first local day's.
  const utcMidnight = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
  const lastBase = utcMidnight(last.start.getTime());
  const endBase = utcMidnight(last.end.getTime());
  const edgeKw: [number, number, number][] = [
    [lastBase + 10 * HOUR_MS, lastBase + 12 * HOUR_MS, 10],
    [lastBase + 34 * HOUR_MS, lastBase + 36 * HOUR_MS, 30],
    [endBase + 10 * HOUR_MS, endBase + 12 * HOUR_MS, 10],
  ];
  const at = (window: { start: Date }, days: number) => new Date(window.start.getTime() + days * DAY_MS);
  await samples(superuser, [
    [at(beforeLast, 5), edge, "kwh_total", 0],
    [at(beforeLast, 20), edge, "kwh_total", 100],
    [at(last, 5), edge, "kwh_total", 200],
    [at(last, 20), edge, "kwh_total", 450],
    ...edgeKw.flatMap(([from, to, kw]) => kwRows(from, to, [[edge, kw]])),
    [day(10), mapped, "kwh_total", 1000],
    [day(20), mapped, "kwh_total", 1250],
    [day(10), sec, "kwh_total", 0],
    [day(20), sec, "kwh_total", 600],
    ...kwRows(reportFrom, reportTo, [[mapped, 10], [flat, 20], [sec, 5]]),
    ...(liveSkip === null
      ? [
          [liveFrom, mapped, "kwh_total", 5000] as [Date, string, string, number],
          [liveTo, mapped, "kwh_total", 5100] as [Date, string, string, number],
          ...kwRows(trailingFrom, trailingTo, [[mapped, 10], [flat, 20]]),
        ]
      : []),
  ]);
  const ranges = [
    { fromMs: beforeLast.start.getTime(), toMs: last.end.getTime() },
    { fromMs: Math.min(trailingFrom, liveFrom.getTime()), toMs: now.getTime() },
  ];
  await materializeCompleteBuckets(superuser, reportFrom, reportTo, Date.now());
  for (const [from, to] of edgeKw) await materializeCompleteBuckets(superuser, from, to, Date.now());
  if (liveSkip === null) await materializeCompleteBuckets(superuser, trailingFrom, trailingTo, Date.now());
  return {
    organizationA,
    organizationB,
    mapped,
    flat,
    sec,
    report: { startDate: iso(day(12)), endDate: iso(day(13)) },
    liveUnits: 100,
    liveSkip,
    edge,
    monthEndReport: { startDate: iso(new Date(endBase)), endDate: iso(new Date(endBase)) },
    twoMonthReport: { startDate: iso(new Date(lastBase)), endDate: iso(new Date(lastBase + DAY_MS)) },
    ranges,
  };
}

export async function cleanupRateFixture(superuser: pg.Pool, fx?: RateFixture): Promise<void> {
  const { rows } = await superuser.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code LIKE $1`, [`${CODE}%`]);
  const orgs = rows.map((r) => r.id);
  if (orgs.length === 0) return;
  const assets = (await superuser.query<{ id: string }>(`SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs])).rows.map((r) => r.id);
  // Bounded by time as well as asset (the `energy-cost.integration.spec.ts` reason): without a
  // fixture, the widest window this suite writes — the previous two local months to now.
  const now = Date.now();
  const ranges = fx?.ranges ?? [{ fromMs: monthWindow(previousMonth(previousMonth(monthOf(new Date(), KOLKATA))), KOLKATA).start.getTime(), toMs: now }];
  for (const r of ranges) {
    await superuser.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time <= $3`, [
      assets, new Date(r.fromMs), new Date(r.toMs),
    ]);
  }
  await superuser.query(`DELETE FROM bms.location_tariffs WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.org_tariff_categories WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.calc_parameters WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
  for (const r of ranges) await materializeCompleteBuckets(superuser, r.fromMs, r.toMs, Date.now());
}

function services(fleet: pg.Pool): { dashboard: DashboardService; reports: ReportsService } {
  const resolver = createEnergyRateResolver(createDb(fleet), fleet);
  // `F4.364` added the health reader; this suite asserts nothing about health.
  const noHealth = { scoresByLocation: async () => new Map() };
  return { dashboard: new DashboardService(fleet, resolver, noHealth), reports: new ReportsService(fleet, resolver) };
}

function near(actual: number | null, expected: number, tolerance: number, label: string): void {
  assert(actual !== null && Math.abs(actual - expected) <= tolerance, `${label}: expected ≈ ${expected}, got ${String(actual)}`);
}

/** Last month's report: the mapped meter at 2546.00 ÷ 250, the unmapped asset at the flat 8, both together per asset. */
export async function assertTheReportPricesAMappedSiteAtItsBillRate(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  const { reports } = services(fleet);
  const rate = 2546 / 250;
  const m = (await reports.energyPreview(fx.report, [fx.mapped])).summary;
  assert(m.totalKwh > 0, `the fixture must produce energy, got ${m.totalKwh}`);
  near(m.indicativeCost, round2(m.totalKwh * rate), 0.01, "mapped");
  assert(m.tariffPerKwh !== null && Math.abs(m.tariffPerKwh - rate) < 1e-9, `the ribbon tariff is the bill rate, got ${String(m.tariffPerKwh)}`);
  assert(m.tariffVerify === false && m.currency === "INR", JSON.stringify(m));

  const f = (await reports.energyPreview(fx.report, [fx.flat])).summary;
  near(f.indicativeCost, round2(f.totalKwh * FLAT_RATE), 0.01, "unmapped");
  assert(f.tariffPerKwh === FLAT_RATE && f.tariffVerify === false, JSON.stringify(f));

  const both = (await reports.energyPreview(fx.report, [fx.mapped, fx.flat])).summary;
  near(both.indicativeCost, round2(m.totalKwh * rate + f.totalKwh * FLAT_RATE), 0.02, "both");
  assert(both.tariffPerKwh === null, "two rates in scope show no single tariff");
}

/** A `secondary` version raises `tariffVerify` with its golden rate, 5392.50 ÷ 600. */
export async function assertASecondaryVersionNeedsVerifying(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  const { reports } = services(fleet);
  const s = (await reports.energyPreview(fx.report, [fx.sec])).summary;
  near(s.indicativeCost, round2(s.totalKwh * (5392.5 / 600)), 0.01, "secondary");
  assert(s.tariffVerify === true, `a secondary version needs verifying: ${JSON.stringify(s)}`);
}

/** The dashboard's trailing window: this month to date, the fixed charge prorated by the elapsed share. */
export async function assertTheDashboardPricesMonthToDate(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  if (fx.liveSkip !== null) throw new Error(`the caller skips this case: ${fx.liveSkip}`);
  const { dashboard } = services(fleet);
  const now = new Date();
  const share = elapsedShare(monthWindow(monthOf(now, KOLKATA), KOLKATA), now);
  const bill = computeBill({ slabs: LT_SLABS, fixedBasis: "per_connection_month", units: fx.liveUnits, sanctionedLoad: 3, fixedFraction: share });
  const rate = bill.total / fx.liveUnits;
  const m = await dashboard.energySummary("24h", [fx.mapped]);
  assert(m.totalKwh > 0, `the fixture must produce energy, got ${m.totalKwh}`);
  near(m.indicativeCost, round2(m.totalKwh * rate), 0.02, `mapped month to date (rate ${rate})`);
  const f = await dashboard.energySummary("24h", [fx.flat]);
  near(f.indicativeCost, round2(f.totalKwh * FLAT_RATE), 0.01, "unmapped");
}

/** Organization B's mapping row on A's location, and B's revision of A's line, change nothing for A. */
export async function assertAnotherOrganizationChangesNothing(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  const { reports } = services(fleet);
  const f = (await reports.energyPreview(fx.report, [fx.flat])).summary;
  assert(f.tariffPerKwh === FLAT_RATE, `B's mapping must not map A's location: ${JSON.stringify(f)}`);
  const m = (await reports.energyPreview(fx.report, [fx.mapped])).summary;
  assert(m.tariffPerKwh !== null && Math.abs(m.tariffPerKwh - 2546 / 250) < 1e-9, `B's revision must not price A: ${String(m.tariffPerKwh)}`);
}

/** EDGE's month before last: 100 units, the full bill (no proration). */
function beforeLastRate(): number {
  const bill = computeBill({ slabs: LT_SLABS, fixedBasis: "per_connection_month", units: 100, sanctionedLoad: 3, fixedFraction: 1 });
  return bill.total / 100;
}

/**
 * Owner ruling 2026-11-14: a report whose end date is last month's last local day is last
 * month's full bill (2546.00 ÷ 250). Its end instant, 23:59:59.999Z, is already this month in
 * Kolkata, where EDGE's meter has no reading — read at that instant the cost was `null`.
 */
export async function assertAReportEndingOnAMonthsLastDayIsThatMonth(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  const { reports } = services(fleet);
  const e = (await reports.energyPreview(fx.monthEndReport, [fx.edge])).summary;
  assert(e.totalKwh > 0, `the fixture must produce energy, got ${e.totalKwh}`);
  const rate = 2546 / 250;
  near(e.indicativeCost, round2(e.totalKwh * rate), 0.01, "month-end report at last month's full bill");
  assert(e.tariffPerKwh !== null && Math.abs(e.tariffPerKwh - rate) < 1e-9, `the ribbon tariff is last month's rate, got ${String(e.tariffPerKwh)}`);
}

/** A report spanning two local months prices each month's energy (10 kW, then 30 kW) at its own bill rate. */
export async function assertATwoMonthReportPricesEachMonthAtItsRate(fleet: pg.Pool, fx: RateFixture): Promise<void> {
  const { reports } = services(fleet);
  const e = (await reports.energyPreview(fx.twoMonthReport, [fx.edge])).summary;
  assert(e.totalKwh > 0, `the fixture must produce energy, got ${e.totalKwh}`);
  const before = beforeLastRate();
  const last = 2546 / 250;
  assert(Math.abs(before - last) > 0.5, `the two months must differ to tell them apart: ${before} vs ${last}`);
  // The energy splits 1 : 3 across the boundary whatever the bucket width (the same hours, 10 vs 30 kW).
  const expected = round2(e.totalKwh * ((1 * before + 3 * last) / 4));
  near(e.indicativeCost, expected, 0.02, `two months at their own rates (${before}, ${last})`);
  assert(e.tariffPerKwh !== null, "one asset, one blended rate");
}
