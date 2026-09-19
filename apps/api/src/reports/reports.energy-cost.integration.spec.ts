import type pg from "pg";

import { createDb } from "@bms/db";

import { CalcParametersService } from "../calc/calc-parameters.service";
import type { CostFixture } from "../dashboard/dashboard.energy-cost.integration.spec";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import { energyCsvDocument } from "./reports.serialise";
import { ReportsService } from "./reports.service";

/**
 * `E4.1c` U4 — `ReportsService.energyPreview` reads the tariff through the
 * real `CalcParametersService` (ADR 0070 decision 7), **effective at the
 * report's end instant** — `endDate T23:59:59.999Z` — not at now. The
 * dashboard spec (`dashboard.energy-cost.integration.spec.ts`) holds the
 * scope claims; this one holds the instant and the export. Both run off one
 * fixture in one Vitest file — `telemetry/energy-cost.integration.test.ts` —
 * because the fixture materialises the continuous aggregates, and two files
 * refreshing the same window in parallel workers contend on the refresh lock.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The report's date range that covers the fixture's kW rows (UTC dates). */
function rangeOf(fx: CostFixture): { startDate: string; endDate: string; end: Date } {
  const startDate = new Date(fx.fromMs).toISOString().slice(0, 10);
  const endDate = new Date(fx.toMs).toISOString().slice(0, 10);
  return { startDate, endDate, end: new Date(`${endDate}T23:59:59.999Z`) };
}

/**
 * One row per fixture asset, at **asset** scope. The dashboard spec holds
 * the organization- and location-scope claims; this file's claims are about
 * the instant, which any scope shows, and asset-scope rows keyed on the
 * fixture's own assets can never collide on `calc_parameters_no_overlap`
 * with another suite's organization-scope row.
 */
async function insertTariff(
  pool: pg.Pool,
  fx: CostFixture,
  value: number,
  validity: { from?: Date; to?: Date | null } = {},
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     VALUES ($1, $2, NULL, $3, $5, $6, $7),
            ($1, $2, NULL, $4, $5, $6, $7) RETURNING id`,
    [fx.organizationId, ENERGY_TARIFF_KEY, fx.a1, fx.a2, value, validity.from ?? new Date("2026-01-01T00:00:00Z"), validity.to ?? null],
  );
  return rows.map((row) => row.id);
}

async function deleteTariff(pool: pg.Pool, ids: readonly string[]): Promise<void> {
  await pool.query(`DELETE FROM bms.calc_parameters WHERE id = ANY($1::uuid[])`, [ids]);
}

function service(pool: pg.Pool): ReportsService {
  return new ReportsService(pool, new CalcParametersService(createDb(pool)));
}

/** R1 — the D1 shape over `energyPreview`: the cost is `round(totalKwh × tariff)` in the organization's currency. */
export async function assertReportPricesTheTotal(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const rowIds = await insertTariff(pool, fx, 2.15);
  try {
    const { startDate, endDate } = rangeOf(fx);
    const preview = await service(pool).energyPreview({ startDate, endDate }, [fx.a1, fx.a2]);
    const { summary } = preview;
    assert(summary.totalKwh > 0, `the fixture must produce energy in the range, got ${summary.totalKwh}`);
    // Within a cent (the dashboard spec's D1 says why).
    assert(
      summary.indicativeCost !== null && Math.abs(summary.indicativeCost - round2(summary.totalKwh * 2.15)) <= 0.01,
      `expected ≈ round(${summary.totalKwh} × 2.15), got ${String(summary.indicativeCost)}`,
    );
    assert(summary.tariffPerKwh === 2.15, `expected 2.15, got ${String(summary.tariffPerKwh)}`);
    assert(summary.currency === fx.currency, `expected ${fx.currency}, got ${String(summary.currency)}`);
    // R4, positive half — the CSV carries the number and the organization's currency as the unit.
    const csv = energyCsvDocument(preview);
    assert(
      csv.includes(`Indicative cost,${summary.indicativeCost},${fx.currency}\n`),
      `the CSV must carry the cost and the currency, got ${JSON.stringify(csv.split("\n").find((l) => l.startsWith("Indicative cost")))}`,
    );
    assert(csv.includes(`Tariff,2.15,${fx.currency}/kWh\n`), "the CSV tariff unit is the organization's currency per kWh");
  } finally {
    await deleteTariff(pool, rowIds);
  }
}

/** R2 — a row whose `effective_to` precedes the range's end instant is not in scope at that instant → `null`. */
export async function assertARowEndedBeforeTheRangeEndIsNull(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const { startDate, endDate, end } = rangeOf(fx);
  // Ended one hour before the end instant: it covered most of the range and
  // is still not the tariff *at* the instant decision 7 names.
  const rowIds = await insertTariff(pool, fx, 2.15, { to: new Date(end.getTime() - 3_600_000) });
  try {
    const preview = await service(pool).energyPreview({ startDate, endDate }, [fx.a1, fx.a2]);
    assert(preview.summary.totalKwh > 0, "the kWh total does not depend on a tariff");
    assert(preview.summary.indicativeCost === null, `an ended row is null — got ${String(preview.summary.indicativeCost)}`);
    assert(preview.summary.tariffPerKwh === null, `expected null, got ${String(preview.summary.tariffPerKwh)}`);
    // R4, negative half — the CSV writes the dash for the cost and the tariff.
    // The unit cell still names the currency: it is the organization's, known
    // whether or not a tariff is (`energy-cost.ts` rule 1); the empty unit is
    // the two-currency case, held by `reports.serialise.spec.ts`.
    assert(preview.summary.currency === fx.currency, `the currency is known without a tariff — got ${String(preview.summary.currency)}`);
    const csv = energyCsvDocument(preview);
    assert(csv.includes(`Indicative cost,—,${fx.currency}\n`), "the CSV writes the em dash for a null cost, with the currency as the unit");
    assert(csv.includes(`Tariff,—,${fx.currency}/kWh\n`), "the CSV writes the em dash for a null tariff, with the currency per kWh as the unit");
  } finally {
    await deleteTariff(pool, rowIds);
  }
}

/** R3 — a row effective only after the range's end instant → `null`, even though it is effective now or later. */
export async function assertARowEffectiveAfterTheRangeEndIsNull(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const { startDate, endDate, end } = rangeOf(fx);
  const rowIds = await insertTariff(pool, fx, 2.15, { from: new Date(end.getTime() + 1) });
  try {
    const preview = await service(pool).energyPreview({ startDate, endDate }, [fx.a1, fx.a2]);
    assert(preview.summary.indicativeCost === null, `a later row is null — got ${String(preview.summary.indicativeCost)}`);
    assert(preview.summary.tariffPerKwh === null, `expected null, got ${String(preview.summary.tariffPerKwh)}`);
  } finally {
    await deleteTariff(pool, rowIds);
  }
}

/** R3′ — the positive control for R2/R3: a row that starts inside the range and is open-ended is in scope at the end. */
export async function assertARowStartedInsideTheRangeIsInScopeAtTheEnd(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const { startDate, endDate, end } = rangeOf(fx);
  const rowIds = await insertTariff(pool, fx, 2.15, { from: new Date(end.getTime() - 60_000) });
  try {
    const preview = await service(pool).energyPreview({ startDate, endDate }, [fx.a1, fx.a2]);
    assert(preview.summary.tariffPerKwh === 2.15, `a row effective at the end instant resolves — got ${String(preview.summary.tariffPerKwh)}`);
  } finally {
    await deleteTariff(pool, rowIds);
  }
}
