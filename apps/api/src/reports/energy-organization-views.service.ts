import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Pool } from "pg";

import {
  ABNORMAL_LIST_MAX,
  ABNORMAL_RATIO,
  BASELINE_WINDOWS,
  SITE_RANKING_MAX,
  TREND_SITE_SERIES_MAX,
  type EnergyHeatmapCell,
  type EnergyOrganizationViews,
  type EnergySiteEnergy,
  type EnergySiteTrend,
  type EnergyViewQuery,
  type JwtPayload,
} from "@bms/shared";

import { FLEET_POOL } from "../database/database.tokens";
import {
  abnormalEntries,
  baselineWindows,
  orderAndTrim,
  windowsWithinHorizon,
  type AbnormalList,
  type BaselineWindow,
} from "./energy-abnormal";
import { entityWindowReads, heatmapRead, siteEnergyRead, siteSeriesRead } from "./energy-organization-reads";
import type { EnergyViewPeriodRange } from "./energy-view-range";
import { EnergyViewService, type EnergyViewFrame } from "./energy-view.service";

/** The four reads, injectable so the spec can record what each receives. */
export type EnergyOrganizationReads = {
  readonly siteEnergyRead: typeof siteEnergyRead;
  readonly siteSeriesRead: typeof siteSeriesRead;
  readonly heatmapRead: typeof heatmapRead;
  readonly entityWindowReads: typeof entityWindowReads;
};

/** Nest provides no binding for this token, so `@Optional()` resolves the real reads. */
export const ENERGY_ORGANIZATION_READS = Symbol("ENERGY_ORGANIZATION_READS");

const SQL_READS: EnergyOrganizationReads = { siteEnergyRead, siteSeriesRead, heatmapRead, entityWindowReads };

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function bounds(range: EnergyViewPeriodRange): { from: string; to: string; durationHours: number } {
  return { from: range.start.toISOString(), to: range.end.toISOString(), durationHours: range.durationHours };
}

function roundSite(site: EnergySiteEnergy): EnergySiteEnergy {
  return { ...site, kwh: round(site.kwh, 2), peakKw: round(site.peakKw, 2) };
}

function roundTrend(trend: EnergySiteTrend): EnergySiteTrend {
  return { columns: trend.columns, points: trend.points.map((p) => ({ t: p.t, kw: p.kw.map((kw) => round(kw, 2)) })) };
}

function roundCell(cell: EnergyHeatmapCell): EnergyHeatmapCell {
  return { ...cell, kwh: round(cell.kwh, 2) };
}

function roundAbnormal(list: AbnormalList): AbnormalList {
  return {
    ...list,
    entries: list.entries.map((entry) => ({
      ...entry,
      currentKwh: round(entry.currentKwh, 2),
      baselineKwh: entry.baselineKwh === null ? null : round(entry.baselineKwh, 2),
      ratio: entry.ratio === null ? null : round(entry.ratio, 3),
    })),
  };
}

/**
 * `F4.299` U4 (ADR 0108 Amendment 1, 7) — the four organization views of the
 * Energy page, `GET /reports/energy/organization-views`: the sites ranked, the
 * total trend by site, the day × hour heatmap and the abnormal list.
 *
 * **One frame (7.2).** The place, its check order, the zone, the periods, the
 * level and bucket and the partial counts come from `EnergyViewService.frame`,
 * the one copy `energy/view` reads through as well; nothing here re-derives
 * them. A refusal is thrown by the frame, before any read.
 *
 * **Access before read (7.8).** Every read takes the frame's explicit
 * `assetIds` — never an id from the request. An empty list sends the empty
 * sections and runs no read at all.
 *
 * **Advisory only (7.7, ruling 4.7).** The abnormal verdict is computed and
 * sent; nothing here raises an alarm, evaluates a rule, sends a notification
 * or writes (`tests/f4.299-abnormal-is-advisory.test.ts`).
 *
 * The four sections read in parallel on the fleet pool (each joins the
 * FORCE-policied `bms.assets`; the asset list is the isolation control). The
 * reads return unrounded figures; this service rounds what it sends (kWh and
 * kW to 2 places, the ratio to 3) and judges on the unrounded ones.
 *
 * Provided by `ReportsModule`, never the loop-free core: it injects
 * `EnergyViewService`, which is provided there for the same reason.
 */
