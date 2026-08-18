import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Pool } from "pg";
import type { LocationDashboardDto, LocationKpiSummary } from "@bms/shared";

import { POOL_TOKEN } from "../database/database.tokens";
import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  levelForRange,
} from "../telemetry/point-aggregates";

type LocationDashboardAssetRow = LocationDashboardDto["assets"]["items"][number];
type LocationDashboardTelemetrySample = LocationDashboardAssetRow["telemetry"][number];

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
      org_id: string;
      org_code: string;
      org_name: string;
      rtu_count: string;
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
        o.id AS org_id,
        o.code AS org_code,
        o.name AS org_name,
        COUNT(DISTINCT r.id)::int AS rtu_count,
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
      INNER JOIN bms.organizations o ON o.id = l.organization_id
      LEFT JOIN bms.rtus r ON r.location_id = l.id
      LEFT JOIN bms.assets a
        ON a.location_id = l.id
       AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      LEFT JOIN latest ON latest.asset_id = a.id
      LEFT JOIN bms.alarms al ON al.asset_id = a.id
      WHERE l.active = true
        AND ($1::uuid[] IS NULL OR l.id = ANY($1::uuid[]))
      GROUP BY l.id, l.name, l.type, l.province, o.id, o.code, o.name
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
        organization: {
          id: row.org_id,
          code: row.org_code,
          name: row.org_name,
        },
        rtuCount: Number(row.rtu_count),
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
      page?: number;
      pageSize?: number;
      rtuId?: string;
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
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const rtuRows = await this.pool.query<{
      id: string;
      code: string;
      display_name: string;
      source_type: "mqtt" | "simulator" | "catalog";
      domain: string | null;
      ingest_enabled: boolean;
      asset_count: string;
      fresh_asset_count: string;
    }>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (asset_id) asset_id, time AS kw_time
        FROM telemetry.point_values
        WHERE point_key = 'kw'
        ORDER BY asset_id, time DESC
      )
      SELECT
        r.id,
        r.code,
        r.display_name,
        r.source_type,
        r.domain,
        r.ingest_enabled,
        COUNT(DISTINCT a.id)::int AS asset_count,
        COUNT(DISTINCT a.id) FILTER (
          WHERE latest.kw_time > now() - interval '25 seconds'
        )::int AS fresh_asset_count
      FROM bms.rtus r
      LEFT JOIN bms.assets a
        ON a.rtu_id = r.id
       AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
      LEFT JOIN latest ON latest.asset_id = a.id
      WHERE r.location_id = $1
      GROUP BY r.id, r.code, r.display_name, r.source_type, r.domain, r.ingest_enabled
      ORDER BY r.display_name
      `,
      [locationId, opts?.assetIds ?? null],
    );

    const assetsPage = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      domain: string;
      // ADR 0018: LEFT JOIN — null for a gateway-less asset.
      rtu_id: string | null;
      rtu_display_name: string | null;
      latest_kw: string | null;
      latest_telemetry_at: Date | string | null;
      latest_telemetry: unknown;
      open_alarm_count: string;
      critical_alarm_count: string;
      warning_alarm_count: string;
      latest_alarm_severity: string | null;
      latest_alarm_message: string | null;
      latest_alarm_raised_at: Date | string | null;
      open_work_order_count: string;
    }>(
      `
      WITH scoped_assets AS (
        SELECT a.id, a.code, a.name, a.domain, a.rtu_id, r.display_name AS rtu_display_name
        FROM bms.assets a
        -- ADR 0018: LEFT JOIN. An inner join drops gateway-less assets, so an
        -- asset with a critical alarm would vanish from its own location
        -- dashboard while its work orders were still counted below — the same
        -- silent-invisibility defect this ADR exists to remove.
        LEFT JOIN bms.rtus r ON r.id = a.rtu_id
        WHERE a.location_id = $1
          AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
          AND ($5::uuid IS NULL OR a.rtu_id = $5::uuid)
        ORDER BY r.display_name NULLS LAST, a.code
        LIMIT $3 OFFSET $4
      ),
      latest_points AS (
        SELECT DISTINCT ON (pv.asset_id, pv.point_key)
          pv.asset_id,
          pv.point_key,
          pv.value,
          pv.unit,
          pv.time
        FROM telemetry.point_values pv
        INNER JOIN scoped_assets sa ON sa.id = pv.asset_id
        ORDER BY pv.asset_id, pv.point_key, pv.time DESC
      ),
      telemetry AS (
        SELECT
          asset_id,
          MAX(time) AS latest_telemetry_at,
          MAX(value) FILTER (WHERE point_key = 'kw') AS latest_kw,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'pointKey', point_key,
                'value', value,
                'unit', unit,
                'time', time
              )
              ORDER BY
                CASE point_key
                  WHEN 'kw' THEN 1
                  WHEN 'voltage_l1_v' THEN 2
                  WHEN 'current_a' THEN 3
                  WHEN 'pf' THEN 4
                  WHEN 'supply_air_temp_c' THEN 5
                  WHEN 'return_air_temp_c' THEN 6
                  WHEN 'fan_speed_pct' THEN 7
                  WHEN 'cooling_kw' THEN 8
                  WHEN 'rack_kw' THEN 9
                  WHEN 'rack_temp_c' THEN 10
                  WHEN 'temperature_c' THEN 11
                  WHEN 'humidity_pct' THEN 12
                  ELSE 99
                END,
                point_key
            ),
            '[]'::jsonb
          ) AS latest_telemetry
        FROM latest_points
        GROUP BY asset_id
      ),
      alarm_rollup AS (
        SELECT
          al.asset_id,
          COUNT(*) FILTER (WHERE al.acknowledged_at IS NULL)::int AS open_alarm_count,
          COUNT(*) FILTER (
            WHERE al.acknowledged_at IS NULL AND al.severity = 'critical'
          )::int AS critical_alarm_count,
          -- F4.46: this read IN ('warning', 'major'). 'major' is the mockup's
          -- word for a warning (ESKOM_SMOC.html), not a value this product
          -- stores -- it is in no contract, no schema and no row. Measured
          -- 2026-08-18: bms.alarms holds warning 20 / critical 19 / info 1.
          -- The predicate matched nothing, so dropping it changes no count; it
          -- stops the query implying a vocabulary that does not exist.
          --
          -- These two sub-counts name two severities and count only those, so a
          -- row holding anything else is in open_alarm_count and in neither of
          -- them. That asymmetry is deliberate and it is NOT introduced here:
          -- the old predicate excluded every unrecognised value too, except the
          -- single literal 'major' that never occurs. Widening either sub-count
          -- to absorb unknowns would be the mirror of the bug F4.46 just fixed
          -- on the web side -- counting a value we cannot classify as one we
          -- can. If the unknown case ever needs to be visible here, it wants
          -- its own unrecognised_alarm_count, not a wider WHERE.
          COUNT(*) FILTER (
            WHERE al.acknowledged_at IS NULL AND al.severity = 'warning'
          )::int AS warning_alarm_count,
          (ARRAY_AGG(al.severity ORDER BY al.raised_at DESC) FILTER (
            WHERE al.acknowledged_at IS NULL
          ))[1] AS latest_alarm_severity,
          (ARRAY_AGG(al.message ORDER BY al.raised_at DESC) FILTER (
            WHERE al.acknowledged_at IS NULL
          ))[1] AS latest_alarm_message,
          (ARRAY_AGG(al.raised_at ORDER BY al.raised_at DESC) FILTER (
            WHERE al.acknowledged_at IS NULL
          ))[1] AS latest_alarm_raised_at
        FROM bms.alarms al
        INNER JOIN scoped_assets sa ON sa.id = al.asset_id
        GROUP BY al.asset_id
      ),
      work_order_rollup AS (
        SELECT
          wo.asset_id,
          COUNT(*) FILTER (WHERE wo.status <> 'closed')::int AS open_work_order_count
        FROM bms.work_orders wo
        INNER JOIN scoped_assets sa ON sa.id = wo.asset_id
        GROUP BY wo.asset_id
      )
      SELECT
        sa.id,
        sa.code,
        sa.name,
        sa.domain,
        sa.rtu_id,
        sa.rtu_display_name,
        telemetry.latest_kw::float8 AS latest_kw,
        telemetry.latest_telemetry_at,
        COALESCE(telemetry.latest_telemetry, '[]'::jsonb) AS latest_telemetry,
        COALESCE(alarm_rollup.open_alarm_count, 0)::int AS open_alarm_count,
        COALESCE(alarm_rollup.critical_alarm_count, 0)::int AS critical_alarm_count,
        COALESCE(alarm_rollup.warning_alarm_count, 0)::int AS warning_alarm_count,
        alarm_rollup.latest_alarm_severity,
        alarm_rollup.latest_alarm_message,
        alarm_rollup.latest_alarm_raised_at,
        COALESCE(work_order_rollup.open_work_order_count, 0)::int AS open_work_order_count
      FROM scoped_assets sa
      LEFT JOIN telemetry ON telemetry.asset_id = sa.id
      LEFT JOIN alarm_rollup ON alarm_rollup.asset_id = sa.id
      LEFT JOIN work_order_rollup ON work_order_rollup.asset_id = sa.id
      ORDER BY sa.rtu_display_name NULLS LAST, sa.code
      `,
      [locationId, opts?.assetIds ?? null, pageSize, offset, opts?.rtuId ?? null],
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
    const assetItems = assetsPage.rows.map((row): LocationDashboardAssetRow => {
      const latestTelemetryAt = this.toIsoString(row.latest_telemetry_at);
      const latestAlarmRaisedAt = this.toIsoString(row.latest_alarm_raised_at);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        domain: row.domain,
        rtuId: row.rtu_id,
        rtuDisplayName: row.rtu_display_name,
        latestKw:
          row.latest_kw === null ? null : this.round(Number(row.latest_kw)),
        latestTelemetryAt,
        freshness: this.telemetryFreshness(latestTelemetryAt),
        telemetry: this.parseTelemetrySamples(row.latest_telemetry),
        openAlarmCount: Number(row.open_alarm_count),
        criticalAlarmCount: Number(row.critical_alarm_count),
        warningAlarmCount: Number(row.warning_alarm_count),
        latestAlarm:
          row.latest_alarm_severity &&
          row.latest_alarm_message &&
          latestAlarmRaisedAt
            ? {
                severity: row.latest_alarm_severity,
                message: row.latest_alarm_message,
                raisedAt: latestAlarmRaisedAt,
              }
            : null,
        openWorkOrderCount: Number(row.open_work_order_count),
      };
    });
    const totalPages =
      card.assetCount === 0 ? 0 : Math.ceil(card.assetCount / pageSize);
    return {
      ...card,
      rtus: rtuRows.rows.map((row) => ({
        id: row.id,
        code: row.code,
        displayName: row.display_name,
        sourceType: row.source_type,
        domain: row.domain,
        ingestEnabled: row.ingest_enabled,
        assetCount: Number(row.asset_count),
        freshAssetCount: Number(row.fresh_asset_count),
      })),
      assets: {
        items: assetItems,
        page,
        pageSize,
        total: card.assetCount,
        totalPages,
      },
      topAssets: assetItems.slice(0, 8).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        domain: row.domain,
        kw: row.latestKw,
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
    const { intervalSql, durationHours } = this.parseWindowInterval(windowRaw ?? "60m");
    if (assetIds && assetIds.length === 0) {
      return { points: [] };
    }
    // ADR 0025 (`F4.28`) site 1 — reads `_1m` rather than `date_trunc('minute')`
    // over raw. Granularity is always `1m`: this chart plots minute buckets at
    // every window width up to 168 hours, so the level must not be derived from
    // the duration or a 7-day window would silently become an hourly chart.
    //
    // `${avgExpr()}`, not `avg(value)`. One `_1m` row feeds each output bucket
    // here, so the naive form would agree — but the *next* reader to widen this
    // to hourly buckets inherits a correct expression instead of a landmine.
    // Measured at parity per bucket across 94 buckets, worst error 0 (ADR 0025
    // fact 1).
    const { level } = levelForRange({
      start: this.trailingStart(durationHours),
      granularity: "1m",
    });
    const r = await this.pool.query<{ bucket: Date; total_kw: string }>(
      `
      WITH per AS (
        SELECT bucket, asset_id, ${avgExpr()} AS kw
        FROM ${aggregateRelation(level)}
        WHERE point_key = 'kw'
          AND bucket > now() - $1::interval
          AND ($2::uuid[] IS NULL OR asset_id = ANY($2::uuid[]))
        GROUP BY 1, 2
      ),
      agg AS (
        SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
      )
      SELECT bucket, total_kw FROM agg ORDER BY bucket ASC
      `,
      [intervalSql, assetIds ?? null],
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

  private toIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  private telemetryFreshness(
    latestTelemetryAt: string | null,
  ): "live" | "stale" | "none" {
    if (!latestTelemetryAt) {
      return "none";
    }
    const ageMs = Date.now() - new Date(latestTelemetryAt).getTime();
    return ageMs <= 25_000 ? "live" : "stale";
  }

  private parseTelemetrySamples(raw: unknown): LocationDashboardTelemetrySample[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const samples: LocationDashboardTelemetrySample[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const pointKey = record.pointKey;
      const value = record.value;
      const unit = record.unit;
      const time = record.time;
      if (
        typeof pointKey !== "string" ||
        typeof value !== "number" ||
        (unit !== null && typeof unit !== "string") ||
        typeof time !== "string"
      ) {
        continue;
      }
      samples.push({
        pointKey,
        value: this.round(value),
        unit,
        time,
      });
    }
    return samples;
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
    const { intervalSql, useHourlyBuckets, windowLabel, durationHours } =
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
    // ADR 0023 (`F4.1`) — this reads the continuous aggregates, not raw
    // `point_values`. Measured 2026-08-10 on the pilot database: 144.7 ms → 11.8
    // ms cold, 32.7 → 5.4 ms warm for the hourly window.
    //
    // The mean is `sum(sum_value) / sum(sample_count)` via `avgExpr`, never an
    // average of averages — over these same five days the naive form was wrong
    // in 151 of 169 buckets while still agreeing on the window total. Do not
    // "simplify" it.
    //
    // The newest bucket stays correct because migration `0027` sets
    // `materialized_only = false`, so the view unions its stored rows with a
    // live aggregate over the un-materialized tail. That branch is exact
    // (7.1e-14 against raw, three levels deep) — the aggregate is not an
    // approximation of the raw query, it is the same number.
    //
    // ADR 0025 decision 2 (`F4.28`): the level now comes from `levelForRange`
    // rather than the inline ternary this line used to be. Same answer for every
    // window this method can produce — `parseEnergyWindow` caps at 168 hours OR 30
    // days, so 720 hours is the real bound, still three orders of magnitude inside
    // `_1m`'s 735-day horizon — but there is now exactly one implementation of level
    // choice, and it is the one carrying the retention guard.
    const { level } = levelForRange({
      start: this.trailingStart(durationHours),
      granularity: useHourlyBuckets ? "1h" : "1m",
    });
    const kwhFactor = bucketHours(level);

    const r = await this.pool.query<{
      total_kwh: string;
      peak_kw: string;
      avg_kw: string;
    }>(
      `
      WITH per AS (
        SELECT bucket, asset_id, ${avgExpr()} AS kw
        FROM ${aggregateRelation(level)}
        WHERE point_key = 'kw'
          AND bucket > now() - $1::interval
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
    const { intervalSql, useHourlyBuckets, durationHours } =
      this.parseEnergyWindow(windowRaw);
    if (assetIds && assetIds.length === 0) {
      return { points: [] };
    }
    // ADR 0025 (`F4.28`) site 2 — the level's own bucket width *is* the display
    // granularity, so `bucket` replaces `date_trunc('${trunc}', time)` and the
    // `trunc` string is gone entirely. That also removes an interpolated
    // identifier from the SQL, which §4.4 could never parameterise.
    //
    // Measured at parity per bucket over 29 hour buckets on both the total and
    // the solar series, worst error 1.7e-13 (ADR 0025 fact 1).
    const { level } = levelForRange({
      start: this.trailingStart(durationHours),
      granularity: useHourlyBuckets ? "1h" : "1m",
    });

    const r = await this.pool.query<{
      bucket: Date;
      total_kw: string;
      solar_kw: string;
    }>(
      `
      WITH per AS (
        SELECT bucket, asset_id, ${avgExpr()} AS kw
        FROM ${aggregateRelation(level)}
        WHERE point_key = 'kw'
          AND bucket > now() - $1::interval
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

    // ADR 0025 (`F4.28`) site 3 — and the one dashboard site where `avgExpr`
    // earns its existence.
    //
    // There is **no display bucket** here: every source row for an asset folds
    // into one mean, measured at up to **1172** `_1m` rows per asset over 24 h
    // (ADR 0025 fact 2). So this is the shape where the naive average-of-averages
    // form is detectably wrong — measured wrong in **29 of 29** assets, worst
    // 0.0458 kW (fact 3) — unlike the fold-1 sites above, where both forms agree
    // and a parity test proves nothing about the expression.
    //
    // `sum(sum_value) / sum(sample_count)` over the window is exactly
    // `sum(value) / count(value)` over the same rows, so this is an algebraic
    // identity with the raw query rather than a close approximation: measured 0
    // mismatches across 29 assets, worst 1.4e-13.
    //
    // Granularity `1m` — the finest level, since nothing here displays buckets and
    // a coarser level would only lose precision at the window edge.
    const { level } = levelForRange({
      start: this.trailingStart(durationHours),
      granularity: "1m",
    });

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
        AND v.bucket > now() - $1::interval
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

  private parseWindowInterval(raw: string): {
    intervalSql: string;
    durationHours: number;
  } {
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
    // `durationHours` is returned for `levelForRange`'s retention guard, which
    // needs how far back the window reaches. It does not reach the SQL — the
    // predicate still uses `intervalSql`, so the window boundary is unchanged.
    return u === "m"
      ? { intervalSql: `${n} minutes`, durationHours: n / 60 }
      : { intervalSql: `${n} hours`, durationHours: n };
  }

  /**
   * The `start` a trailing window reaches back to, for {@link levelForRange}.
   *
   * ADR 0025 decision 1: the retention guard is a function of `start` and `now`,
   * never of the range's end. Every dashboard window is trailing and capped at
   * **720 hours** — `parseEnergyWindow` allows `1-168h` or `1-30d`, and 30 days is
   * the larger of the two, so quoting 168 understates it — which is still far
   * inside every horizon, so no call here can escalate. The guard exists for the
   * reads that come later, and this keeps every site expressing its range the same
   * way.
   */
  private trailingStart(durationHours: number): Date {
    return new Date(Date.now() - durationHours * 3_600_000);
  }
}
