import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createDb } from "@bms/db";
import type { EnergyCostDayRow } from "@bms/shared";

import { CalcParametersService } from "../calc/calc-parameters.service";
import type { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { ENERGY_TARIFF_KEY } from "./energy-cost";
import { localDay, readEnergyCostByDay, shiftDay } from "./energy-cost-by-day";

/**
 * `F4.332` (ADR 0070 Amendment 7) — the cost per local day against a real database: the `_5m`
 * aggregate folded into local hours, the dated rate rows read through the real
 * `CalcParametersService`, and the catalog resolve inside a tenant transaction.
 *
 * **The fixture is two organizations of its own**, created and deleted here, so no seeded or
 * parallel suite's rate row can price (or unprice) an asset of this file: `energy-cost`'s suite
 * writes organization-scope rows into a seeded organization, which would make "no rate in scope"
 * flaky anywhere else. Organization A is `INR` in `Asia/Kolkata` (a half-hour offset, the PHE
 * case); its locations carry no zone, so the location → organization chain is exercised too.
 * Organization B is `USD`.
 *
 * **The days are fixed relative to the run**: `day0` and `day1` are three and two local days
 * before today in Kolkata, fully in the past, so every bucket is complete and materialisable.
 *
 * Rows are committed and deleted, not rolled back: a continuous aggregate refresh cannot run in
 * a transaction (`cagg-materialize.ts`).
 */

const RUN = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
const CODE = `F4332-${RUN}`;
const KOLKATA = "Asia/Kolkata";
const HOUR = 3_600_000;
const FIVE_MIN = 300_000;
/** Local midnight of 2026-10-25 in London (BST, +01:00) and of 2026-10-26 (GMT): 25 hours apart. */
const LONDON_DST_START = Date.parse("2026-10-24T23:00:00Z");
const LONDON_DST_END = Date.parse("2026-10-26T00:00:00Z");

export type CostByDayFixture = {
  readonly organizationA: string;
  readonly organizationB: string;
  readonly locationPriced: string;
  /**
   * 10 kW over day0 and 20 kW from day1 on; its location's rates: 8, then 8, then 10 from day1
   * 14:00. Two loads, not one: with one constant load a half-hour shift of the day boundary moves
   * as much energy in as out, and the boundary case could not fail.
   */
  readonly priced: string;
  /** 5 kW over day1, at a location with no rate row. */
  readonly unpriced: string;
  /** 1 kW over day1, in organization B (USD), with an asset-scope rate of 1. */
  readonly foreign: string;
  /** The rate row covering exactly day0, for the edit case. */
  readonly day0RateId: string;
  readonly day0: string;
  readonly day1: string;
  /** The instant the fixture was seeded: every read uses it, so a run across midnight is stable. */
  readonly nowMs: number;
  /** An asset in organization C (`Europe/London`, GBP), 10 kW over 2026-10-25, a 25-hour day. */
  readonly london: string;
  readonly organizationC: string;
  readonly fromMs: number;
  readonly toMs: number;
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Local midnight of `day` in Kolkata, epoch ms. */
const kolkataMidnight = (day: string): number => Date.parse(`${day}T00:00:00+05:30`);

async function insertLocation(pool: pg.Pool, organizationId: string, suffix: string): Promise<string> {
  const code = `${CODE}-${suffix}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id)
     VALUES ($1, $2, $3, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $4)
     RETURNING id`,
    [code, code.toLowerCase(), `F4.332 fixture ${suffix}`, organizationId],
  );
  return rows[0]!.id;
}

async function insertAsset(pool: pg.Pool, organizationId: string, locationId: string, suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, active)
     VALUES ($1, $2, 'F4.332 fixture site', $3, $4, 'electrical', true) RETURNING id`,
    [`${CODE}-${suffix}`, `F4.332 fixture ${suffix}`, organizationId, locationId],
  );
  return rows[0]!.id;
}

async function insertRate(
  pool: pg.Pool,
  organizationId: string,
  value: number,
  scope: { locationId?: string; assetId?: string },
  fromMs: number,
  toMs: number | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      organizationId,
      ENERGY_TARIFF_KEY,
      scope.locationId ?? null,
      scope.assetId ?? null,
      value,
      new Date(fromMs),
      toMs === null ? null : new Date(toMs),
    ],
  );
  return rows[0]!.id;
}

/** One `kw` sample per five minutes over `[fromMs, toMs)`. */
function samples(assetId: string, kw: number, fromMs: number, toMs: number): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (let t = fromMs; t < toMs; t += FIVE_MIN) out.push([new Date(t + 60_000).toISOString(), assetId, kw]);
  return out;
}

/** `superuser` writes the fixture (locations and assets carry FORCE RLS). */
export async function seedCostByDayFixture(superuser: pg.Pool): Promise<CostByDayFixture> {
  const nowMs = Date.now();
  const today = localDay(nowMs, KOLKATA);
  const day0 = shiftDay(today, -3);
  const day1 = shiftDay(today, -2);
  const day0Start = kolkataMidnight(day0);
  const day1Start = kolkataMidnight(day1);
  const day2Start = kolkataMidnight(shiftDay(today, -1));

  const org = async (suffix: string, currency: string, timezone: string): Promise<string> => {
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${CODE}-${suffix}`, `F4.332 fixture ${suffix}`, currency, timezone],
    );
    return rows[0]!.id;
  };
  const organizationA = await org("A", "INR", KOLKATA);
  const organizationB = await org("B", "USD", KOLKATA);
  const organizationC = await org("C", "GBP", "Europe/London");
  const locationPriced = await insertLocation(superuser, organizationA, "LP");
  const locationUnpriced = await insertLocation(superuser, organizationA, "LU");
  const locationForeign = await insertLocation(superuser, organizationB, "LF");
  const priced = await insertAsset(superuser, organizationA, locationPriced, "P");
  const unpriced = await insertAsset(superuser, organizationA, locationUnpriced, "U");
  const foreign = await insertAsset(superuser, organizationB, locationForeign, "F");
  const london = await insertAsset(superuser, organizationC, await insertLocation(superuser, organizationC, "LL"), "L");

  // Location-scope rows, contiguous and half-open: day0 at 8; day1 at 8 until 14:00, then 10.
  const day0RateId = await insertRate(superuser, organizationA, 8, { locationId: locationPriced }, day0Start, day1Start);
  await insertRate(superuser, organizationA, 8, { locationId: locationPriced }, day1Start, day1Start + 14 * HOUR);
  await insertRate(superuser, organizationA, 10, { locationId: locationPriced }, day1Start + 14 * HOUR, null);
  await insertRate(superuser, organizationB, 1, { assetId: foreign }, day0Start, null);
  await insertRate(superuser, organizationC, 1, { assetId: london }, LONDON_DST_START - HOUR, null);

  // The Kolkata-boundary sentinel: 1000 kW in the five minutes BEFORE day0's local midnight
  // (the day before the window). A UTC-hour read would fold half an hour of day0 into it.
  const rows = [
    ...samples(priced, 1000, day0Start - FIVE_MIN, day0Start),
    ...samples(priced, 10, day0Start, day1Start),
    ...samples(priced, 20, day1Start, day2Start),
    ...samples(unpriced, 5, day1Start, day2Start),
    ...samples(foreign, 1, day1Start, day2Start),
    // 2026-10-25 in London: BST until 01:00Z, then GMT — local 01:00 happens twice; 25 hours.
    ...samples(london, 10, LONDON_DST_START, LONDON_DST_END),
  ];
  await superuser.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a, 'kw', v, 'kW' FROM unnest($1::timestamptz[], $2::uuid[], $3::float8[]) AS x(t, a, v)
     ON CONFLICT DO NOTHING`,
    [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])],
  );
  const fromMs = day0Start - HOUR;
  const toMs = day2Start;
  await materializeCompleteBuckets(superuser, fromMs, toMs, Date.now());
  await materializeCompleteBuckets(superuser, LONDON_DST_START - HOUR, LONDON_DST_END + HOUR, Date.now());
  return {
    organizationA, organizationB, organizationC, locationPriced, priced, unpriced, foreign, london,
    day0RateId, day0, day1, fromMs, toMs, nowMs,
  };
}

export async function cleanupCostByDay(superuser: pg.Pool, fx?: CostByDayFixture): Promise<void> {
  const { rows } = await superuser.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code LIKE $1`, [
    `${CODE}%`,
  ]);
  const orgs = rows.map((row) => row.id);
  if (orgs.length === 0) return;
  const assetRows = await superuser.query<{ id: string }>(`SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  const assetIds = assetRows.rows.map((row) => row.id);
  await superuser.query(`DELETE FROM bms.calc_parameters WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  if (fx) {
    // Time-bounded: `point_values` is a hypertable, and an unbounded delete scans every chunk.
    await superuser.query(
      `DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time < $3`,
      [assetIds, new Date(fx.fromMs), new Date(fx.toMs + HOUR)],
    );
  }
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
  // The London rows sit outside `fx`'s range, so they are deleted on their own bound.
  await superuser.query(
    `DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time < $3`,
    [assetIds, new Date(LONDON_DST_START - HOUR), new Date(LONDON_DST_END + HOUR)],
  );
  if (fx) {
    await materializeCompleteBuckets(superuser, fx.fromMs, fx.toMs, Date.now());
    await materializeCompleteBuckets(superuser, LONDON_DST_START - HOUR, LONDON_DST_END + HOUR, Date.now());
  }
}

