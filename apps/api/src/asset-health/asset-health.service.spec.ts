import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BmsDb } from "@bms/db";

import { AssetHealthService } from "./asset-health.service";

/**
 * Closes a review-found gap: `asset-health.service.ts` had no test at all.
 * Assertions live here; `asset-health.service.test.ts` is the Vitest entry
 * point (ADR 0014).
 *
 * **The stub.** No existing `apps/api` spec stubs a chained `.select().from()
 * .where().groupBy()` read closely enough to reuse (`rules.service.spec.ts`
 * and `dashboards.service.spec.ts` both stop at `.limit()`), so `scriptedDb`
 * below is hand-rolled: a thenable answering every chain method with itself,
 * scripted with one row-array PER `db.select()` call the unit under test is
 * known to make, in the order the source makes them (documented at each call
 * site below). An unscripted call throws immediately, naming its index,
 * rather than silently answering `[]` — a silent `[]` would let a fixture
 * wired one position off pass for the wrong reason.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Chain = {
  from: () => Chain;
  leftJoin: () => Chain;
  where: (predicate?: unknown) => Chain;
  orderBy: () => Chain;
  groupBy: () => Chain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * `where` records its argument rather than discarding it — `F4.72` needs the
 * OUTER predicate to compare against the one embedded in the coverage
 * subquery, and a predicate the harness throws away is a predicate no test can
 * hold to.
 */
function chainOf(rows: unknown[], recordWhere: (predicate: unknown) => void): Chain {
  const chain: Chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: (predicate?: unknown) => {
      recordWhere(predicate);
      return chain;
    },
    orderBy: () => chain,
    groupBy: () => chain,
    then: (resolve) => resolve(rows),
  };
  return chain;
}

/**
 * A scripted `BmsDb`: the Nth `select(fields)` call resolves to
 * `responses[N]` and records `fields` — the same object the service built
 * (`sum(...)`/`max(...)`/plain columns), which is what
 * {@link assertRuleTalliesUseMaxNotSum} inspects. A call past the end of
 * `responses` throws, naming the index, instead of silently returning `[]`.
 */
function scriptedDb(responses: readonly unknown[][]): {
  db: BmsDb;
  calls: { fields: unknown; where?: unknown }[];
} {
  const calls: { fields: unknown; where?: unknown }[] = [];
  const db = {
    select: (fields: unknown) => {
      const index = calls.length;
      const call: { fields: unknown; where?: unknown } = { fields };
      calls.push(call);
      if (index >= responses.length) {
        throw new Error(
          `scriptedDb: unscripted select() call #${index} — only ${responses.length} ` +
            "response(s) were scripted. Either the call order assumption documented at the " +
            "call site is wrong, or this case needs one more scripted response.",
        );
      }
      return chainOf(responses[index] as unknown[], (predicate) => {
        call.where = predicate;
      });
    },
  } as unknown as BmsDb;
  return { db, calls };
}

const NOW = new Date("2026-08-29T12:00:00.000Z");
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

/**
 * **Assertion 5 — the rule tallies use `max`, not `sum`.**
 *
 * What this can and cannot prove without a live Postgres: aggregation itself
 * is Postgres's job, not `readCounters`'s — a canned response cannot show
 * "sixty buckets collapse to one" because no JS in this service ever sums or
 * maxes a bucket. What IS unit-testable, and what a regression from `max()`
 * back to `sum()` would actually change, is which SQL function the query
 * ASKS FOR. `PgDialect().sqlToQuery` (public since 0.38, verified against
 * this exact pinned version) renders the captured field expression to text
 * without a live connection — `"max(...)"` vs `"sum(...)"` — which is the one
 * fact the bug this assertion guards against would flip. The literal
 * "1, not 60" behavioural form belongs to the integration spec that reads a
 * real Postgres.
 */
