import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";
import {
  DEGRADATION_MAX_ASSETS,
  resolveSiteTimeZone,
  type DegradationAsset,
  type DegradationResponse,
  type TemplateHealth,
} from "@bms/shared";

import { DEFAULT_HEALTH_WINDOW_MINUTES } from "../asset-health/asset-health.schema";
import { AssetHealthService, type HealthScopeScore } from "../asset-health/asset-health.service";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import type { ThresholdRuleDbRow } from "../ml/ml-findings.forecast-facts";
import { readThresholdRules } from "../ml/ml-findings.reads";
import { coveredRulesOf } from "./degradation-drift";
import type { DegradationAssetInput, DegradationWindow, DriftPointInput, ScheduleInput } from "./degradation-engine.types";
import { healthLimitOf } from "./degradation-health";
import { computeAssetDegradation, nearestIndicator, orderAssets, withScheduleNotes } from "./degradation-rank";
import { degradationWindow } from "./degradation-window";
import {
  driftPointsOf,
  readActiveSchedules,
  readCounterDays,
  readDegradationCandidates,
  readMeanDays,
  type AssetCounterDay,
  type AssetMeanDay,
  type DegradationCandidateDbRow,
} from "./degradation.reads";

/**
 * `E1.5a` / ADR 0138 (plan §4.1, T1.8, R-b, R-c, R-k, R-l, R-n, R-o) — the
 * degradation trends of the assets a caller reads, computed when a page asks.
 * Nothing is stored and nothing is written.
 *
 * One flow for both routes ({@link computeDegradation}):
 * 1. one `withReadScope`: the candidates (R-k), then the threshold rules of
 *    their drift points (`readThresholdRules`, `E1.9`'s read; R-l) on the same
 *    `tx`;
 * 2. the cap (R-n): above `DEGRADATION_MAX_ASSETS` candidates the current
 *    health score ranks them (lowest first, no score last, then id) and the
 *    first ones go on; at or below it the score read does not run;
 * 3. one window per zone (`resolveSiteTimeZone`, R-b); the read range is their
 *    union;
 * 4. **with the considered ids only, never `null`**: the templates' health
 *    blocks, then, in parallel, the counter days of the assets with a usable
 *    `fair` band and the mean days of the drift points with a covered rule;
 * 5. the pure engine and the order;
 * 6. the schedule notes (R-o), after the numbers are final, only for assets
 *    with a crossing, in a read scope of their own. A failed read means no
 *    note and one `warn` with the error's class name; never a failed response.
 */

/** The candidates and the rules of their drift points, read on one `tx`. */
export interface DegradationScopedRead {
  readonly candidates: DegradationCandidateDbRow[];
  readonly rules: ThresholdRuleDbRow[];
}

/** Every read the flow makes, as a seam: the service wires the real ones, the spec fakes them. */
export interface DegradationReads {
  /** Through `withReadScope`: `ids` is `narrow`'s value (`null` for the unrestricted admin). */
  candidates(ids: string[] | null): Promise<DegradationScopedRead>;
  /** The current health score of each id (R-n), run only above the cap. */
  scores(ids: readonly string[], now: Date): Promise<HealthScopeScore[]>;
  /** The parsed template `health` block of each id (`healthForAssets`). */
  health(ids: readonly string[]): Promise<Map<string, TemplateHealth | undefined>>;
  /** Counter days on the fleet pool over `[fromMs, toMs)`. */
  counterDays(assets: readonly { assetId: string; zone: string }[], fromMs: number, toMs: number): Promise<AssetCounterDay[]>;
  /** Hourly-mean days on the fleet pool over `[fromMs, toMs)`. */
  meanDays(
    points: readonly { assetId: string; pointKey: string; zone: string }[],
    fromMs: number,
    toMs: number,
  ): Promise<AssetMeanDay[]>;
  /** The active schedules of `ids`, through a `withReadScope` of its own (R-o). */
  schedules(ids: string[]): Promise<ScheduleInput[]>;
}

/** What the real reads need. */
export interface DegradationReadDeps {
  readonly tenantDb: BmsDb;
  readonly fleetDb: BmsDb;
  readonly pool: Pick<Pool, "query">;
  readonly health: Pick<AssetHealthService, "healthForAssets" | "scoresInScope">;
}

