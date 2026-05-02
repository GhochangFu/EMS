import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Pool } from "pg";
import type { LocationDashboardDto, LocationKpiSummary } from "@bms/shared";

import { POOL_TOKEN } from "../database/database.tokens";

@Injectable()
export class DashboardService {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}

  /** Returns location KPI cards for the current access scope. */
  async locationKpis(opts?: {
    locationIds?: string[] | null;
    assetIds?: string[] | null;
    partial?: boolean;
  }): Promise<{ items: LocationKpiSummary[] }> {
    const rows = await this.pool.query<{
      id: string;
      name: string;
      type: "smoc_campus" | "rsmoc" | "csmoc";
      province: string | null;
      asset_count: string;
      fresh_asset_count: string;
      total_kw: string;
      open_alarms: string;
      critical_alarms: string;
    }>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (asset_id) asset_id, time AS kw_time, value AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw'
        ORDER BY asset_id, time DESC
      )
      SELECT
        l.id,
        l.name,
        l.type,
        l.province,
        COUNT(DISTINCT a.id)::int AS asset_count,
        COUNT(DISTINCT a.id) FILTER (
          WHERE latest.kw_time > now() - interval '25 seconds'
        )::int AS fresh_asset_count,
        COALESCE(SUM(latest.kw), 0)::float8 AS total_kw,
        COUNT(DISTINCT al.id) FILTER (WHERE al.acknowledged_at IS NULL)::int AS open_alarms,
        COUNT(DISTINCT al.id) FILTER (
          WHERE al.acknowledged_at IS NULL AND al.severity = 'critical'
        )::int AS critical_alarms
      FROM bms.locations l
      LEFT JOIN bms.assets a
        ON a.location_id = l.id
       AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      LEFT JOIN latest ON latest.asset_id = a.id
      LEFT JOIN bms.alarms al ON al.asset_id = a.id
      WHERE l.active = true
        AND ($1::uuid[] IS NULL OR l.id = ANY($1::uuid[]))
      GROUP BY l.id, l.name, l.type, l.province
      ORDER BY l.name
      `,
      [opts?.locationIds ?? null, opts?.assetIds ?? null],
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        province: row.province,
        assetCount: Number(row.asset_count),
        freshAssetCount: Number(row.fresh_asset_count),
        totalKw: this.round(Number(row.total_kw)),
        openAlarms: Number(row.open_alarms),
        criticalAlarms: Number(row.critical_alarms),
        scopeLabel: opts?.partial ? "partial" : "full",
      })),
    };
  }

  /** Returns the scoped detail payload for one location dashboard. */
  async locationDashboard(
    locationId: string,
    opts?: {
      locationIds?: string[] | null;
      assetIds?: string[] | null;
      partial?: boolean;
    },
  ): Promise<LocationDashboardDto | null> {
    if (opts?.locationIds && !opts.locationIds.includes(locationId)) {
      return null;
    }
    const summary = await this.locationKpis({ ...opts, locationIds: [locationId] });
    const card = summary.items[0];
    if (!card) {
      return null;
    }
    const topAssets = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      domain: string;
      kw: string | null;
    }>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (asset_id) asset_id, value AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw'
        ORDER BY asset_id, time DESC
      )
      SELECT a.id, a.code, a.name, a.domain, latest.kw::float8 AS kw
      FROM bms.assets a
      LEFT JOIN latest ON latest.asset_id = a.id
      WHERE a.location_id = $1
        AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      ORDER BY latest.kw DESC NULLS LAST, a.code
      LIMIT 8
      `,
      [locationId, opts?.assetIds ?? null],
    );
    const workOrders = await this.pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::int AS count
      FROM bms.work_orders wo
      INNER JOIN bms.assets a ON a.id = wo.asset_id
      WHERE a.location_id = $1
        AND wo.status <> 'closed'
        AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      `,
      [locationId, opts?.assetIds ?? null],
    );
    return {
      ...card,
      topAssets: topAssets.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        domain: row.domain,
        kw: row.kw === null ? null : this.round(Number(row.kw)),
      })),
      workOrdersOpen: Number(workOrders.rows[0]?.count ?? 0),
    };
  }

  /**
   * KPI row for the Executive Dashboard: sums latest kW per asset, live site count,
   * and open alarms from `bms.alarms`.
   */
  async kpis(assetIds?: string[] | null): Promise<{
    totalKw: number;
    sitesOnline: number;
    sitesTotal: number;
    alarmsOpen: number;
    alarmsCritical: number;
    pueEstimate: number;
    asOf: string;
  }> {
    if (assetIds && assetIds.length === 0) {
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
        WHERE point_key = 'kw' AND ($1::uuid[] IS NULL OR asset_id = ANY($1::uuid[]))
        ORDER BY asset_id, time DESC
      ),
      asset_sites AS (
        SELECT id, site_name FROM bms.assets
        WHERE ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
      )
      SELECT
        (SELECT COALESCE(SUM(kw), 0) FROM kw_latest)::float8 AS total_kw,
        (SELECT COUNT(DISTINCT s.site_name)::int FROM kw_latest k
          JOIN asset_sites s ON s.id = k.asset_id
          WHERE k.kw_time > now() - interval '20 seconds') AS sites_online,
        (SELECT COUNT(DISTINCT site_name)::int FROM asset_sites) AS sites_total,
        (SELECT COUNT(*)::int FROM bms.alarms al INNER JOIN asset_sites s ON s.id = al.asset_id WHERE acknowledged_at IS NULL) AS alarms_open,
        (SELECT COUNT(*)::int FROM bms.alarms al INNER JOIN asset_sites s ON s.id = al.asset_id WHERE acknowledged_at IS NULL AND severity = 'critical') AS alarms_critical
    `,
      [assetIds ?? null],
    );
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
  async loadTrend(windowRaw?: string, assetIds?: string[] | null): Promise<{
    points: { t: string; totalKw: number }[];
  }> {
    const intervalText = this.parseWindowInterval(windowRaw ?? "60m");
    if (assetIds && assetIds.length === 0) {
      return { points: [] };
    }
    const r = await this.pool.query<{ bucket: Date; total_kw: string }>(
      `
      WITH per AS (
        SELECT date_trunc('minute', time) AS bucket, asset_id, avg(value) AS kw
        FROM telemetry.point_values
        WHERE point_key = 'kw'
          AND time > now() - $1::interval
          AND ($2::uuid[] IS NULL OR asset_id = ANY($2::uuid[]))
        GROUP BY 1, 2
      ),
      agg AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      )
      SELECT bucket, total_kw FROM agg ORDER BY bucket ASC
      `,
      [intervalText, assetIds ?? null],
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

  private round(value: number): number {
    return Math.round(value * 100) / 100;
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

  async energySummary(windowRaw?: string, assetIds?: string[] | null): Promise<{
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
    if (assetIds && assetIds.length === 0) {
      return {
        window: windowLabel,
        totalKwh: 0,
        peakKw: 0,
        pueEstimate: 1,
        indicativeCostZar: 0,
        tariffZarPerKwh: this.energyTariffZar(),
        asOf: new Date().toISOString(),
      };
    }
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
        WHERE point_key = 'kw'
          AND time > now() - $1::interval
          AND ($3::uuid[] IS NULL OR asset_id = ANY($3::uuid[]))
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
      [intervalSql, kwhFactor, assetIds ?? null],
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

  async energySourceMix(windowRaw?: string, assetIds?: string[] | null): Promise<{
    points: { t: string; gridKw: number; solarKw: number; dgKw: number }[];
  }> {
    const { intervalSql, useHourlyBuckets } = this.parseEnergyWindow(windowRaw);
    if (assetIds && assetIds.length === 0) {
      return { points: [] };
    }
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
        WHERE point_key = 'kw'
          AND time > now() - $1::interval
          AND ($2::uuid[] IS NULL OR asset_id = ANY($2::uuid[]))
        GROUP BY 1, 2
      ),
      solar_ids AS (
        SELECT id FROM bms.assets
        WHERE code ILIKE 'PV%' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
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
      [intervalSql, assetIds ?? null],
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
    assetIds?: string[] | null,
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
    if (assetIds && assetIds.length === 0) {
      return { consumers: [] };
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
        AND v.time > now() - $1::interval
        AND ($3::uuid[] IS NULL OR a.id = ANY($3::uuid[]))
      GROUP BY a.id, a.code, a.name, a.site_name
      ORDER BY avg_kw DESC
      LIMIT $2
      `,
      [intervalSql, lim, assetIds ?? null],
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
