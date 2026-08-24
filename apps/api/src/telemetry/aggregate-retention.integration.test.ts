import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAggregateSurvivesRawChunkDrop,
  assertBoundedRefreshPreservesAggregate,
  assertCoarseLevelsAreNeverDropped,
  assertCompressionStartsAfterTheRefreshWindow,
  assertPerLevelFloorProtectsTheCascade,
  assertPoliciesAreListedUnderViewNames,
  assertRefreshBoundIsDerivedFromRawChunks,
  assertRetentionOutlivesSource,
  assertUnboundedRefreshDestroysAggregate,
  cleanupProbes,
  createProbes,
  materialiseAndSnapshot,
  type RetentionFixtures,
} from "./aggregate-retention.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../testing/integration-db-gate";

/**
 * `F4.2` — Vitest entry point for ADR 0024 compression and retention. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * Skip/fail semantics match `F4.1`, `F4.10`, `F2.1`, `F2.2` and `F4.14` — unset
 * `DATABASE_URL` skips locally and throws under `CI`; a set one that will not
 * connect fails everywhere. **This is the sixth copy of that gate.** `F2.1` put
 * the extraction threshold at the third suite, `F4.14` called it overdue and
 * `F4.1` called it more overdue; it is worse again here. Still not extracted
 * inside the change that adds retention — the `F4.1` row in `docs/BACKLOG.md`
 * carries it, and one more duplication is a smaller risk than refactoring five
 * suites in a migration PR.
 *
 * **Ordering is load-bearing in this file, which is why these are not one test.**
 * The mechanism assertions form a sequence — snapshot, drop, bounded refresh,
 * unbounded refresh — and the last one destroys the fixture the others depend on.
 * Vitest runs `it` blocks in declaration order within a `describe`, so the
 * destructive case is declared last on purpose. Do not reorder them, and do not
 * merge them into a single test: separate cases are what identify *which* step
 * broke.
 */

const connectionString = requireIntegrationDb({
  item: "F4.2",
  label: "compression/retention tests",
  because:
    "that raw retention leaves the aggregates intact, and that an unbounded refresh " +
    "destroys them, are TimescaleDB behaviours. A green run without them asserts nothing, " +
    "and CI cannot catch the regression any other way: db:seed inserts zero telemetry rows, " +
    "so pnpm db:refresh-aggregates is a no-op there whether or not it is still bounded.",
  // `E7.1a` / ADR 0045. This suite creates a probe hypertable and attaches
  // compression and retention policies in `telemetry`, which needs CREATE on the
  // schema and ownership of the table. Since ADR 0045 that is `bms_owner`, and
  // the default fixture connection (`bms_fleet`) has neither — it holds DML
  // grants, not ownership.
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.2 — telemetry compression and retention", () => {
  let pool: pg.Pool | undefined;
  let fx: RetentionFixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.2");
    pool = created;
    await cleanupProbes(created);
    await createProbes(created);
    fx = await materialiseAndSnapshot(created);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await cleanupProbes(pool).catch(() => undefined);
      await pool.end();
    }
  }, 120_000);

  // --- Configuration, read-only against the four real aggregates -------------

  /**
   * First, because every other configuration assertion below depends on it: if the
   * catalog stopped listing aggregate policies under their view names, those
   * assertions would find nothing and pass vacuously rather than fail.
   */
  it("lists aggregate policies under their view names, as the others assume", async () => {
    await assertPoliciesAreListedUnderViewNames(pool as pg.Pool);
  });

  it("retains each fine aggregate strictly longer than raw", async () => {
    await assertRetentionOutlivesSource(pool as pg.Pool);
  });

  it("never drops the two coarse levels", async () => {
    await assertCoarseLevelsAreNeverDropped(pool as pg.Pool);
  });

  it("compresses only well after each level's refresh window", async () => {
    await assertCompressionStartsAfterTheRefreshWindow(pool as pg.Pool);
  });

  it("derives the refresh bound from raw's chunks, not from min(time)", async () => {
    await assertRefreshBoundIsDerivedFromRawChunks(pool as pg.Pool);
  });

  // --- Mechanism, on the probe. Sequential; the last one is destructive. ------

  it("keeps the aggregate intact when raw chunks are dropped", async () => {
    await assertAggregateSurvivesRawChunkDrop(pool as pg.Pool, fx);
  }, 60_000);

  it("keeps it intact through a refresh bounded at raw's oldest chunk", async () => {
    await assertBoundedRefreshPreservesAggregate(pool as pg.Pool, fx);
  }, 60_000);

  /**
   * Declared last because it destroys the fixture. It asserts that the hazard is
   * still real — the justification for the lower bound in
   * `packages/db/src/refresh-aggregates.ts`, which would otherwise read as
   * unexplained caution and be simplified away.
   */
  it("loses it to an unbounded refresh, which is why the bound exists", async () => {
    await assertUnboundedRefreshDestroysAggregate(pool as pg.Pool, fx);
  }, 60_000);

  /**
   * Rebuilds the fixture itself, so it must come after everything that consumes
   * the original. Covers the cascade above `_1m` — the case the single-level probe
   * structurally could not reach, and the one review caught rather than this file.
   */
  it("bounds each level by its own source, not by raw", async () => {
    await assertPerLevelFloorProtectsTheCascade(pool as pg.Pool);
  }, 120_000);
});
