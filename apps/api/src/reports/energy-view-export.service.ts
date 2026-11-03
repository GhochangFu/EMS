import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import { TREND_SITE_SERIES_MAX, type EnergySiteTrend, type EnergyViewQuery, type JwtPayload } from "@bms/shared";

import { MAX_EXPORT_ROWS } from "../admin/audit/audit.limits";
import { FLEET_POOL } from "../database/database.tokens";
import { bucketSeconds } from "../telemetry/point-aggregates";
import { siteSeriesRead } from "./energy-organization-reads";
import type { EnergyViewPeriodRange } from "./energy-view-range";
import { energyPeriodRead } from "./energy-view-read";
import { EnergyViewService, type EnergyViewFrame } from "./energy-view.service";
import {
  assertViewExportWithinCap,
  energyViewExportRows,
  viewExportCsv,
  viewExportXlsx,
  type EnergyExportPeriod,
  type ViewExportRow,
} from "./view-export.serialise";

/** The by-source rows per display bucket and period: `grid`, `solar`, `dg`. */
const SOURCE_ROWS_PER_BUCKET = 3;

/**
 * `F4.303` U3 (ADR 0108 Amendment 6 item 3; plan C4) — the rows the file can
 * hold, from the frame alone, before any telemetry statement: three by-source
 * rows per display bucket per period, and one by-site row per display bucket
 * for each of the at most `TREND_SITE_SERIES_MAX` site columns plus `other`
 * (current period only, as on screen).
 */
export function energyViewExportRowCount(frame: Pick<EnergyViewFrame, "current" | "previous" | "bucket">): number {
  const buckets = Math.ceil((frame.current.durationHours * 3600) / bucketSeconds(frame.bucket));
  const periods = frame.previous === null ? 1 : 2;
  return SOURCE_ROWS_PER_BUCKET * buckets * periods + (TREND_SITE_SERIES_MAX + 1) * buckets;
}

/** The screen's rounding of the trend (`EnergyOrganizationViewsService`'s `roundTrend`): kW to 2 places. */
function roundedTrend(trend: EnergySiteTrend): EnergySiteTrend {
  return {
    columns: trend.columns,
    points: trend.points.map((point) => ({ t: point.t, kw: point.kw.map((kw) => Math.round(kw * 100) / 100) })),
  };
}

/**
 * `F4.303` U3 (ADR 0108 Amendment 6 item 3) — `GET /reports/energy/view/export.csv|.xlsx`.
 *
 * **One figure for the screen and the file.** The export parses the screen's
 * own `energyViewQuerySchema` and reads through `EnergyViewService.frame`, the
 * one copy of the place, its check order, the zone, the periods, the level and
 * the bucket; then the series read `energy/view` runs per period
 * (`energyPeriodRead`) and the site-trend read `organization-views` runs
 * (`siteSeriesRead`, current period only). Not the KPIs, the heatmap or the
 * abnormal reads: the file holds no column for them. No new SQL statement.
 *
 * **Order.** The frame (every refusal, before any telemetry statement), then
 * the row cap over the frame's arithmetic, then the reads. The range bound is
 * the view's own 365 days: this path never passes through `energyReportRange`
 * and its 31 days (Amendment 6 item 3, "The old 31-day limit").
 *
 * **Not audited**, as `energy/export.*` is not. Telemetry runs on the fleet
 * pool with the frame's explicit asset list, `EnergyViewService`'s reason.
 *
 * Provided by `ReportsModule`, never the loop-free core: it injects
 * `EnergyViewService`, which sits there for its `ReportScopeService`.
 */
@Injectable()
export class EnergyViewExportService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pick<Pool, "query">,
    @Inject(EnergyViewService) private readonly views: Pick<EnergyViewService, "frame">,
  ) {}

  /** The file's rows. `cap` is a seam for the specs; the routes pass nothing. */
  async rows(user: JwtPayload, query: EnergyViewQuery, cap: number = MAX_EXPORT_ROWS): Promise<ViewExportRow[]> {
    const frame = await this.views.frame(user, query);
    assertViewExportWithinCap(energyViewExportRowCount(frame), cap);

    const timeZone = frame.zone.arithmeticZone;
    const read = async (range: EnergyViewPeriodRange): Promise<EnergyExportPeriod> => {
      const { series } = await energyPeriodRead(this.pool, {
        level: frame.level,
        bucket: frame.bucket,
        timeZone,
        start: range.start,
        end: range.end,
        assetIds: frame.assetIds,
      });
      return { from: range.start.toISOString(), to: range.end.toISOString(), series };
    };
    const current = await read(frame.current);
    const compare = frame.previous === null ? null : await read(frame.previous);
    const trend = await siteSeriesRead(this.pool, {
      level: frame.level,
      bucket: frame.bucket,
      timeZone,
      start: frame.current.start,
      end: frame.current.end,
      assetIds: frame.assetIds,
      siteLimit: TREND_SITE_SERIES_MAX,
    });

    return energyViewExportRows(
      { timeZone: frame.zone.timeZone, level: frame.level, bucket: frame.bucket, current, compare },
      roundedTrend(trend),
    );
  }

  async csv(user: JwtPayload, query: EnergyViewQuery): Promise<string> {
    return viewExportCsv(await this.rows(user, query));
  }

  async xlsx(user: JwtPayload, query: EnergyViewQuery): Promise<Buffer> {
    return viewExportXlsx(await this.rows(user, query));
  }
}