export async function assertRuleTalliesUseMaxNotSum(): Promise<void> {
  const dialect = new PgDialect();
  function aggregateFunctionName(expr: unknown): string {
    const { sql } = dialect.sqlToQuery(expr as unknown as SQL);
    return /^(\w+)\(/.exec(sql)?.[1] ?? "";
  }

  // forAsset's call order: readCounters (0), healthForAssets (1), catalogPoints (2).
  const { db, calls } = scriptedDb([[], [], []]);
  const service = new AssetHealthService(db);
  await service.forAsset(ASSET_A, 1_440, NOW);

  const fields = calls[0]?.fields as Record<string, unknown>;
  assert(
    aggregateFunctionName(fields.ruleCount) === "max",
    `ruleCount must be aggregated with max(), got "${aggregateFunctionName(fields.ruleCount)}"`,
  );
  assert(
    aggregateFunctionName(fields.skippedRuleCount) === "max",
    `skippedRuleCount must be aggregated with max(), got "${aggregateFunctionName(fields.skippedRuleCount)}"`,
  );
  assert(
    aggregateFunctionName(fields.computedAt) === "max",
    `computedAt must be aggregated with max(), got "${aggregateFunctionName(fields.computedAt)}"`,
  );
  assert(
    aggregateFunctionName(fields.inRangeCount) === "sum",
    `inRangeCount must be aggregated with sum(), got "${aggregateFunctionName(fields.inRangeCount)}"`,
  );
  assert(
    aggregateFunctionName(fields.sampleCount) === "sum",
    `sampleCount must be aggregated with sum(), got "${aggregateFunctionName(fields.sampleCount)}"`,
  );
}

/**
 * **Assertion 6 — the empty-scope early return happens before any counter
 * read.** Two distinct guards, both exercised:
 *
 * - `assetIds: []` never reaches the database at all — `assetsInScope`'s own
 *   `if (assetIds.length === 0) return [];` (service.ts) fires first.
 * - `assetIds: null` (an unrestricted admin) with the assets query itself
 *   resolving to zero rows exercises `summary`'s
 *   `if (inScope.length === 0)` branch — the one whose deletion would let
 *   `inArray(x, [])` reach Postgres and syntax-error.
 *
 * `scriptedDb`'s throw-on-overrun makes the counter/health/catalog reads
 * impossible to reach silently: if `summary` regressed to querying them
 * anyway, both cases below would throw from inside `scriptedDb`, not merely
 * report a wrong count.
 */
export async function assertEmptyScopeNeverTouchesTheCounterRelation(): Promise<void> {
  // No responses scripted at all: any db.select() call throws immediately.
  {
    const { db, calls } = scriptedDb([]);
    const service = new AssetHealthService(db);
    const result = await service.summary([], undefined, 1_440, NOW);
    assert(calls.length === 0, `assetIds: [] must not touch the database at all, got ${calls.length} call(s)`);
    assert(result.assetCount === 0 && result.score === null, "an empty scope must answer an empty donut");
  }

  // Exactly one response scripted (assetsInScope's own select, resolving to
  // zero rows) — a second, unscripted call would throw.
  {
    const { db, calls } = scriptedDb([[]]);
    const service = new AssetHealthService(db);
    const result = await service.summary(null, undefined, 1_440, NOW);
    assert(
      calls.length === 1,
      `an admin scope that resolves to zero assets must make exactly one select() call, got ${calls.length}`,
    );
    assert(result.assetCount === 0 && result.score === null, "a resolved-empty scope must answer an empty donut");
  }
}

/**
 * **Assertion 7 — every asset in scope is scored, including one with no
 * counter rows, and it lands in `unscoredAssetCount`, never dropped from
 * `assetCount`.**
 *
 * `ASSET_A` has one counter row and scores; `ASSET_B` has none anywhere
 * (no counter row, no catalog point either) — the outer `inScope.map` in
 * `summary` must still produce a score entry for it (`score: null`) rather
 * than only iterating the rows that happen to exist.
 */
export async function assertEveryAssetInScopeIsScoredEvenWithNoCounterRows(): Promise<void> {
  const { db } = scriptedDb([
    [{ id: ASSET_A }, { id: ASSET_B }], // assetsInScope
    [
      {
        assetId: ASSET_A,
        pointKey: "kw",
        inRangeCount: "80",
        sampleCount: "100",
        ruleCount: "1",
        skippedRuleCount: "0",
        computedAt: NOW,
      },
    ], // readCounters — nothing for ASSET_B
    [], // healthForAssets
    [], // catalogPoints
  ]);
  const service = new AssetHealthService(db);
  const result = await service.summary([ASSET_A, ASSET_B], undefined, 1_440, NOW);

  assert(result.assetCount === 2, `assetCount must count both assets, got ${result.assetCount}`);
  assert(
    result.scoredAssetCount === 1,
    `exactly the asset with a counter row must be scored, got scoredAssetCount=${result.scoredAssetCount}`,
  );
  assert(
    result.unscoredAssetCount === 1,
    `the asset with no counter row must be counted as unscored, not dropped, got ` +
      `unscoredAssetCount=${result.unscoredAssetCount}`,
  );
}

/**
 * **Assertion 8 — a catalog point with no counter row appears in
 * `unscoredTags` with `skippedRuleCount: 0`.**
 *
 * The freshly-fixed bug: a counter row exists only for a tag some threshold
 * rule matched, so an unruled tag (present in the catalog, absent from every
 * counter relation) used to be invisible on the wire. `readCounters` returns
 * nothing for it here on purpose — only `catalogPoints` names it — and the
 * response must report it anyway.
 */
export async function assertUnruledCatalogPointAppearsInUnscoredTags(): Promise<void> {
  // forAsset's call order: readCounters (0), healthForAssets (1), catalogPoints (2).
  const { db } = scriptedDb([
    [], // readCounters — no counter row for anything on this asset
    [], // healthForAssets
    [{ assetId: ASSET_A, pointKey: "unruled_tag" }], // catalogPoints
  ]);
  const service = new AssetHealthService(db);
  const result = await service.forAsset(ASSET_A, 1_440, NOW);

  assert(result.scoredTags.length === 0, "an unruled tag must never be scored");
  assert(
    result.unscoredTags.length === 1 &&
      result.unscoredTags[0]?.pointKey === "unruled_tag" &&
      result.unscoredTags[0]?.skippedRuleCount === 0,
    `the unruled catalog point must be reported in unscoredTags with skippedRuleCount: 0, got ` +
      JSON.stringify(result.unscoredTags),
  );
}

/**
 * **Assertion 9 — a malformed stored `health` block yields `band: null` and
 * does not throw.**
 *
 * The counter row gives the asset a real, non-null score (`ruleCount: 1`,
 * `sampleCount > 0`) so that `band: null` is provable as "malformed health,
 * not merely unscored" — `scoreAsset` sets `band: null` whenever `score` is
 * `null` regardless of `health` (health-score.ts), so a fixture with no
 * scoreable tag would pass this assertion for the wrong reason.
 */
export async function assertMalformedHealthYieldsNullBandNotThrow(): Promise<void> {
  const { db } = scriptedDb([
    [
      {
        assetId: ASSET_A,
        pointKey: "kw",
        inRangeCount: "50",
        sampleCount: "100",
        ruleCount: "1",
        skippedRuleCount: "0",
        computedAt: NOW,
      },
    ], // readCounters
    [{ assetId: ASSET_A, content: { health: "not-an-object" } }], // healthForAssets — malformed
    [], // catalogPoints
  ]);
  const service = new AssetHealthService(db);
  const result = await service.forAsset(ASSET_A, 1_440, NOW);

  assert(result.score !== null, `a ruled, sampled tag must still produce a score, got ${result.score}`);
  assert(result.band === null, `a malformed health block must yield band: null, got ${JSON.stringify(result.band)}`);
}

/**
 * **Assertion 10 — `computedAt` is the newest instant across the rows
 * actually read, and `null` when none were.**
 */
export async function assertComputedAtIsNewestRowInstantOrNull(): Promise<void> {
  const older = new Date("2026-08-28T00:00:00.000Z");
  const newer = new Date("2026-08-29T06:00:00.000Z");

  {
    const { db } = scriptedDb([
      [
        { assetId: ASSET_A, pointKey: "kw", inRangeCount: "1", sampleCount: "1", ruleCount: "1", skippedRuleCount: "0", computedAt: older },
        { assetId: ASSET_A, pointKey: "temp", inRangeCount: "1", sampleCount: "1", ruleCount: "1", skippedRuleCount: "0", computedAt: newer },
      ], // readCounters
      [], // healthForAssets
      [], // catalogPoints
    ]);
    const service = new AssetHealthService(db);
    const result = await service.forAsset(ASSET_A, 1_440, NOW);
    assert(
      result.computedAt === newer.toISOString(),
      `computedAt must be the newest row instant, got ${String(result.computedAt)}`,
    );
  }

  {
    const { db } = scriptedDb([[], [], []]); // readCounters returns nothing at all
    const service = new AssetHealthService(db);
    const result = await service.forAsset(ASSET_A, 1_440, NOW);
    assert(result.computedAt === null, `computedAt must be null when no rows were read, got ${String(result.computedAt)}`);
  }
}

/**
 * **`F4.72` assertion 1 — `expectedBuckets` is `F3.35`'s arithmetic, at the
 * level actually read.**
 *
 * The three rungs are exercised together with `bucketSeconds`, because the pair
 * is what a reader checks the number against: 1,440 buckets of 60 seconds is a
 * day; 1,440 buckets of 86,400 seconds is not. A copy of the ladder inside
 * `asset-health/` would pass one of these and fail the others, which is exactly
 * the second ladder ADR 0050 decision 6 forbids.
 */
export async function assertExpectedBucketsFollowsTheLadderAtEveryRung(): Promise<void> {
  const cases = [
    { windowMinutes: 1_440, bucketSeconds: 60, expectedBuckets: 1_440 }, // 24 h at 1m
    { windowMinutes: 2_880, bucketSeconds: 60, expectedBuckets: 2_880 }, // 48 h at 1m — the last 1m rung
    { windowMinutes: 43_200, bucketSeconds: 3_600, expectedBuckets: 720 }, // 30 d at 1h
    { windowMinutes: 525_600, bucketSeconds: 86_400, expectedBuckets: 365 }, // 365 d at 1d
  ];

  for (const expected of cases) {
    const { db } = scriptedDb([[], [], []]);
    const service = new AssetHealthService(db);
    const result = await service.forAsset(ASSET_A, expected.windowMinutes, NOW);
    assert(
      result.bucketSeconds === expected.bucketSeconds,
      `${expected.windowMinutes} minutes must be read at ${expected.bucketSeconds}s buckets, ` +
        `got ${result.bucketSeconds}`,
    );
    assert(
      result.expectedBuckets === expected.expectedBuckets,
      `${expected.windowMinutes} minutes at ${expected.bucketSeconds}s must expect ` +
        `${expected.expectedBuckets} buckets, got ${result.expectedBuckets}`,
    );
  }
}

/**
 * **`F4.72` assertion 2 — coverage is asked of the database, over the SAME
 * predicate the scores came from.**
 *
 * Two facts, and both are the ones a mutation would break silently:
 *
 * 1. The `coveredBuckets` field is a `count(distinct ...)` over the bucket
 *    column. A regression to `count(*)`, or to a per-tag count, still returns a
 *    plausible integer — nothing downstream would look wrong.
 * 2. The subquery's predicate is character-for-character the outer read's
 *    predicate. Two predicates that drift would measure coverage over a
 *    different window from the scores, and both numbers would still look
 *    reasonable. `service.ts` builds `scope` once for this reason; this holds it
 *    to that.
 *
 * `PgDialect().sqlToQuery` renders without a connection, the same mechanism
 * {@link assertRuleTalliesUseMaxNotSum} already uses. Parameter numbering
 * restarts at `$1` for each independent render, so the outer predicate's text
 * appears verbatim inside the subquery's.
 */
export async function assertCoverageCountsDistinctBucketsOverTheSamePredicate(): Promise<void> {
  const dialect = new PgDialect();
  const render = (expr: unknown): string => dialect.sqlToQuery(expr as unknown as SQL).sql;

  const { db, calls } = scriptedDb([[], [], []]);
  const service = new AssetHealthService(db);
  await service.forAsset(ASSET_A, 1_440, NOW);

  const counterRead = calls[0];
  const fields = counterRead?.fields as Record<string, unknown>;
  const coverage = render(fields.coveredBuckets).replace(/\s+/g, " ").trim();

  assert(
    /count\(distinct\b/i.test(coverage),
    `coveredBuckets must count DISTINCT bucket instants, got ${coverage}`,
  );
  assert(
    /"bucket"/.test(coverage),
    `coveredBuckets must count the bucket column, not rows or tags, got ${coverage}`,
  );
  assert(
    !/point_key/i.test(coverage.split("where")[0] ?? ""),
    `coveredBuckets must not group or count by point_key — one sweep pass writes every ruled ` +
      `tag in a bucket, so a per-tag count reports an idle sensor as a roll-up outage. Got ${coverage}`,
  );

  const outerWhere = render(counterRead?.where).replace(/\s+/g, " ").trim();
  assert(
    outerWhere.length > 0,
    "the counter read must carry a where predicate at all — without one, coverage is measured " +
      "over a window nobody asked for",
  );
  assert(
    coverage.includes(outerWhere),
    "the coverage subquery must use the SAME predicate the counter read uses, or coverage is " +
      `measured over a different window from the scores. Outer: ${outerWhere}. Subquery: ${coverage}`,
  );
}

/**
 * **`F4.72` assertion 3 — coverage is the value the query returned, never the
 * number of rows it returned.**
 *
 * Three tag rows all carrying the same scope-wide count of six must report six.
 * Counting the rows instead gives three, which is the plausible-looking wrong
 * answer this pins: it is per-tag, it is smaller, and nothing else in the
 * response contradicts it.
 */
export async function assertCoveredBucketsIsTheScopeCountNotTheRowCount(): Promise<void> {
  const row = (pointKey: string): Record<string, unknown> => ({
    assetId: ASSET_A,
    pointKey,
    inRangeCount: "1",
    sampleCount: "1",
    ruleCount: "1",
    skippedRuleCount: "0",
    computedAt: new Date("2026-08-29T11:59:00.000Z"),
    coveredBuckets: "6",
  });

  const { db } = scriptedDb([[row("kw"), row("temp"), row("pf")], [], []]);
  const service = new AssetHealthService(db);
  const result = await service.forAsset(ASSET_A, 1_440, NOW);

  assert(
    result.coveredBuckets === 6,
    `coveredBuckets must be the scope-wide count the query returned (6), not the row count (3) ` +
      `nor anything else; got ${result.coveredBuckets}`,
  );
  assert(
    result.expectedBuckets === 1_440,
    `expectedBuckets must still be the window's own count, got ${result.expectedBuckets}`,
  );
}

/**
 * **`F4.72` assertion 4 — an empty scope reports zero coverage beside a real
 * expectation, and `computedAt: null` with it.**
 *
 * Amendment 2 decision 1 requires those two to agree. `expectedBuckets` stays
 * non-zero because the window the caller asked for is a fact about the request,
 * not about what was found in it — zeroing it would make "asked for a day, got
 * nothing" indistinguishable from "asked for nothing".
 */
export async function assertEmptyScopeReportsZeroCoverageAndNoInstant(): Promise<void> {
  const { db } = scriptedDb([]);
  const service = new AssetHealthService(db);
  const result = await service.summary([], undefined, 1_440, NOW);

  assert(result.coveredBuckets === 0, `an empty scope covers no bucket, got ${result.coveredBuckets}`);
  assert(
    result.expectedBuckets === 1_440,
    `the requested window still expects 1440 buckets, got ${result.expectedBuckets}`,
  );
  assert(
    result.computedAt === null,
    `coveredBuckets: 0 and computedAt: null must arrive together, got ${String(result.computedAt)}`,
  );
}
