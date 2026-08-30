import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAllSkippedStateWritesZero,
  assertInRangeCountIsCorrect,
  assertLevelRollupSumsCountsAndMaxesRuleTallies,
  assertMalformedRuleIsSkippedNotTreatedAsNotFiring,
  assertOnConflictReEvaluatesOnRerun,
  assertTenantJoinContainsRawAndLevelRollups,
  assertUnruledTagGetsNoRow,
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from "./health-rollup.integration.spec";

/**
 * `E1.3` — Vitest entry point for the health roll-up SQL, run against a real
 * database rather than asserted on generated text (`health-rollup-sql.test.ts`
 * covers the text). Assertions live in the sibling `.spec` (ADR 0014, §4.6);
 * this file owns the database lifecycle.
 *
 * `connection: "owner"` — deliberately not remapped. This suite needs the
 * **tenant** role specifically (`withTenant` runs the roll-up as it, and
 * `bms.assets`/`bms.automation_rules` are FORCE ROW LEVEL SECURITY), so
 * `DATABASE_URL` is expected to already name `bms_tenant` when this suite is
 * run — see the file header this item's task named. `"owner"` is the one
 * `connection` value `resolveIntegrationRoleUrl` passes through unchanged.
 */
const connectionString = requireIntegrationDb({
  item: "E1.3",
  label: "health roll-up integration tests",
  because:
    "health-rollup-sql.spec.ts only asserts on generated SQL text — the max-vs-sum split, the " +
    "tenant JOINs and the ELSE-less CASE's zero-write are engine behaviours no string assertion " +
    "can prove, so a green run without a database checks none of them.",
  connection: "owner",
});

describe.skipIf(!connectionString)("E1.3 — health roll-up SQL, executed", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "E1.3");
    pool = created;
    fx = await setupFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await teardownFixtures(pool, fx).catch(() => undefined);
      await pool.end();
    }
  }, 60_000);

  it("writes the right in_range_count for a real firing rule (item 1)", async () => {
    await assertInRangeCountIsCorrect(pool as pg.Pool, fx);
  });

  it("skips a malformed rule rather than treating it as not-firing (item 2)", async () => {
    await assertMalformedRuleIsSkippedNotTreatedAsNotFiring(pool as pg.Pool, fx);
  });

  it("writes in_range_count = 0 when every matching rule is skipped (item 3)", async () => {
    await assertAllSkippedStateWritesZero(pool as pg.Pool, fx);
  });

  it("writes no row at all for a tag with telemetry but no matching rule (item 4)", async () => {
    await assertUnruledTagGetsNoRow(pool as pg.Pool, fx);
  });

  it("re-evaluates against the current rule set on ON CONFLICT DO UPDATE (item 5)", async () => {
    await assertOnConflictReEvaluatesOnRerun(pool as pg.Pool, fx);
  }, 30_000);

  it("sums the counts and maxes the rule tallies when rolling 1m up to 5m (item 6)", async () => {
    await assertLevelRollupSumsCountsAndMaxesRuleTallies(pool as pg.Pool, fx);
  });

  it("contains the raw and level roll-ups to the caller's own tenant (item 7)", async () => {
    await assertTenantJoinContainsRawAndLevelRollups(pool as pg.Pool, fx);
  });
});
