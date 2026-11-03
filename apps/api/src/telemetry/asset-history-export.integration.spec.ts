import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { Recorded } from "../testing/recording-pool";
import { SEEDED, jwtFor } from "../testing/seeded-subjects";
import type { AssetHistoryExportService } from "./asset-history-export.service";
import { resolveAggregateRange } from "./point-aggregate-window";
import type { TelemetryService } from "./telemetry.service";

/**
 * `F4.303` U5 (ADR 0108 Amendment 6 item 3) — the asset history export against
 * real roles: the seeded `wc-admin@bms.local` (location-scoped) refused on a
 * per-run asset of another organization before any statement, beside the global
 * admin's export of the same asset; and the file's `value` column against
 * `pointAggregate` for the same query and instant. Assertions live here; the
 * sibling `.test.ts` owns the pools, the fixture and its cleanup (ADR 0014).
 *
 * Columns of a data row: point, unit, period, bucket_start, value, min,
 * average, max, samples. Data rows start after the five header rows, the blank
 * row and the column header.
 */

export type AssetHistoryExportCtx = {
  readonly svc: AssetHistoryExportService;
  /** The `TelemetryService` the export calls, for the same-query read. */
  readonly telemetry: TelemetryService;
  /** Every statement the export and its `TelemetryService` sent, in order. */
  readonly statements: Recorded[];
  readonly fixture: {
    readonly assetId: string;
    /** Registered `kW` and sampled once a minute from `at`. */
    readonly pointA: string;
    /** Registered with no unit and sampled once a minute from `at`. */
    readonly pointB: string;
    /** The first sample's minute. */
    readonly at: Date;
  };
};

const HEADER_ROWS = 7;

const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");

function telemetryStatements(ctx: AssetHistoryExportCtx): Recorded[] {
  return ctx.statements.filter((s) => s.text.includes("telemetry."));
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("resolved, expected a refusal");
}

/** `[from, to)` of 40 minutes around the samples, as the custom-range query sends it. */
function queryOf(ctx: AssetHistoryExportCtx): { points: string; from: string; to: string; compare: "true" } {
  const { at, pointA, pointB } = ctx.fixture;
  return {
    points: `${pointA},${pointB}`,
    from: new Date(at.getTime() - 10 * 60_000).toISOString(),
    to: new Date(at.getTime() + 30 * 60_000).toISOString(),
    compare: "true",
  };
}

/** wc-admin's export of another organization's asset is the 403 and sends no statement; the admin's exports. */
export async function assertAForeignAssetIsA403WithNoTelemetry(ctx: AssetHistoryExportCtx): Promise<void> {
  ctx.statements.length = 0;
  const err = await rejection(ctx.svc.exportRows(wcAdmin(), ctx.fixture.assetId, queryOf(ctx)));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(err.message).toBe("Asset is outside your access scope");
  expect(telemetryStatements(ctx)).toEqual([]);
  expect(ctx.statements, "not even the registration select").toEqual([]);

  const own = await ctx.svc.exportRows(admin(), ctx.fixture.assetId, queryOf(ctx));
  expect(own[0], "adjacent positive: the global admin exports it").toEqual(["zone", "Asia/Kolkata"]);
  expect(telemetryStatements(ctx).length, "adjacent positive: the reads ran").toBeGreaterThan(0);
}

/** Each point's current and previous `value` column is `pointAggregate(...)`'s bucket `v` for the same query. */
export async function assertTheValuesArePointAggregatesBuckets(ctx: AssetHistoryExportCtx): Promise<void> {
  const now = new Date();
  const query = queryOf(ctx);
  const rows = await ctx.svc.exportRows(admin(), ctx.fixture.assetId, query, now);
  const range = resolveAggregateRange(query, now);
  for (const pointKey of [ctx.fixture.pointA, ctx.fixture.pointB]) {
    const read = await ctx.telemetry.pointAggregate(
      { assetId: ctx.fixture.assetId, pointKey },
      { ...range, compare: true, bucketFunction: "avg", bucketStats: true, now },
    );
    const dataRows = rows.slice(HEADER_ROWS).filter((row) => row[0] === pointKey);
    const current = (read.buckets ?? []).map((b) => [b.v, b.min, b.average, b.max, b.sampleCount]);
    const previous = (read.compare?.buckets ?? []).map((b) => [b.v, b.min, b.average, b.max, b.sampleCount]);
    expect(current.some(([v]) => typeof v === "number"), `precondition: ${pointKey} has a sampled bucket`).toBe(true);
    expect(dataRows.filter((row) => row[2] === "current").map((row) => row.slice(4))).toEqual(current);
    expect(dataRows.filter((row) => row[2] === "previous").map((row) => row.slice(4))).toEqual(previous);
  }
}

/** The unit column is the registration's: `kW` for point A, an empty cell for point B. */
export async function assertTheUnitIsTheRegistrations(ctx: AssetHistoryExportCtx): Promise<void> {
  const rows = await ctx.svc.exportRows(admin(), ctx.fixture.assetId, queryOf(ctx));
  const units = new Map(rows.slice(HEADER_ROWS).map((row) => [row[0], row[1]]));
  expect(units.get(ctx.fixture.pointA)).toBe("kW");
  expect(units.get(ctx.fixture.pointB)).toBeNull();
}
