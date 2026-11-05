import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";

import { assetPoints, assets, locations, rtus } from "@bms/db";
import { assetLabel, type AggregateLevel, type TrendPointsReportParams } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import { levelFor, resolveAggregateRange, windowBoundsFor } from "../telemetry/point-aggregate-window";
import { TelemetryService } from "../telemetry/telemetry.service";
import { renderPdf } from "./energy-pdf";
import { addLocalDays, toInstant, type LocalDate } from "./report-period";
import { assertFiniteCells } from "./reports.serialise";
import {
  trendPointsPdfDefinition,
  trendPointsReportRows,
  type TrendPointsReportPoint,
  type TrendPointsReportRows,
} from "./trend-points-pdf";

/** What the render hands the plan: the schedule's facts, its stored trend params and the resolved asset ids. */
export interface TrendPointsPlanInput {
  readonly scheduleName: string;
  /** The schedule's IANA zone: the period's instants are its local midnights. */
  readonly timezone: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly params: TrendPointsReportParams;
  /** `resolveAssetIds(location_ids)` on the render's tenant transaction. */
  readonly assetIds: readonly string[];
  readonly now: Date;
}

/** One pair kept for the report: still in the schedule's assets, still an active registration. */
export interface TrendPointsKeptPair {
  readonly assetId: string;
  readonly pointKey: string;
  readonly unit: string | null;
  readonly assetCode: string;
  /** `F4.316` (ADR 0111): the asset's RTU display name, `null` when it has none. */
  readonly assetRtuName: string | null;
  /** `F4.316`: the asset's location name, the label's `where` when there is no RTU. */
  readonly assetLocationName: string | null;
}

/** The plan: no telemetry read yet — the window, the level, the kept pairs and the dropped pairs' names. */
export interface TrendPointsPlan {
  readonly scheduleName: string;
  readonly timezone: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly compare: boolean;
  readonly from: Date;
  readonly to: Date;
  readonly windowMinutes: number;
  readonly level: AggregateLevel;
  readonly now: Date;
  readonly total: number;
  readonly kept: readonly TrendPointsKeptPair[];
  /** `<asset label> · <point code>`, or `a deleted asset · <point code>`, in stored order. */
  readonly dropped: readonly string[];
}

const MIDNIGHT = { hour: 0, minute: 0 } as const;
const DELETED_ASSET = "a deleted asset";

function localDate(iso: string): LocalDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year as number, month: month as number, day: day as number };
}

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, `trend_points`; plan C19) — the `trend_points`
 * report a schedule renders over the cadence period that just ended.
 *
 * **Two steps, so a retry pays nothing it does not need.** `plan` runs no telemetry read: the
 * window (local midnight of `periodStart` to local midnight after `periodEnd` in the schedule's
 * zone — a point report is a site view, ruling 4.3), the level `pointAggregate` will read at
 * (`levelFor` over that window with the same `now`, so the printed level is the read's level: a
 * day reads `1m`, a week or a 30-day month `1h`), and the pairs kept or dropped — two selects on
 * the render's tenant transaction, so a foreign asset is invisible. `read` then calls
 * `TelemetryService.pointAggregate` once per kept pair — the asset history page's read
 * (`bucketFunction: "avg"`, `bucketStats: true`, `compare = params.compare`), so the report and
 * the page show one figure — and builds the rows with the one `trendPointsReportRows` call.
 *
 * **Kept and dropped.** A pair is kept when its asset is among the schedule's resolved assets and
 * the code is an active `bms.asset_points` registration of it; every other pair is dropped and
 * named by its asset's label (`F4.316`, ADR 0111: `<code> · <RTU>`, else `<code> · <location>`),
 * or "a deleted asset" when the row is gone or invisible under the tenant policy. Never an id.
 * Both selects LEFT JOIN `bms.rtus` and `bms.locations` for the label on the same `tx`, adding no
 * predicate.
 *
 * **Wiring.** `TelemetryService` is a provider of `ReportsCoreModule` (stateless: three pool
 * tokens from the `@Global()` `DatabaseModule`), never reached through `TelemetryModule`, a loop
 * module the worker must not import (`tests/f4.24-worker-imports-no-api-loop.test.ts`).
 */
@Injectable()
export class TrendPointsReportService {
  constructor(private readonly telemetry: TelemetryService) {}

