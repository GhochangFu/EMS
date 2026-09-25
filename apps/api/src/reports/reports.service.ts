import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import * as XLSX from "xlsx";

import type { EnergyReportPreview, EnergyReportTemplate } from "@bms/shared";

import { FLEET_POOL } from "../database/database.tokens";
import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  levelForRange,
} from "../telemetry/point-aggregates";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { energyCost, perAssetEnergy, resolveTariffs } from "../telemetry/energy-cost";
import { windowedPueRatio } from "../telemetry/pue-ratio";
import { energyPdfDefinition, renderPdf } from "./energy-pdf";
import type { EnergyReportQuery } from "./reports.schema";
import {
  assertFiniteCells,
  energyCsvDocument,
  energySheetRows,
} from "./reports.serialise";

const energyTemplate: EnergyReportTemplate = {
  id: "energy_consumption",
  title: "Energy Consumption",
  description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
  formats: ["CSV", "XLSX", "PDF"],
  active: true,
};

@Injectable()
export class ReportsService {
  // E7.1b: the energy report joins `bms.assets` (FORCE-policied as of 0047) —
  // `energySourceTotals`'s `solar_ids` and `energyTopConsumers`'s asset join. On
  // the tenant pool with no GUC those return zero rows for EVERY caller (incl.
  // the global admin): top-consumers empties and solar generation is
  // misattributed to grid. The report reads across the caller's `assetIds` scope
  // (threaded as `$3`/`$4`), which is the isolation control (Amendment 2/3), so
  // it runs on fleetDb (BYPASSRLS). Its telemetry aggregates are unpoliced.
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    // `E4.1c` — the tariff is a parameter (ADR 0070 decision 7); see
    // `DashboardService` for why the injection is `Pick`-typed.
    @Inject(CalcParametersService)
    private readonly parameters: Pick<CalcParametersService, "resolveForAssets">,
  ) {}

  /** Builds the Sprint E Energy Consumption report preview. */
  async energyPreview(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<EnergyReportPreview> {
    const range = this.parseRange(query);
    const summary = await this.energySummary(range, assetIds);
    const sourceTotals = await this.energySourceTotals(range, assetIds);
    const topConsumers = await this.energyTopConsumers(range, 10, assetIds);

    return {
      template: energyTemplate,
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
        durationHours: range.durationHours,
      },
      generatedAt: new Date().toISOString(),
      summary,
      sourceTotals,
      topConsumers,
      notes: [
        // ADR 0071 (`F3.5a`) — PDF shipped and report files can be saved to
        // history. Leaving the old "deferred" wording here would have told
        // every client the format and the history were still missing while
        // the panel showed them both.
        "CSV, XLSX and PDF are generated on demand; a PDF or XLSX can be " +
          "saved to the report history (F3.5a).",
        "DG is a nominal slice because the simulator has no separate DG meter.",
      ],
    };
  }

  /**
   * Exports the Sprint E Energy Consumption preview as CSV text.
   *
   * Row building and escaping live in `reports.serialise.ts` under ADR 0026 — they
   * need no `Pool`, and while they were inline here they were never tested.
   */
  async energyCsv(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<string> {
    return energyCsvDocument(await this.energyPreview(query, assetIds));
  }

  /**
   * The same report as `xlsx` (ADR 0026 Amendment 2, `F4.51`).
   *
   * Offered beside the CSV rather than replacing it. `F4.51` measured that a cell
   * holding two or more field separators still injects a formula into any consumer
   * that does not treat the comma as a delimiter, and that no escaping in `csv.ts`
   * can close it — the apostrophe guard protects the first fragment only. The
   * class does not exist here: `aoa_to_sheet` writes no `<f>` element, so the file
   * never instructs Excel to evaluate anything.
   *
   * The CSV route is untouched. Its bytes are a client deliverable, which is the
   * reason ADR 0026 exists, and its residual is documented rather than silently
   * patched.
   */
  async energyXlsx(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<Buffer> {
    const rows = assertFiniteCells(
      energySheetRows(await this.energyPreview(query, assetIds)),
    );
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Energy");
    return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /**
   * The same report as PDF (ADR 0071 decision 2). Mirrors `energyXlsx` line
   * for line: the finite-cells guard stays here (not in `energy-pdf.ts`,
   * which is pure), and `energyTable`'s rows are what both renderers read.
   */
  async energyPdf(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<Buffer> {
    const preview = await this.energyPreview(query, assetIds);
    assertFiniteCells(energySheetRows(preview));
    return renderPdf(energyPdfDefinition(preview));
  }

  private parseRange(query: EnergyReportQuery): {
    start: Date;
    end: Date;
    durationHours: number;
  } {
    const start = new Date(`${query.startDate}T00:00:00.000Z`);
    const end = new Date(`${query.endDate}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Invalid report date range");
    }
    if (start > end) {
      throw new BadRequestException("Report start date must be before end date");
    }
    const durationHours = Math.max(
      1,
      (end.getTime() - start.getTime()) / (60 * 60 * 1000),
    );
    if (durationHours > 24 * 31) {
      throw new BadRequestException("Energy report range is limited to 31 days");
    }
    return { start, end, durationHours };
  }

  private async energySummary(
    range: { start: Date; end: Date },
    assetIds?: string[] | null,
  ): Promise<EnergyReportPreview["summary"]> {
    if (assetIds && assetIds.length === 0) {
      return {
        window: "custom",
        totalKwh: 0,
        peakKw: 0,
        // `F2.8` ruling 4: nothing readable is `null`, not a `1` sentinel. The CSV
        // writes the em dash for it (`reports.serialise.ts`).
        pueEstimate: null,
        // `E4.1c` — an empty scope has no cost, no tariff and no currency.
        indicativeCost: null,
        tariffPerKwh: null,
        currency: null,
        asOf: new Date().toISOString(),
      };
    }
    // ADR 0025 (`F4.28`) site 4 — reads `_1h`, decided at the §10 gate on
    // 2026-08-10. This is the client-facing CSV export, so the choice was the
    // owner's: raw includes samples arriving more than 3 days late but **returns
    // zeros** for ranges past ADR 0024's 730-day horizon, while `_1h` is never
    // dropped and misses those late arrivals. `_1h` won — the trade is recorded in
    // ADR 0025 §"Settled at the gate" as chosen, not overlooked.
    //
    // **No partial edge bucket**, and that is structural rather than lucky:
    // `parseRange` builds `T00:00:00.000Z`/`T23:59:59.999Z` from date-only strings,
    // and a UTC day boundary is an hour boundary. Measured identical to the raw
    // query at 2345.170321387197 kWh (ADR 0025 facts 1 and 5).
    const { level } = levelForRange({ start: range.start, granularity: "1h" });
    // Explicitly, even though it is 1. This query used to treat SUM(total_kw) as
    // kWh directly — correct only because the buckets are hours, and written down
    // nowhere. `levelForRange` exists to change levels, so the factor that was
    // silently right must become visibly right (ADR 0025 decision 3).
    const kwhFactor = bucketHours(level);

    const r = await this.pool.query<{
      total_kwh: string;
      peak_kw: string;
    }>(
      `
      WITH per AS (
        SELECT bucket, asset_id, ${avgExpr()} AS kw
        FROM ${aggregateRelation(level)}
        WHERE point_key = 'kw'
          AND bucket >= $1
          AND bucket <= $2
          AND ($3::uuid[] IS NULL OR asset_id = ANY($3::uuid[]))
        GROUP BY 1, 2
      ),
      agg AS (
        -- F4.159: no foreign key holds telemetry to bms.assets; only existing assets count.
        SELECT bucket, SUM(kw)::float8 AS total_kw
        FROM per INNER JOIN bms.assets a ON a.id = per.asset_id GROUP BY bucket
      )
      SELECT
        COALESCE(SUM(total_kw) * $4::float8, 0)::float8 AS total_kwh,
        COALESCE(MAX(total_kw), 0)::float8 AS peak_kw
      FROM agg
      `,
      [range.start, range.end, assetIds ?? null, kwhFactor],
    );
    const row = r.rows[0];
    const totalKwh = row ? Number(row.total_kwh) : 0;
    const peakKw = row ? Number(row.peak_kw) : 0;
    // `E4.1c` (ADR 0070 decision 7) — Σ per-asset kWh × that asset's
    // nearest-scope `energy_tariff_per_kwh`, effective at the **report's end**
    // instant, over the same `[start, end]` bound as the total above. A missing
    // tariff or a second currency in scope is `null`, not 0 (`energy-cost.ts`).
    const perAsset = await perAssetEnergy(this.pool, {
      level,
      window: { kind: "range", start: range.start, end: range.end },
      kwhFactor,
      assetIds: assetIds ?? null,
    });
    const cost = energyCost(perAsset, await resolveTariffs(this.parameters, perAsset, range.end));
    return {
      window: "custom",
      totalKwh: this.round(totalKwh),
      peakKw: this.round(peakKw),
      // `F2.8` — Σ site_kw / Σ it_kw over the incomers in `assetIds`, taken over
      // the report's own range and at the same `level` the kWh query reads, so the
      // two numbers on the page describe one window. `avg_kw` left the query above
      // with the fitted curve it was the only input to.
      pueEstimate: await windowedPueRatio(this.pool, {
        level,
        start: range.start,
        end: range.end,
        assetIds: assetIds ?? null,
      }),
      ...cost,
      asOf: new Date().toISOString(),
    };
  }

  private async energySourceTotals(range: {
    start: Date;
    end: Date;
  }, assetIds?: string[] | null): Promise<EnergyReportPreview["sourceTotals"]> {
    if (assetIds && assetIds.length === 0) {
      return { solarKwh: 0, dgKwh: 0, gridKwh: 0 };
    }
    // ADR 0025 (`F4.28`) site 5 — `_1h`, same reasoning and the same gate decision
    // as site 4. Fold 1, so the per-bucket parity this is covered by proves the
    // predicate translation and the `ILIKE 'PV%'` split, not the mean.
    const { level } = levelForRange({ start: range.start, granularity: "1h" });
    const kwhFactor = bucketHours(level);

    const r = await this.pool.query<{
      total_kw: string;
      solar_kw: string;
    }>(
      `
      WITH per AS (
        SELECT v.bucket, v.asset_id, ${avgExpr("v")} AS kw
        FROM ${aggregateRelation(level)} v
        WHERE v.point_key = 'kw'
          AND v.bucket >= $1
          AND v.bucket <= $2
          AND ($3::uuid[] IS NULL OR v.asset_id = ANY($3::uuid[]))
        GROUP BY 1, 2
      ),
      solar_ids AS (
        SELECT id FROM bms.assets
        WHERE code ILIKE 'PV%' AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
      )
      SELECT
        COALESCE(SUM(p.kw) * $4::float8, 0)::float8 AS total_kw,
        COALESCE(SUM(p.kw) FILTER (WHERE s.id IS NOT NULL) * $4::float8, 0)::float8 AS solar_kw
      FROM per p
      -- F4.159: no foreign key holds telemetry to bms.assets; only existing assets count.
      INNER JOIN bms.assets a ON a.id = p.asset_id
      LEFT JOIN solar_ids s ON s.id = p.asset_id
      `,
      [range.start, range.end, assetIds ?? null, kwhFactor],
    );
    const row = r.rows[0];
    const totalKwh = row ? Number(row.total_kw) : 0;
    const solarKwh = row ? Number(row.solar_kw) : 0;
    const net = Math.max(totalKwh - solarKwh, 0);
    const dgKwh = Math.min(net * 0.04, totalKwh * 0.1);
    return {
      solarKwh: this.round(solarKwh),
      dgKwh: this.round(dgKwh),
      gridKwh: this.round(Math.max(net - dgKwh, 0)),
    };
  }

  private async energyTopConsumers(
    range: { start: Date; end: Date; durationHours: number },
    limit: number,
    assetIds?: string[] | null,
  ): Promise<EnergyReportPreview["topConsumers"]> {
    if (assetIds && assetIds.length === 0) {
      return [];
    }
    // ADR 0025 (`F4.28`) site 6 — `_1h`, and the site where `avgExpr` earns its
    // existence on the reports path.
    //
    // **No display bucket**: every `_1h` row for an asset folds into one mean, so
    // the naive average-of-averages form is detectably wrong here — measured wrong
    // in 29 of 37 assets. And the error is far larger than at `_1m`: `sample_count`
    // at `_1h` spans 7–629 against `_1m`'s 1–60, so the naive form is off by up to
    // **11.19 kW** rather than 0.046 (ADR 0025 facts 3 and 4). The coarse level is
    // the more dangerous one to get wrong, not the safer.
    //
    // `sum(sum_value) / sum(sample_count)` over the range is exactly
    // `sum(value) / count(value)` over the same samples, so this is an algebraic
    // identity with the query it replaces, not an approximation.
    //
    // No `bucketHours` here: this reports a mean kW, and `estimatedKwh` multiplies
    // by `range.durationHours` exactly as before.
    const { level } = levelForRange({ start: range.start, granularity: "1h" });

    const r = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      site_name: string;
      avg_kw: string;
    }>(
      `
      SELECT
        a.id,
        a.code,
        a.name,
        a.site_name,
        ${avgExpr("v")}::float8 AS avg_kw
      FROM ${aggregateRelation(level)} v
      INNER JOIN bms.assets a ON a.id = v.asset_id
      WHERE v.point_key = 'kw'
        AND v.bucket >= $1
        AND v.bucket <= $2
        AND ($4::uuid[] IS NULL OR a.id = ANY($4::uuid[]))
      GROUP BY a.id, a.code, a.name, a.site_name
      ORDER BY avg_kw DESC
      LIMIT $3
      `,
      [range.start, range.end, Math.min(25, Math.max(1, limit)), assetIds ?? null],
    );
    return r.rows.map((row) => {
      const avgKw = Number(row.avg_kw);
      return {
        assetId: row.id,
        code: row.code,
        name: row.name,
        siteName: row.site_name,
        avgKw: this.round(avgKw),
        estimatedKwh: this.round(avgKw * range.durationHours),
      };
    });
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