/** The real reads: candidates, rules and schedules through `withReadScope`; the day reads on the fleet pool. */
export function degradationReadsOf(deps: DegradationReadDeps): DegradationReads {
  const { tenantDb, fleetDb, pool, health } = deps;
  const none: DegradationScopedRead = { candidates: [], rules: [] };
  return {
    candidates: (ids) =>
      withReadScope(tenantDb, fleetDb, ids, () => none, async (tx) => {
        const candidates = await readDegradationCandidates(tx, ids);
        const pairs = candidates.flatMap((row) =>
          driftPointsOf(row).map((point) => ({ assetId: row.asset_id, pointKey: point.pointKey })),
        );
        return { candidates, rules: await readThresholdRules(tx, pairs) };
      }),
    scores: (ids, now) => health.scoresInScope(ids, undefined, DEFAULT_HEALTH_WINDOW_MINUTES, now),
    health: (ids) => health.healthForAssets(ids),
    counterDays: (assets, fromMs, toMs) => readCounterDays(pool, assets, fromMs, toMs),
    meanDays: (points, fromMs, toMs) => readMeanDays(pool, points, fromMs, toMs),
    schedules: (ids) => withReadScope(tenantDb, fleetDb, ids, () => [], (tx) => readActiveSchedules(tx, ids)),
  };
}

/** Plain code-unit order: stable whatever the locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * R-n: the first `DEGRADATION_MAX_ASSETS` of `ids` by current score, lowest
 * first; an id with no score (or none in the answer) after every scored one;
 * ties by id.
 */
export function cappedIds(ids: readonly string[], scores: readonly HealthScopeScore[]): string[] {
  const scoreOf = new Map(scores.map((s) => [s.assetId, s.score]));
  return [...ids]
    .sort((a, b) => {
      const sa = scoreOf.get(a) ?? null;
      const sb = scoreOf.get(b) ?? null;
      if ((sa === null) !== (sb === null)) return sa === null ? 1 : -1;
      return (sa !== null && sb !== null ? sa - sb : 0) || byCodeUnit(a, b);
    })
    .slice(0, DEGRADATION_MAX_ASSETS);
}

/** A warning sink: Nest's `Logger` in the service, a list in the spec. */
export type DegradationLog = Pick<Logger, "warn">;

const defaultLog: DegradationLog = new Logger("DegradationService");

/** The class name of a thrown value, and nothing of its message (R-o). */
const errorClassOf = (err: unknown): string =>
  err instanceof Error ? err.constructor.name : typeof err;

