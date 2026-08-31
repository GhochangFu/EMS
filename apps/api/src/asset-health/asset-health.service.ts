import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, lt, max, sql, sum } from "drizzle-orm";

import type { AssetHealthResponse, HealthSummaryResponse, TemplateHealth } from "@bms/shared";
import {
  type BmsDb,
  assetPoints,
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
import {
  expectedBucketCount,
  floorToBucket,
  levelFor,
  windowBounds,
} from "../telemetry/point-aggregate-window";

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
    const { rows, coveredBuckets } = await this.readCounters(level, [assetId], from, to);
    const health = await this.healthForAssets([assetId]);
    const catalog = await this.catalogPoints([assetId]);
    const scored = scoreAsset(
      this.tagsFor(rows, catalog.get(assetId) ?? [], assetId),
      health.get(assetId),
    );

    return {
      assetId,
      score: scored.score,
      band: scored.band,
      scoredTags: scored.scoredTags,
      unscoredTags: scored.unscoredTags,
      ...this.windowFields({ level, from, to, windowMinutes, rows, coveredBuckets }),
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

    // An empty scope is answered without touching the counter relations.
    //
    // **The reason this comment used to give was wrong, and the guard is still right.** It
    // claimed `inArray(x, [])` emits `in ()`, a Postgres syntax error. Drizzle 0.38.4 —
    // `node_modules/drizzle-orm/sql/expressions/conditions.cjs` — returns ``sql`false` `` for an
    // empty array, so the query would run and answer nothing. The guard therefore saves the
    // round trip rather than preventing a crash, and it also returns the correct SHAPE: a null
    // score with zeroed bands, which a `false` predicate would not produce on its own.
    if (inScope.length === 0) {
      return {
        score: null,
        assetCount: 0,
        scoredAssetCount: 0,
        unbandedAssetCount: 0,
        unscoredAssetCount: 0,
        bandCounts: [],
        // `coveredBuckets: 0` beside a non-zero `expectedBuckets` is the honest
        // reading of a scope with nothing in it, and it agrees with the
        // `computedAt: null` this same call produces — the pairing Amendment 2
        // decision 1 requires. `HealthSummarySection` gates on `assetCount === 0`
        // BEFORE the donut, so this never reaches the partial-window banner.
        ...this.windowFields({ level, from, to, windowMinutes, rows: [], coveredBuckets: 0 }),
      };
    }

    const { rows, coveredBuckets } = await this.readCounters(level, inScope, from, to);
    const health = await this.healthForAssets(inScope);
    const catalog = await this.catalogPoints(inScope);

    // **Every asset in scope is scored, including those with no counter rows at
    // all.** Iterating the rows instead would silently drop an asset that has no
    // telemetry or no rules from the denominator, which is the inflation ADR
    // 0050 decision 3 exists to prevent, one level up.
    const scores: AssetScore[] = inScope.map((assetId) =>
      scoreAsset(this.tagsFor(rows, catalog.get(assetId) ?? [], assetId), health.get(assetId)),
    );

    return {
      ...summariseAssets(scores),
      ...this.windowFields({ level, from, to, windowMinutes, rows, coveredBuckets }),
    };
  }

  /**
   * The level, and the window ENDING AT THE NEWEST COMPLETE BUCKET.
   *
   * **The alignment is ADR 0050 Amendment 3, and without it a whole window was
   * unreachable by exactly one bucket.** `alignedWindow` in
   * `health-rollup.service.ts` ends the sweep at `floorToBucket(now)` — ADR 0050
   * decision 5, because rolling up a bucket that is still filling writes a count
   * over a partial sample set. So the newest bucket the sweep EVER writes is one
   * width older than that.
   *
   * An unaligned read took `to = now`, and `bucket < to` then admitted the
   * in-flight bucket — the one the writer is forbidden to write. A window of `N`
   * buckets could therefore only ever cover `N - 1` of them, `coveredBuckets`
   * could never equal `expectedBuckets`, and `F4.72`'s partial-window banner
   * would have been permanently on for every healthy deployment. A warning that
   * never turns off carries no information, which is the same defect `F4.74`
   * fixed one component over.
   *
   * Aligning `to` makes the read's window and the writer's window agree about
   * where a bucket ends. It changes no score: the in-flight bucket carries no
   * counter row by construction, so excluding it removes nothing from the
   * numerator or the denominator.
   *
   * **This is not a second ladder** (ADR 0050 decision 6, Amendment 2 decision
   * 2). `levelFor` is still `F3.35`'s, chosen from the unaligned window exactly
   * as before, and `floorToBucket` is the writer's own boundary rule imported
   * rather than restated. Nothing here reads `TRAILING_WINDOW_MS`, and no rung
   * moves.
   */
  private resolveWindow(
    windowMinutes: number,
    now: Date,
  ): { level: AggregateLevel; from: Date; to: Date } {
    const window = windowBounds(now, windowMinutes, false);
    const level = levelFor(window, windowMinutes, now);
    // The level is chosen from the unaligned window first — the retention guard
    // asks how old the request reaches, and flooring `now` can only make that
    // reach older by less than one bucket. Aligning first would put a second
    // window rule ahead of `F3.35`'s.
    const to = floorToBucket(window.to, level);
    return { level, from: new Date(to.getTime() - windowMinutes * 60_000), to };
  }

  /**
   * `bucketSeconds` and `computedAt` (Amendment 1 decision 9), and the two
   * coverage integers (Amendment 2 decision 1).
   *
   * `computedAt` is the newest instant across the rows actually read — the
   * currency of THIS level, not of the ladder. It is `null` when nothing was
   * read, because a scope the roll-up has not covered has no instant to report
   * and `now` would claim a currency that does not exist.
   *
   * **`computedAt` alone cannot disclose a hole**, which is the whole of
   * Amendment 2: it is the NEWEST instant, so a window missing its middle
   * reports exactly what a complete window reports. `coveredBuckets` beside
   * `expectedBuckets` is what makes that visible.
   *
   * `expectedBuckets` is `F3.35`'s `expectedBucketCount`, imported rather than
   * re-derived — ADR 0050 decision 6 keeps one ladder, and a second copy of this
   * arithmetic beside it is how a second ladder starts.
   *
   * The two are consistent by construction: `telemetry.point_in_range_*` declares
   * `computed_at timestamptz NOT NULL`, so a non-empty read always yields an
   * instant, and an empty one yields `coveredBuckets: 0` and `computedAt: null`
   * together.
   */
  private windowFields(args: {
    level: AggregateLevel;
    from: Date;
    to: Date;
    windowMinutes: number;
    rows: readonly CounterRow[];
    coveredBuckets: number;
  }): Pick<
    AssetHealthResponse,
    "windowFrom" | "windowTo" | "bucketSeconds" | "computedAt" | "coveredBuckets" | "expectedBuckets"
  > {
    let newest: Date | null = null;
    for (const row of args.rows) {
      if (row.computedAt !== null && (newest === null || row.computedAt > newest)) {
        newest = row.computedAt;
      }
    }
    return {
      windowFrom: args.from.toISOString(),
      windowTo: args.to.toISOString(),
      bucketSeconds: bucketSeconds(args.level),
      computedAt: newest?.toISOString() ?? null,
      coveredBuckets: args.coveredBuckets,
      expectedBuckets: expectedBucketCount(args.windowMinutes, args.level),
    };
  }

  /**
   * One asset's tags: every counter row, PLUS a zero-filled entry for each
   * catalog point that has no counter row.
   *
   * **The zero-fill is what makes ADR 0050 decision 3 observable, and it was
   * missing.** A counter row exists only for a tag some threshold rule matched
   * (`0052`'s `rule_count + skipped_rule_count > 0`), so building `TagCounts`
   * from the rows alone meant a genuinely unruled tag never reached
   * `scoreAsset` and therefore never reached `unscoredTags`. Decision 3 requires
   * the opposite — "reported, not silently dropped" — and `TagCounts`' own
   * docblock states this precondition on the caller.
   *
   * Found by the `E1.3` correctness review, which also named the two dead
   * branches it left: `skippedRuleCount: 0` was unreachable on the wire, and the
   * web layer's "no threshold rule configured" string was unreachable outside
   * its own spec.
   */
  private tagsFor(
    rows: readonly CounterRow[],
    catalogPointKeys: readonly string[],
    assetId: string,
  ): TagCounts[] {
    const counted = rows
      .filter((row) => row.assetId === assetId)
      .map(({ pointKey, inRangeCount, sampleCount, ruleCount, skippedRuleCount }) => ({
        pointKey,
        inRangeCount,
        sampleCount,
        ruleCount,
        skippedRuleCount,
      }));

    const seen = new Set(counted.map((tag) => tag.pointKey));
    for (const pointKey of catalogPointKeys) {
      if (!seen.has(pointKey)) {
        counted.push({
          pointKey,
          inRangeCount: 0,
          sampleCount: 0,
          ruleCount: 0,
          skippedRuleCount: 0,
        });
      }
    }
    return counted;
  }

  /** Catalog point keys per asset, so an unruled tag can be reported as one. */
  private async catalogPoints(assetIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
      .from(assetPoints)
      .where(inArray(assetPoints.assetId, [...assetIds]))
      .orderBy(assetPoints.assetId, assetPoints.pointKey);

    const byAsset = new Map<string, string[]>();
    for (const row of rows) {
      const list = byAsset.get(row.assetId);
      if (list === undefined) {
        byAsset.set(row.assetId, [row.pointKey]);
      } else {
        list.push(row.pointKey);
      }
    }
    return byAsset;
  }

  /**
   * The per-tag counters, and the scope's bucket coverage beside them.
   *
   * **`scope` is built once and given to BOTH the outer read and the coverage
   * subquery.** Two predicates that drift would measure coverage over a
   * different window from the one the scores came from — a defect with no
   * symptom, because both numbers would still look reasonable.
   *
   * **Why a subquery rather than a fold in JavaScript.** This read groups by
   * `(asset_id, point_key)`, so `bucket` is collapsed before any row reaches
   * TypeScript. Adding `bucket` to the `GROUP BY` and folding here would make
   * the summary read scale as `assets x ruled tags x buckets` — at the default
   * 1,440 minutes on `1m` that is a four-figure multiplier on a dashboard tile,
   * and Amendment 1 decision 10 accepts unbounded growth in these tables.
   * `array_agg(DISTINCT bucket)` is the same explosion in bytes.
   *
   * It is ONE statement and one round trip, which is what Amendment 2 decision 1
   * means by "adds no query", and it is the shape `scalarSql`'s `peak_at`
   * already uses in `point-aggregate-window.ts`. The subquery is uncorrelated,
   * so Postgres evaluates it once as an InitPlan and every returned row carries
   * the same value.
   *
   * `count(DISTINCT bucket) OVER ()` is not an option: Postgres does not
   * implement `DISTINCT` in window functions.
   *
   * **The count is a union across the scope, not a maximum across tags.** Those
   * two agree only while every ruled tag is written by every sweep pass, which
   * is a premise about the writer rather than a fact about the rows — and the
   * `1m` fixtures in `health-rollup.integration.spec.ts` already separate them
   * (five buckets on the busiest tag, six distinct buckets in the scope).
   */
  private async readCounters(
    level: AggregateLevel,
    assetIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<{ rows: CounterRow[]; coveredBuckets: number }> {
    const relation = COUNTER_RELATION[level];
    const scope = and(
      inArray(relation.assetId, [...assetIds]),
      gte(relation.bucket, from),
      lt(relation.bucket, to),
    );
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
        // The relation is named again inside the subquery rather than aliased,
        // so its column references bind to the INNER `FROM` item: Postgres
        // searches the innermost query level first, and an inner range table
        // under the same correlation name shadows the outer one. That is the
        // mechanism — not the fact that `bucket` is absent from the outer
        // `GROUP BY`. An outer reference to `bucket` would indeed be rejected,
        // but `asset_id` and `point_key` ARE grouped, so an outward binding of
        // either would be accepted silently. `EXPLAIN` on the running database
        // shows the inner item aliased `point_in_range_1m_1` inside an InitPlan,
        // with the `asset_id` restriction applied there (security review).
        coveredBuckets: sql<string>`(
          select count(distinct ${relation.bucket})
          from ${relation}
          where ${scope}
        )`,
      })
      .from(relation)
      .where(scope)
      .groupBy(relation.assetId, relation.pointKey);

    return {
      rows: rows.map((row) => ({
        assetId: row.assetId,
        pointKey: row.pointKey,
        inRangeCount: asCount(row.inRangeCount),
        sampleCount: asCount(row.sampleCount),
        ruleCount: asCount(row.ruleCount),
        skippedRuleCount: asCount(row.skippedRuleCount),
        computedAt: row.computedAt === null ? null : new Date(row.computedAt),
      })),
      // No group means no bucket carried a row, which is a coverage of zero —
      // the same state the subquery would have reported had a row survived to
      // carry it.
      coveredBuckets: asCount(rows[0]?.coveredBuckets),
    };
  }

  /**
   * The asset ids to score: the readable set, optionally narrowed to a plant.
   *
   * §4.3 fleet-read reason: `bms.assets` is RLS-bearing and this runs on the
   * BYPASSRLS pool, so the containment is that `assetIds` is what
   * `AccessControlService.readableAssetIds` already computed for this caller —
   * the "bypass, then trust a computed grant" shape ADR 0043 Amendment 2/3
   * allows. `locationId` can only intersect that set, never widen it.
   */
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
    // **`orderBy` is not cosmetic.** `summariseAssets` takes a band's `label`
    // and `minScore` from its first occurrence in this order, so without a
    // deterministic order two identical requests can return different JSON when
    // two templates give one band code different labels or cut-points. The
    // correctness review found this; `scoreAsset` already holds itself to the
    // same standard one level down.
    const rows = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(...filters))
      .orderBy(assets.id);
    return rows.map((row) => row.id);
  }

  /**
   * Each asset's `content.health`, keyed by asset id. Absent means unbanded.
   *
   * §4.3 fleet-read reason: `bms.assets` and `bms.asset_templates` are both
   * RLS-bearing. Contained the same way as `assetsInScope` above — the ids come
   * from the caller's own readable set, never from a request parameter.
   */
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
