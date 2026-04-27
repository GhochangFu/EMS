import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Pool } from "pg";

import { POOL_TOKEN } from "../database/database.tokens";

@Injectable()
export class DashboardService {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}

  /**
   * KPI row for the Executive Dashboard: sums latest kW per asset, live site count,
   * and open alarms from `bms.alarms`.
   */
  async kpis(): Promise<{
    totalKw: number;
    sitesOnline: number;
    sitesTotal: number;
    alarmsOpen: number;
    alarmsCritical: number;
    pueEstimate: number;
    asOf: string;
  }> {
    const r = await this.pool.query<{
      total_kw: string;
      sites_online: string;
      sites_total: string;
      alarms_open: string;
      alarms_critical: string;
    }>(`
      WITH kw_latest AS (
        SELECT DISTINCT ON (asset_id) asset_id, time AS kw_time, value AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw'
        ORDER BY asset_id, time DESC
      ),
      asset_sites AS (
        SELECT id, site_name FROM bms.assets
      )
      SELECT
        (SELECT COALESCE(SUM(kw), 0) FROM kw_latest)::float8 AS total_kw,
        (SELECT COUNT(DISTINCT s.site_name)::int FROM kw_latest k
          JOIN asset_sites s ON s.id = k.asset_id
          WHERE k.kw_time > now() - interval '20 seconds') AS sites_online,
        (SELECT COUNT(DISTINCT site_name)::int FROM asset_sites) AS sites_total,
        (SELECT COUNT(*)::int FROM bms.alarms WHERE acknowledged_at IS NULL) AS alarms_open,
        (SELECT COUNT(*)::int FROM bms.alarms WHERE acknowledged_at IS NULL AND severity = 'critical') AS alarms_critical
    `);
    const row = r.rows[0];
    if (!row) {
      return {
        totalKw: 0,
        sitesOnline: 0,
        sitesTotal: 0,
        alarmsOpen: 0,
        alarmsCritical: 0,
        pueEstimate: 1,
        asOf: new Date().toISOString(),
      };
    }
    const totalKw = Number(row.total_kw);
    return {
      totalKw,
      sitesOnline: Number(row.sites_online),
      sitesTotal: Number(row.sites_total),
      alarmsOpen: Number(row.alarms_open),
      alarmsCritical: Number(row.alarms_critical),
      pueEstimate: this.estimatePue(totalKw),
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Per-minute total kW (sum of per-asset averages) for the trend chart.
   */
  async loadTrend(windowRaw?: string): Promise<{
    points: { t: string; totalKw: number }[];
  }> {
    const intervalText = this.parseWindowInterval(windowRaw ?? "60m");
    const r = await this.pool.query<{ bucket: Date; total_kw: string }>(
      `
      WITH per AS (
        SELECT date_trunc('minute', time) AS bucket, asset_id, avg(value) AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw' AND time > now() - $1::interval
        GROUP BY 1, 2
      ),
      agg AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      )
      SELECT bucket, total_kw FROM agg ORDER BY bucket ASC
      `,
      [intervalText],
    );
    return {
      points: r.rows.map((x) => ({
        t: new Date(x.bucket).toISOString(),
        totalKw: Number(x.total_kw),
      })),
    };
  }

  private estimatePue(totalKw: number): number {
    if (totalKw <= 0) {
      return 1.0;
    }
    const raw = 1.22 + Math.min(0.45, totalKw / 12_000);
    return Math.round(raw * 100) / 100;
  }

  /**
   * Energy Centre: `Nh` or `Nd` windows; hourly buckets when >= 48h or any day-based window.
   */
  private parseEnergyWindow(raw?: string): {
    intervalSql: string;
    useHourlyBuckets: boolean;
    windowLabel: string;
    durationHours: number;
  } {
    const w = (raw ?? "24h").trim().toLowerCase();
    const m = /^(\d+)(h|d)$/.exec(w);
    if (!m) {
      throw new BadRequestException(
        'Invalid energy window; use "24h", "7d", or "30d" style (hours or days only)',
      );
    }
    const n = Number(m[1]);
    const u = m[2];
    if (u === "h") {
      if (n < 1 || n > 168) {
        throw new BadRequestException("Energy window: 1–168 hours");
      }
      return {
        intervalSql: `${n} hours`,
        useHourlyBuckets: n >= 48,
        windowLabel: w,
        durationHours: n,
      };
    }
    if (n < 1 || n > 30) {
      throw new BadRequestException("Energy window: 1–30 days");
    }
    return {
      intervalSql: `${n} days`,
      useHourlyBuckets: true,
      windowLabel: w,
      durationHours: n * 24,
    };
  }

  private energyTariffZar(): number {
    const t = Number(process.env.ENERGY_TARIFF_ZAR_PER_KWH ?? "2.15");
    return Number.isFinite(t) && t > 0 ? t : 2.15;
  }

  async energySummary(windowRaw?: string): Promise<{
    window: string;
    totalKwh: number;
    peakKw: number;
    pueEstimate: number;
    indicativeCostZar: number;
    tariffZarPerKwh: number;
    asOf: string;
  }> {
    const { intervalSql, useHourlyBuckets, windowLabel } =
      this.parseEnergyWindow(windowRaw);
    const trunc = useHourlyBuckets ? "hour" : "minute";
    const kwhFactor = useHourlyBuckets ? 1 : 1 / 60;

    const r = await this.pool.query<{
      total_kwh: string;
      peak_kw: string;
      avg_kw: string;
    }>(
      `
      WITH per AS (
        SELECT date_trunc('${trunc}', time) AS bucket, asset_id, avg(value) AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw' AND time > now() - $1::interval
        GROUP BY 1, 2
      ),
      agg AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      )
      SELECT
        COALESCE(SUM(total_kw) * $2::float8, 0) AS total_kwh,
        COALESCE(MAX(total_kw), 0) AS peak_kw,
        COALESCE(AVG(total_kw), 0) AS avg_kw
      FROM agg
      `,
      [intervalSql, kwhFactor],
    );

    const row = r.rows[0];
    const totalKwh = row ? Number(row.total_kwh) : 0;
    const peakKw = row ? Number(row.peak_kw) : 0;
    const avgKw = row ? Number(row.avg_kw) : 0;
    const tariff = this.energyTariffZar();

    return {
      window: windowLabel,
      totalKwh: Math.round(totalKwh * 100) / 100,
      peakKw: Math.round(peakKw * 100) / 100,
      pueEstimate: this.estimatePue(avgKw),
      indicativeCostZar: Math.round(totalKwh * tariff * 100) / 100,
      tariffZarPerKwh: tariff,
      asOf: new Date().toISOString(),
    };
  }

  async energySourceMix(windowRaw?: string): Promise<{
    points: { t: string; gridKw: number; solarKw: number; dgKw: number }[];
  }> {
    const { intervalSql, useHourlyBuckets } = this.parseEnergyWindow(windowRaw);
    const trunc = useHourlyBuckets ? "hour" : "minute";

    const r = await this.pool.query<{
      bucket: Date;
      total_kw: string;
      solar_kw: string;
    }>(
      `
      WITH per AS (
        SELECT date_trunc('${trunc}', time) AS bucket, asset_id, avg(value) AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw' AND time > now() - $1::interval
        GROUP BY 1, 2
      ),
      solar_ids AS (
        SELECT id FROM bms.assets WHERE code ILIKE 'PV%'
      ),
      tot AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      ),
      sol AS (
        SELECT p.bucket, SUM(p.kw)::float8 AS solar_kw
        FROM per p
        JOIN solar_ids s ON s.id = p.asset_id
        GROUP BY p.bucket
      )
      SELECT
        t.bucket,
        t.total_kw,
        COALESCE(s.solar_kw, 0)::float8 AS solar_kw
      FROM tot t
      LEFT JOIN sol s ON s.bucket = t.bucket
      ORDER BY t.bucket ASC
      `,
      [intervalSql],
    );

    const points = r.rows.map((x) => {
      const totalKw = Number(x.total_kw);
      const solarKw = Number(x.solar_kw);
      const net = Math.max(totalKw - solarKw, 0);
      const dgKw = Math.min(net * 0.04, totalKw * 0.1);
      const gridKw = Math.max(net - dgKw, 0);
      return {
        t: new Date(x.bucket).toISOString(),
        gridKw: Math.round(gridKw * 100) / 100,
        solarKw: Math.round(solarKw * 100) / 100,
        dgKw: Math.round(dgKw * 100) / 100,
      };
    });

    return { points };
  }

  async energyTopConsumers(
    windowRaw?: string,
    limit = 10,
  ): Promise<{
    consumers: {
      assetId: string;
      code: string;
      name: string;
      siteName: string;
      avgKw: number;
      estimatedKwh: number;
    }[];
  }> {
    const { intervalSql, durationHours } = this.parseEnergyWindow(windowRaw);
    const lim = Math.min(25, Math.max(1, limit));

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
      WHERE v.point_key = 'kw' AND v.time > now() - $1::interval
      GROUP BY a.id, a.code, a.name, a.site_name
      ORDER BY avg_kw DESC
      LIMIT $2
      `,
      [intervalSql, lim],
    );

    return {
      consumers: r.rows.map((row) => {
        const avgKw = Number(row.avg_kw);
        const estimatedKwh = avgKw * durationHours;
        return {
          assetId: row.id,
          code: row.code,
          name: row.name,
          siteName: row.site_name,
          avgKw: Math.round(avgKw * 100) / 100,
          estimatedKwh: Math.round(estimatedKwh * 100) / 100,
        };
      }),
    };
  }

  private parseWindowInterval(raw: string): string {
    const w = raw.trim();
    const m = /^(\d+)(m|h)$/.exec(w);
    if (!m) {
      throw new BadRequestException(
        'Invalid window; use suffix m or h (e.g. "60m", "1h")',
      );
    }
    const n = Number(m[1]);
    const u = m[2];
    if (n < 1 || n > 168) {
      throw new BadRequestException("Window out of range (1–168 m or h)");
    }
    return u === "m" ? `${n} minutes` : `${n} hours`;
  }
}
