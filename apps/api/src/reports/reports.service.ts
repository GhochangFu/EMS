import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { EnergyReportPreview, EnergyReportTemplate } from "@bms/shared";

import { POOL_TOKEN } from "../database/database.tokens";
import type { EnergyReportQuery } from "./reports.schema";

const energyTemplate: EnergyReportTemplate = {
  id: "energy_consumption",
  title: "Energy Consumption",
  description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
  formats: ["CSV"],
  active: true,
};

@Injectable()
export class ReportsService {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}

  /** Builds the Sprint E Energy Consumption report preview. */
  async energyPreview(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<EnergyReportPreview> {
    const range = this.parseRange(query);
    const tariff = this.energyTariffZar();
    const summary = await this.energySummary(range, tariff, assetIds);
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
        "CSV is generated on demand and not persisted in Sprint E.",
        "PDF/XLSX output and report history remain deferred to later sprint scope.",
        "DG is a nominal slice because the simulator has no separate DG meter.",
      ],
    };
  }

  /** Exports the Sprint E Energy Consumption preview as CSV text. */
  async energyCsv(
    query: EnergyReportQuery,
    assetIds?: string[] | null,
  ): Promise<string> {
    const preview = await this.energyPreview(query, assetIds);
    const lines: string[][] = [
      ["Report", preview.template.title],
      ["Start date", preview.range.startDate],
      ["End date", preview.range.endDate],
      ["Generated at", preview.generatedAt],
      [],
      ["Metric", "Value", "Unit"],
      ["Total energy", String(preview.summary.totalKwh), "kWh"],
      ["Peak demand", String(preview.summary.peakKw), "kW"],
      ["PUE estimate", String(preview.summary.pueEstimate), ""],
      ["Indicative cost", String(preview.summary.indicativeCostZar), "ZAR"],
      ["Tariff", String(preview.summary.tariffZarPerKwh), "ZAR/kWh"],
      [],
      ["Source", "Energy", "Unit"],
      ["Grid", String(preview.sourceTotals.gridKwh), "kWh"],
      ["Solar", String(preview.sourceTotals.solarKwh), "kWh"],
      ["Nominal DG", String(preview.sourceTotals.dgKwh), "kWh"],
      [],
      ["Asset code", "Asset name", "Site", "Avg kW", "Estimated kWh"],
      ...preview.topConsumers.map((consumer) => [
        consumer.code,
        consumer.name,
        consumer.siteName,
        String(consumer.avgKw),
        String(consumer.estimatedKwh),
      ]),
    ];
    return `${lines.map((row) => row.map((cell) => this.csvCell(cell)).join(",")).join("\n")}\n`;
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
    tariff: number,
    assetIds?: string[] | null,
  ): Promise<EnergyReportPreview["summary"]> {
    if (assetIds && assetIds.length === 0) {
      return {
        window: "custom",
        totalKwh: 0,
        peakKw: 0,
        pueEstimate: 1,
        indicativeCostZar: 0,
        tariffZarPerKwh: tariff,
        asOf: new Date().toISOString(),
      };
    }
    const r = await this.pool.query<{
      total_kwh: string;
      peak_kw: string;
      avg_kw: string;
    }>(
      `
      WITH per AS (
        SELECT date_trunc('hour', time) AS bucket, asset_id, avg(value) AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw'
          AND time >= $1
          AND time <= $2
          AND ($3::uuid[] IS NULL OR asset_id = ANY($3::uuid[]))
        GROUP BY 1, 2
      ),
      agg AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      )
      SELECT
        COALESCE(SUM(total_kw), 0)::float8 AS total_kwh,
        COALESCE(MAX(total_kw), 0)::float8 AS peak_kw,
        COALESCE(AVG(total_kw), 0)::float8 AS avg_kw
      FROM agg
      `,
      [range.start, range.end, assetIds ?? null],
    );
    const row = r.rows[0];
    const totalKwh = row ? Number(row.total_kwh) : 0;
    const peakKw = row ? Number(row.peak_kw) : 0;
    const avgKw = row ? Number(row.avg_kw) : 0;
    return {
      window: "custom",
      totalKwh: this.round(totalKwh),
      peakKw: this.round(peakKw),
      pueEstimate: this.estimatePue(avgKw),
      indicativeCostZar: this.round(totalKwh * tariff),
      tariffZarPerKwh: tariff,
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
    const r = await this.pool.query<{
      total_kw: string;
      solar_kw: string;
    }>(
      `
      WITH per AS (
        SELECT date_trunc('hour', v.time) AS bucket, v.asset_id, avg(v.value) AS kw
        FROM telemetry.point_values v
        WHERE v.point_key = 'kw'
          AND v.time >= $1
          AND v.time <= $2
          AND ($3::uuid[] IS NULL OR v.asset_id = ANY($3::uuid[]))
        GROUP BY 1, 2
      ),
      solar_ids AS (
        SELECT id FROM bms.assets
        WHERE code ILIKE 'PV%' AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
      )
      SELECT
        COALESCE(SUM(p.kw), 0)::float8 AS total_kw,
        COALESCE(SUM(p.kw) FILTER (WHERE s.id IS NOT NULL), 0)::float8 AS solar_kw
      FROM per p
      LEFT JOIN solar_ids s ON s.id = p.asset_id
      `,
      [range.start, range.end, assetIds ?? null],
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
        avg(v.value)::float8 AS avg_kw
      FROM telemetry.point_values v
      INNER JOIN bms.assets a ON a.id = v.asset_id
      WHERE v.point_key = 'kw'
        AND v.time >= $1
        AND v.time <= $2
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

  private energyTariffZar(): number {
    const t = Number(process.env.ENERGY_TARIFF_ZAR_PER_KWH ?? "2.15");
    return Number.isFinite(t) && t > 0 ? t : 2.15;
  }

  private estimatePue(totalKw: number): number {
    if (totalKw <= 0) {
      return 1.0;
    }
    const raw = 1.22 + Math.min(0.45, totalKw / 12_000);
    return Math.round(raw * 100) / 100;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private csvCell(value: string): string {
    if (/["\n,]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