/** The read the catalog entries call, on the fleet pool, for the four days ending at `nowMs`. */
async function read(
  fleet: pg.Pool,
  organizationId: string,
  assetIds: readonly string[],
  nowMs: number,
  days = 4,
): Promise<EnergyCostDayRow[]> {
  return readEnergyCostByDay(fleet, new CalcParametersService(createDb(fleet)), organizationId, assetIds, () => days, new Date(nowMs));
}

const dayOf = (rows: readonly EnergyCostDayRow[], day: string): EnergyCostDayRow | undefined =>
  rows.find((row) => row.day === day);

/** A rate change at 14:00 local splits day1; day0 is a whole day at 8; the boundary is local. */
export async function assertAMidDayRateChangeSplitsTheDay(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const rows = await read(fleet, fx.organizationA, [fx.priced], fx.nowMs);
  assert(rows.length === 4, `four days must be returned, got ${rows.length}`);
  const day1 = dayOf(rows, fx.day1);
  assert(day1?.cost === 14 * 20 * 8 + 10 * 20 * 10 && day1.currency === "INR" && day1.reason === null,
    `day1 must be 14 h at 8 and 10 h at 10 of 20 kW (4240), got ${JSON.stringify(day1)}`);
}

/** day0 is exactly 24 h × 10 kW: the 1000 kW sentinel before local midnight is not in it. */
export async function assertKolkataLocalMidnightIsTheBoundary(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const day0 = dayOf(await read(fleet, fx.organizationA, [fx.priced], fx.nowMs), fx.day0);
  assert(day0?.kwh === 240 && day0.cost === 1920, `day0 must be 240 kWh at 8 (1920), got ${JSON.stringify(day0)}`);
}