@Injectable()
export class EnergyOrganizationViewsService {
  private readonly reads: EnergyOrganizationReads;

  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    @Inject(EnergyViewService) private readonly views: Pick<EnergyViewService, "frame">,
    @Optional() @Inject(ENERGY_ORGANIZATION_READS) reads?: EnergyOrganizationReads,
  ) {
    this.reads = reads ?? SQL_READS;
  }

  async organizationViews(user: JwtPayload, query: EnergyViewQuery): Promise<EnergyOrganizationViews> {
    const frame = await this.views.frame(user, query);
    const timeZone = frame.zone.arithmeticZone;
    const { stepDays, windows } = baselineWindows(frame.current, timeZone, BASELINE_WINDOWS);
    const consulted = windowsWithinHorizon(windows, frame.level, frame.now);

    const empty = frame.assetIds.length === 0;
    const [sites, trend, cells, abnormal] = empty
      ? [
          { current: [], compare: null, totalSites: 0 },
          { columns: [], points: [] },
          [],
          { entries: [], normalCount: { sites: 0, assets: 0 }, truncated: false },
        ]
      : await Promise.all([
          this.sites(frame),
          this.reads.siteSeriesRead(this.pool, {
            level: frame.level,
            bucket: frame.bucket,
            timeZone,
            start: frame.current.start,
            end: frame.current.end,
            assetIds: frame.assetIds,
            siteLimit: TREND_SITE_SERIES_MAX,
          }),
          this.reads.heatmapRead(this.pool, {
            level: frame.level,
            timeZone,
            start: frame.current.start,
            end: frame.current.end,
            assetIds: frame.assetIds,
          }),
          this.abnormal(frame, consulted),
        ]);

    return {
      organizationId: frame.organizationId,
      timeZone: frame.zone.timeZone,
      generatedAt: new Date().toISOString(),
      level: frame.level,
      bucket: frame.bucket,
      current: bounds(frame.current),
      compare: frame.previous === null ? null : bounds(frame.previous),
      sites,
      trend: roundTrend(trend),
      heatmap: { cells: cells.map(roundCell) },
      abnormal: {
        // The windows inside the retention horizon: the ones the baseline read consults.
        baseline: { windows: BASELINE_WINDOWS, windowsConsulted: consulted.length, stepDays, ratio: ABNORMAL_RATIO },
        ...roundAbnormal(abnormal),
      },
      partial: frame.partial,
    };
  }

  /** The current period's top sites, then — with compare — the previous period for those sites only. */
  private async sites(frame: EnergyViewFrame): Promise<EnergyOrganizationViews["sites"]> {
    const current = await this.reads.siteEnergyRead(this.pool, {
      level: frame.level,
      start: frame.current.start,
      end: frame.current.end,
      assetIds: frame.assetIds,
      limit: SITE_RANKING_MAX,
    });
    const compare =
      frame.previous === null
        ? null
        : await this.reads.siteEnergyRead(this.pool, {
            level: frame.level,
            start: frame.previous.start,
            end: frame.previous.end,
            assetIds: frame.assetIds,
            limit: SITE_RANKING_MAX,
            locationIds: current.sites.map((site) => site.locationId),
          });
    return {
      current: current.sites.map(roundSite),
      compare: compare === null ? null : compare.sites.map(roundSite),
      totalSites: current.totalSites,
    };
  }

  /** One read over the current period (`idx 0`) and the windows inside the horizon; verdicts in TypeScript. */
  private async abnormal(frame: EnergyViewFrame, consulted: readonly BaselineWindow[]): Promise<AbnormalList> {
    const rows = await this.reads.entityWindowReads(this.pool, {
      level: frame.level,
      windows: [{ idx: 0, start: frame.current.start, end: frame.current.end }, ...consulted],
      assetIds: frame.assetIds,
    });
    return orderAndTrim(abnormalEntries(rows), ABNORMAL_LIST_MAX);
  }
}
