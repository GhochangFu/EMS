import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, lt, max, sum } from "drizzle-orm";

import type { AssetHealthResponse, HealthSummaryResponse, TemplateHealth } from "@bms/shared";
import {
  type BmsDb,
  assetTemplates,
  assets,
  pointInRange1d,
  pointInRange1h,
  pointInRange1m,
  pointInRange5m,
} from "@bms/db";

import { templateHealthSchema } from "../admin/asset-templates/asset-templates-content.schema";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import { type AggregateLevel, bucketSeconds } from "../telemetry/point-aggregates";
import { levelFor, windowBounds } from "../telemetry/point-aggregate-window";

import { type AssetScore, type TagCounts, scoreAsset, summariseAssets } from "./health-score";

/**
 * `E1.3` — the health read (ADR 0050 + Amendment 1).
 *
 * **`FLEET_DRIZZLE`, and the containment is the controller's guard.** This is
 * ADR 0048's model for `telemetry.*` applied unchanged: those relations carry no
 * Row Level Security, so no pool filters them, and `AccessControlService` is the
 * only thing between a caller and another organization's data. The counter
 * relations `0052` adds are in that same schema and inherit that same model —
 * which is why every public method here takes an ALREADY-AUTHORIZED set of asset
 * ids rather than a user, and cannot be called with a user by mistake.
 *
 * The roll-up job is the opposite case and deliberately so: it has no request to
 * authorize, so it uses `withTenant` on the tenant role (ADR 0050 decision 8).
 * Two paths, two containment mechanisms, each matching what it actually has.
 */

/** ADR 0050 decision 6: one ladder, and this maps it to the counter relations. */
const COUNTER_RELATION = {
  "1m": pointInRange1m,
  "5m": pointInRange5m,
  "1h": pointInRange1h,
  "1d": pointInRange1d,
} as const satisfies Record<AggregateLevel, unknown>;

interface CounterRow {
  assetId: string;
  pointKey: string;
  inRangeCount: number;
  sampleCount: number;
  ruleCount: number;
  skippedRuleCount: number;
  computedAt: Date | null;
}

/**
 * `sum()` and `max()` come back as strings from node-postgres for `bigint` and
 * `numeric`, and as `null` when the group is empty.
 *
 * Coercing here rather than at each use: `Number(null)` is `0`, which would turn
 * "no rows" into "zero samples" and then into a division by zero. The explicit
 * `?? 0` keeps that decision visible, and `scoreAsset` refuses a zero
 * `sampleCount` anyway.
 */