/** Editing day0's rate row re-prices day0 on the next read, and nothing else. */
export async function assertAnEditedOldRateRepricesOnlyItsDays(
  fleet: pg.Pool,
  superuser: pg.Pool,
  fx: CostByDayFixture,
): Promise<void> {
  try {
    await superuser.query(`UPDATE bms.calc_parameters SET value = 9 WHERE id = $1`, [fx.day0RateId]);
    const rows = await read(fleet, fx.organizationA, [fx.priced], fx.nowMs);
    assert(dayOf(rows, fx.day0)?.cost === 2160, `day0 must re-price at 9 (2160), got ${dayOf(rows, fx.day0)?.cost}`);
    assert(dayOf(rows, fx.day1)?.cost === 4240, `day1 must not change (4240), got ${dayOf(rows, fx.day1)?.cost}`);
  } finally {
    await superuser.query(`UPDATE bms.calc_parameters SET value = 8 WHERE id = $1`, [fx.day0RateId]);
  }
}

/** An asset with energy and no rate in scope: null with `rate_missing`, never 0. */
export async function assertAMissingRateIsNullWithTheReason(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const rows = await read(fleet, fx.organizationA, [fx.unpriced], fx.nowMs);
  const day1 = dayOf(rows, fx.day1);
  assert(day1?.cost === null && day1.reason === "rate_missing" && day1.kwh === 120,
    `day1 must be null with rate_missing, got ${JSON.stringify(day1)}`);
  assert(dayOf(rows, fx.day0)?.reason === "no_energy", "day0 has no bucket and must be no_energy");
}

/**
 * Organization B's asset id handed to organization A's read is dropped, not priced: the read
 * filters `bms.assets` on the organization (defence in depth on the fleet pool, which bypasses
 * RLS). So B's USD never meets A's INR, and A's day is its own. `currency_mixed` stays as the
 * pure fold's fail-closed guard (`energy-cost-by-day.spec.ts`); through this read, one
 * organization's assets carry one currency.
 */
export async function assertAnotherOrganizationsIdIsDropped(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const rows = await read(fleet, fx.organizationA, [fx.priced, fx.foreign], fx.nowMs);
  const day1 = dayOf(rows, fx.day1);
  assert(day1?.cost === 4240 && day1.currency === "INR" && day1.reason === null,
    `organization B's asset must not reach organization A's read, got ${JSON.stringify(day1)}`);
  const onlyForeign = await read(fleet, fx.organizationA, [fx.foreign], fx.nowMs);
  assert(onlyForeign.length === 0, `a read of only another organization's id must be empty, got ${onlyForeign.length} rows`);
}