  /** The window, the level and the kept and dropped pairs — two selects on `tx`, no telemetry. */
  async plan(input: TrendPointsPlanInput, tx: BmsTx): Promise<TrendPointsPlan> {
    const { params, timezone, now } = input;
    const fromInstant = toInstant(localDate(input.periodStart), MIDNIGHT, timezone);
    const toInstantExclusive = toInstant(addLocalDays(localDate(input.periodEnd), 1), MIDNIGHT, timezone);
    const range = resolveAggregateRange({ from: fromInstant.toISOString(), to: toInstantExclusive.toISOString() }, now);
    const level = levelFor(windowBoundsFor(range, params.compare), range.windowMinutes, now);

    const inScope = new Set(input.assetIds);
    const candidates = [...new Set(params.points.map((pair) => pair.assetId))].filter((id) => inScope.has(id));
    const registrations =
      candidates.length === 0
        ? []
        : await tx
            .select({
              assetId: assetPoints.assetId,
              pointKey: assetPoints.pointKey,
              unit: assetPoints.unit,
              assetCode: assets.code,
              assetRtuName: rtus.displayName,
              assetLocationName: locations.name,
            })
            .from(assetPoints)
            .innerJoin(assets, eq(assets.id, assetPoints.assetId))
            .leftJoin(rtus, eq(rtus.id, assets.rtuId))
            .leftJoin(locations, eq(locations.id, assets.locationId))
            .where(and(inArray(assetPoints.assetId, candidates), eq(assetPoints.active, true)));

    const kept: TrendPointsKeptPair[] = [];
    const droppedPairs: TrendPointsReportParams["points"] = [];
    for (const pair of params.points) {
      const found = inScope.has(pair.assetId)
        ? registrations.find((row) => row.assetId === pair.assetId && row.pointKey === pair.pointKey)
        : undefined;
      if (found === undefined) {
        droppedPairs.push(pair);
      } else {
        kept.push({
          assetId: found.assetId,
          pointKey: found.pointKey,
          unit: found.unit,
          assetCode: found.assetCode,
          assetRtuName: found.assetRtuName,
          assetLocationName: found.assetLocationName,
        });
      }
    }

    const droppedIds = [...new Set(droppedPairs.map((pair) => pair.assetId))];
    const names =
      droppedIds.length === 0
        ? []
        : await tx
            .select({ id: assets.id, code: assets.code, rtuName: rtus.displayName, locationName: locations.name })
            .from(assets)
            .leftJoin(rtus, eq(rtus.id, assets.rtuId))
            .leftJoin(locations, eq(locations.id, assets.locationId))
            .where(inArray(assets.id, droppedIds));
    const labelOf = new Map(names.map((row) => [row.id, assetLabel(row)]));
    const dropped = droppedPairs.map((pair) => `${labelOf.get(pair.assetId) ?? DELETED_ASSET} · ${pair.pointKey}`);

    return {
      scheduleName: input.scheduleName,
      timezone,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      compare: params.compare,
      from: range.from,
      to: range.to,
      windowMinutes: range.windowMinutes,
      level,
      now,
      total: params.points.length,
      kept,
      dropped,
    };
  }

  /** One `pointAggregate` per kept pair, then the rows — the one `trendPointsReportRows` call. */
  async read(plan: TrendPointsPlan): Promise<TrendPointsReportRows> {
    const points = await Promise.all(
      plan.kept.map(async (pair): Promise<TrendPointsReportPoint> => {
        const aggregate = await this.telemetry.pointAggregate(
          { assetId: pair.assetId, pointKey: pair.pointKey },
          {
            from: plan.from,
            to: plan.to,
            windowMinutes: plan.windowMinutes,
            compare: plan.compare,
            bucketFunction: "avg",
            bucketStats: true,
            now: plan.now,
          },
        );
        return {
          assetCode: pair.assetCode,
          assetRtuName: pair.assetRtuName,
          assetLocationName: pair.assetLocationName,
          pointKey: pair.pointKey,
          unit: pair.unit,
          current: { stats: aggregate.stats, buckets: aggregate.buckets ?? [] },
          previous: aggregate.compare === null ? null : { stats: aggregate.compare.stats, buckets: aggregate.compare.buckets ?? [] },
        };
      }),
    );
    return trendPointsReportRows({
      title: plan.scheduleName,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      timeZone: plan.timezone,
      level: plan.level,
      total: plan.total,
      dropped: plan.dropped,
      points,
    });
  }

  /** The PDF over the rows. The finite-cells guard runs here, as `energyPdf` runs it (the definition is pure). */
  async pdf(rows: TrendPointsReportRows): Promise<Buffer> {
    finiteSheet(rows);
    return renderPdf(trendPointsPdfDefinition(rows));
  }

  /** The XLSX over the rows: one sheet `Points`, a gap an empty cell, through `assertFiniteCells`; deflated (U17, plan C25). */
  xlsx(rows: TrendPointsReportRows): Buffer {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(finiteSheet(rows)), "Points");
    return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  }
}

function finiteSheet(rows: TrendPointsReportRows): (string | number)[][] {
  return assertFiniteCells(rows.sheet.map((row) => row.map((cell) => cell ?? "")));
}
