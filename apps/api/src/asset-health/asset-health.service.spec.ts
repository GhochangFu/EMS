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
  where: () => Chain;
  orderBy: () => Chain;
  groupBy: () => Chain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

function chainOf(rows: unknown[]): Chain {
  const chain: Chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
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
function scriptedDb(responses: readonly unknown[][]): { db: BmsDb; calls: { fields: unknown }[] } {
  const calls: { fields: unknown }[] = [];
  const db = {
    select: (fields: unknown) => {
      const index = calls.length;
      calls.push({ fields });
      if (index >= responses.length) {
        throw new Error(
          `scriptedDb: unscripted select() call #${index} — only ${responses.length} ` +
            "response(s) were scripted. Either the call order assumption documented at the " +
            "call site is wrong, or this case needs one more scripted response.",
        );
      }
      return chainOf(responses[index] as unknown[]);
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