/**
 * The catalog resolve at organization scope inside organization A's tenant transaction: B's
 * asset is not in scope (so no `currency_mixed`), and A's priced asset is. With the reader's
 * readable set narrowed to the unpriced asset, only that asset is priced.
 */
export async function assertTheResolveStaysInsideTheOrganization(
  service: MetricCatalogService,
  fx: CostByDayFixture,
): Promise<void> {
  const bindings = (catalogKey: "energy.cost_by_day" | "energy.cost.total", params: Record<string, unknown>) => ({
    widgets: [{ id: "w", tabGroupId: null, widgetType: "chart" as const, config: {} }],
    sources: [{ id: "s", widgetId: "w", catalogKey, params }],
    scope: { assetId: null, locationId: null, assetGroupId: null },
    capLocationId: null,
  });
  const all = await service.resolveBindings(fx.organizationA, bindings("energy.cost_by_day", { days: 4 }), null, null, "F4.332");
  const dataset = all.byId.get("s");
  assert(dataset?.shape === "dataset", "energy.cost_by_day must resolve as a dataset");
  const rows = dataset?.shape === "dataset" ? (dataset.rows as unknown as EnergyCostDayRow[]) : [];
  const day1 = dayOf(rows, fx.day1);
  // P (4240) is priced and U is unpriced on day1, so the organization's day1 is rate_missing;
  // day0 holds P only. B's USD asset never reaches the scope: no currency_mixed.
  assert(dayOf(rows, fx.day0)?.cost === 1920 && dayOf(rows, fx.day0)?.currency === "INR",
    `day0 must be organization A's own 1920 INR, got ${JSON.stringify(dayOf(rows, fx.day0))}`);
  assert(day1?.reason === "rate_missing", `day1 must be rate_missing (U is unpriced), got ${JSON.stringify(day1)}`);

  const narrowed = await service.resolveBindings(
    fx.organizationA,
    bindings("energy.cost.total", { period: "last_7_days" }),
    [fx.priced],
    null,
    "F4.332",
  );
  const total = narrowed.byId.get("s");
  assert(total?.shape === "metric" && total.value === 1920 + 4240 && total.currency === "INR",
    `the readable set [P] must total P's two days (6160 INR), got ${JSON.stringify(total)}`);
}

/** Organization B's resolve never sees organization A's assets, whatever ids the reader holds. */
export async function assertAnotherOrganizationsAssetsAreNotPriced(
  service: MetricCatalogService,
  fx: CostByDayFixture,
): Promise<void> {
  const resolved = await service.resolveBindings(
    fx.organizationB,
    {
      widgets: [{ id: "w", tabGroupId: null, widgetType: "value_tile", config: {} }],
      sources: [{ id: "s", widgetId: "w", catalogKey: "energy.cost.total", params: { period: "last_7_days" } }],
      scope: { assetId: null, locationId: null, assetGroupId: null },
      capLocationId: null,
    },
    [fx.priced, fx.foreign],
    null,
    "F4.332",
  );
  const total = resolved.byId.get("s");
  assert(total?.shape === "metric" && total.value === 24 && total.currency === "USD",
    `organization B must total only its own asset (24 USD), got ${JSON.stringify(total)}`);
}

/**
 * "Today" is the hours so far: read with `now` at day1 14:30 local, day1 is the window's last day
 * and its running hour counts half. 14 h × 20 kW at 8, plus 0.5 h × 20 kW at 10 = 2340.
 */
export async function assertTheRunningHourCountsOnlyTheTimePassed(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const nowMs = kolkataMidnight(fx.day1) + 14.5 * HOUR;
  const rows = await read(fleet, fx.organizationA, [fx.priced], nowMs);
  const today = rows[rows.length - 1];
  assert(today?.day === fx.day1 && today.kwh === 290 && today.cost === 14 * 20 * 8 + 0.5 * 20 * 10,
    `today must be the 14.5 hours so far (290 kWh, 2340), got ${JSON.stringify(today)}`);
}

/**
 * A DST fall-back day in London is 25 local hours: its repeated 01:00 hour is two hours, not one
 * hour at the two-hour mean. 25 h × 10 kW at 1 = 250.
 */
export async function assertADstFallBackDayHasTwentyFiveHours(fleet: pg.Pool, fx: CostByDayFixture): Promise<void> {
  const rows = await read(fleet, fx.organizationC, [fx.london], Date.parse("2026-10-26T12:00:00Z"), 2);
  const day = dayOf(rows, "2026-10-25");
  assert(day?.kwh === 250 && day.cost === 250 && day.currency === "GBP",
    `2026-10-25 in London must be 25 h × 10 kW (250 GBP), got ${JSON.stringify(day)}`);
}