/** The response of `ids` (`narrow`'s value, or one asset) at `now`: one clock for the whole request. */
export async function computeDegradation(
  reads: DegradationReads,
  ids: string[] | null,
  now: Date,
  log: DegradationLog = defaultLog,
): Promise<DegradationResponse> {
  const nowMs = now.getTime();
  const respond = (candidates: number, considered: number, assets: DegradationAsset[]): DegradationResponse => ({
    asOf: now.toISOString(),
    candidates,
    considered,
    assets,
  });
  if (ids !== null && ids.length === 0) return respond(0, 0, []);

  // 1. Candidates and the rules of their drift points, on one read scope.
  const { candidates, rules } = await reads.candidates(ids);
  if (candidates.length === 0) return respond(0, 0, []);

  // 2. The cap (R-n), only above it.
  let considered = candidates;
  if (candidates.length > DEGRADATION_MAX_ASSETS) {
    const candidateIds = candidates.map((row) => row.asset_id);
    const keep = cappedIds(candidateIds, await reads.scores(candidateIds, now));
    const byId = new Map(candidates.map((row) => [row.asset_id, row]));
    considered = keep.map((id) => byId.get(id)!);
  }
  const consideredIds = considered.map((row) => row.asset_id);

  // 3. One window per zone (R-a, R-b); the read range is their union.
  const windowsByZone = new Map<string, DegradationWindow>();
  const windowOf = new Map<string, DegradationWindow>();
  for (const row of considered) {
    const zone = resolveSiteTimeZone(row.location_zone, row.organization_zone).arithmeticZone;
    let window = windowsByZone.get(zone);
    if (window === undefined) {
      window = degradationWindow(nowMs, zone);
      windowsByZone.set(zone, window);
    }
    windowOf.set(row.asset_id, window);
  }
  const windows = [...windowsByZone.values()];
  const fromMs = Math.min(...windows.map((w) => w.fromMs));
  const toMs = Math.max(...windows.map((w) => w.toMs));
  const zoneOf = (assetId: string): string => windowOf.get(assetId)!.zone;

  // 4. With the considered ids only: health blocks, then the two day reads in parallel.
  const healthOf = await reads.health(consideredIds);
  const healthIds = consideredIds.filter((id) => healthLimitOf(healthOf.get(id)) !== null);
  const rulesOf = new Map<string, ThresholdRuleDbRow[]>();
  for (const rule of rules) {
    const key = `${rule.asset_id}\u0000${rule.point_key}`;
    const list = rulesOf.get(key);
    if (list) list.push(rule);
    else rulesOf.set(key, [rule]);
  }
  const driftOf = new Map<string, DriftPointInput[]>();
  for (const row of considered) {
    const points = driftPointsOf(row)
      .map((point) => ({
        pointKey: point.pointKey,
        unit: point.unit,
        days: [],
        rules: rulesOf.get(`${row.asset_id}\u0000${point.pointKey}`) ?? [],
      }))
      .filter((point) => coveredRulesOf(row.asset_id, point).length > 0);
    if (points.length > 0) driftOf.set(row.asset_id, points);
  }
  const meanPoints = consideredIds.flatMap((assetId) =>
    (driftOf.get(assetId) ?? []).map((point) => ({ assetId, pointKey: point.pointKey, zone: zoneOf(assetId) })),
  );
  const [counterDays, meanDays] = await Promise.all([
    healthIds.length === 0
      ? Promise.resolve<AssetCounterDay[]>([])
      : reads.counterDays(healthIds.map((assetId) => ({ assetId, zone: zoneOf(assetId) })), fromMs, toMs),
    meanPoints.length === 0 ? Promise.resolve<AssetMeanDay[]>([]) : reads.meanDays(meanPoints, fromMs, toMs),
  ]);

  // 5. The engine, one asset at a time, then the order. A row outside the asset's own days is dropped (R-c).
  const inWindow = (assetId: string, day: string): boolean => windowOf.get(assetId)!.days.includes(day);
  const assets = orderAssets(
    considered.flatMap((row) => {
      const assetId = row.asset_id;
      const window = windowOf.get(assetId)!;
      const input: DegradationAssetInput = {
        assetId,
        organizationId: row.organization_id,
        locationId: row.location_id,
        assetCode: row.asset_code,
        assetName: row.asset_name,
        assetRtuName: row.asset_rtu_name,
        assetLocationName: row.location_name,
        window,
        health: healthIds.includes(assetId) ? healthOf.get(assetId) : undefined,
        counterDays: counterDays.filter((day) => day.assetId === assetId && inWindow(assetId, day.day)),
        driftPoints: (driftOf.get(assetId) ?? []).map((point) => ({
          ...point,
          days: meanDays.filter((day) => day.assetId === assetId && day.pointKey === point.pointKey && inWindow(assetId, day.day)),
        })),
      };
      const asset = computeAssetDegradation(input);
      return asset === null ? [] : [asset];
    }),
  );

  // 6. The schedule notes (R-o): only assets with a crossing, never a failed response.
  const crossingIds = assets.filter((asset) => nearestIndicator(asset) !== null).map((asset) => asset.assetId);
  if (crossingIds.length === 0) return respond(candidates.length, considered.length, assets);
  let schedules: ScheduleInput[];
  try {
    schedules = await reads.schedules(crossingIds);
  } catch (err) {
    log.warn(`degradation: the schedule read failed (${errorClassOf(err)}); no schedule notes`);
    return respond(candidates.length, considered.length, assets);
  }
  return respond(
    candidates.length,
    considered.length,
    assets.map((asset) => withScheduleNotes(asset, schedules, nowMs)),
  );
}

/**
 * The service both routes call. Slots 0–2 are the tenant and fleet handles
 * `withReadScope` takes and the fleet pool the day reads take
 * (`database/fleet-read-wiring.spec.ts`); `AssetHealthService` comes from
 * `AssetHealthModule`'s exports.
 */
@Injectable()
export class DegradationService {
  private readonly reads: DegradationReads;

  constructor(
    @Inject(TENANT_DRIZZLE) tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) fleetDb: BmsDb,
    @Inject(FLEET_POOL) pool: Pool,
    @Inject(AssetHealthService) health: Pick<AssetHealthService, "healthForAssets" | "scoresInScope">,
  ) {
    this.reads = degradationReadsOf({ tenantDb, fleetDb, pool, health });
  }

  /** `GET /degradation`: `assetIds` is `narrow`'s value, unchanged (`null`: the unrestricted admin). */
  list(assetIds: string[] | null, now: Date): Promise<DegradationResponse> {
    return computeDegradation(this.reads, assetIds, now);
  }

  /** `GET /assets/:assetId/degradation`, after the controller's `canReadAsset`. */
  forAsset(assetId: string, now: Date): Promise<DegradationResponse> {
    return computeDegradation(this.reads, [assetId], now);
  }
}