function asCount(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

/**
 * The `health` block from a stored template, or `undefined`.
 *
 * Parsed rather than cast. The column is `jsonb` and the write path validates
 * it, but a hand-edited row, a restored dump, or a template written before this
 * branch can hold anything — and an unparsed cast would reach `scoreAsset` as a
 * malformed band list and produce a wrong band rather than no band. Amendment 1
 * decision 3 gives `band: null` one meaning; a crash or a wrong band are not it.
 *
 * The schema is imported from the write path rather than restated (§4.8), so the
 * two cannot disagree about what a valid health block is.
 */
function parseHealth(content: unknown): TemplateHealth | undefined {
  if (typeof content !== "object" || content === null || !("health" in content)) {
    return undefined;
  }
  const parsed = templateHealthSchema.safeParse((content as { health: unknown }).health);
  return parsed.success ? parsed.data : undefined;
}

@Injectable()
export class AssetHealthService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * One asset's score.
   *
   * `assetId` must already have passed `canReadAsset`. See the class docblock:
   * there is no guard in here, on purpose, because a guard that runs after the
   * read has already read.
   */
  async forAsset(assetId: string, windowMinutes: number, now: Date): Promise<AssetHealthResponse> {
    const { level, from, to } = this.resolveWindow(windowMinutes, now);
    const rows = await this.readCounters(level, [assetId], from, to);
    const health = await this.healthForAssets([assetId]);
    const scored = scoreAsset(this.tagsFor(rows, assetId), health.get(assetId));

    return {
      assetId,
      score: scored.score,
      band: scored.band,
      scoredTags: scored.scoredTags,
      unscoredTags: scored.unscoredTags,
      ...this.windowFields(level, from, to, rows),
    };
  }

  /**
   * The plant and enterprise donut.
   *
   * `assetIds` is `null` only for an unrestricted admin — that is
   * `readableAssetIds`' own convention and it is preserved rather than
   * translated, because turning `null` into "every id" here would mean loading
   * every asset in the deployment to express "no restriction".
   */
  async summary(
    assetIds: readonly string[] | null,
    locationId: string | undefined,
    windowMinutes: number,
    now: Date,
  ): Promise<HealthSummaryResponse> {
    const { level, from, to } = this.resolveWindow(windowMinutes, now);
    const inScope = await this.assetsInScope(assetIds, locationId);

    // An empty scope is answered without touching the counter relations. Not an
    // optimisation: `inArray(x, [])` generates `in ()`, which is a syntax error
    // in Postgres, and drizzle does not rewrite it.
    if (inScope.length === 0) {
      return {
        score: null,
        assetCount: 0,
        scoredAssetCount: 0,
        unbandedAssetCount: 0,
        unscoredAssetCount: 0,
        bandCounts: [],
        ...this.windowFields(level, from, to, []),
      };
    }

    const rows = await this.readCounters(level, inScope, from, to);
    const health = await this.healthForAssets(inScope);

    // **Every asset in scope is scored, including those with no counter rows at
    // all.** Iterating the rows instead would silently drop an asset that has no
    // telemetry or no rules from the denominator, which is the inflation ADR
    // 0050 decision 3 exists to prevent, one level up.
    const scores: AssetScore[] = inScope.map((assetId) =>
      scoreAsset(this.tagsFor(rows, assetId), health.get(assetId)),
    );

    return {
      ...summariseAssets(scores),
      ...this.windowFields(level, from, to, rows),
    };
  }

  private resolveWindow(
    windowMinutes: number,
    now: Date,
  ): { level: AggregateLevel; from: Date; to: Date } {
    const window = windowBounds(now, windowMinutes, false);
    return { level: levelFor(window, windowMinutes, now), from: window.from, to: window.to };
  }

  /**
   * `bucketSeconds` and `computedAt`, per Amendment 1 decision 9.
   *
   * `computedAt` is the newest instant across the rows actually read — the
   * currency of THIS level, not of the ladder. It is `null` when nothing was
   * read, because a scope the roll-up has not covered has no instant to report
   * and `now` would claim a currency that does not exist.
   */
  private windowFields(
    level: AggregateLevel,
    from: Date,
    to: Date,
    rows: readonly CounterRow[],
  ): Pick<AssetHealthResponse, "windowFrom" | "windowTo" | "bucketSeconds" | "computedAt"> {
    let newest: Date | null = null;
    for (const row of rows) {
      if (row.computedAt !== null && (newest === null || row.computedAt > newest)) {
        newest = row.computedAt;
      }
    }
    return {
      windowFrom: from.toISOString(),
      windowTo: to.toISOString(),
      bucketSeconds: bucketSeconds(level),
      computedAt: newest?.toISOString() ?? null,
    };
  }

  private tagsFor(rows: readonly CounterRow[], assetId: string): TagCounts[] {
    return rows
      .filter((row) => row.assetId === assetId)
      .map(({ pointKey, inRangeCount, sampleCount, ruleCount, skippedRuleCount }) => ({
        pointKey,
        inRangeCount,
        sampleCount,
        ruleCount,
        skippedRuleCount,
      }));
  }

  private async readCounters(
    level: AggregateLevel,
    assetIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<CounterRow[]> {
    const relation = COUNTER_RELATION[level];
    const rows = await this.db
      .select({
        assetId: relation.assetId,
        pointKey: relation.pointKey,
        inRangeCount: sum(relation.inRangeCount),
        sampleCount: sum(relation.sampleCount),
        // `max`, not `sum`: the rule tallies describe the tag, not the bucket,
        // so summing them across the window multiplies a tag's own rule count
        // by the number of buckets. Same reason `levelRollupSql` uses `max`.
        ruleCount: max(relation.ruleCount),
        skippedRuleCount: max(relation.skippedRuleCount),
        computedAt: max(relation.computedAt),
      })
      .from(relation)
      .where(
        and(
          inArray(relation.assetId, [...assetIds]),
          gte(relation.bucket, from),
          lt(relation.bucket, to),
        ),
      )
      .groupBy(relation.assetId, relation.pointKey);

    return rows.map((row) => ({
      assetId: row.assetId,
      pointKey: row.pointKey,
      inRangeCount: asCount(row.inRangeCount),
      sampleCount: asCount(row.sampleCount),
      ruleCount: asCount(row.ruleCount),
      skippedRuleCount: asCount(row.skippedRuleCount),
      computedAt: row.computedAt === null ? null : new Date(row.computedAt),
    }));
  }

  /** The asset ids to score: the readable set, optionally narrowed to a plant. */
  private async assetsInScope(
    assetIds: readonly string[] | null,
    locationId: string | undefined,
  ): Promise<string[]> {
    const filters = [eq(assets.active, true)];
    if (assetIds !== null) {
      if (assetIds.length === 0) {
        return [];
      }
      filters.push(inArray(assets.id, [...assetIds]));
    }
    if (locationId !== undefined) {
      filters.push(eq(assets.locationId, locationId));
    }
    const rows = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(...filters));
    return rows.map((row) => row.id);
  }

  /** Each asset's `content.health`, keyed by asset id. Absent means unbanded. */
  private async healthForAssets(
    assetIds: readonly string[],
  ): Promise<Map<string, TemplateHealth | undefined>> {
    const rows = await this.db
      .select({ assetId: assets.id, content: assetTemplates.content })
      .from(assets)
      .leftJoin(assetTemplates, eq(assets.templateId, assetTemplates.id))
      .where(inArray(assets.id, [...assetIds]));

    const byAsset = new Map<string, TemplateHealth | undefined>();
    for (const row of rows) {
      byAsset.set(row.assetId, parseHealth(row.content));
    }
    return byAsset;
  }
}
