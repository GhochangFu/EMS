import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AutomationRulesSeed from "../packages/db/dist/automation-rules-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives: the
// non-strict `typecheck:tests` flags fail on the seed sources. After a source
// edit, run `pnpm --filter @bms/db build` before this suite, or it runs the
// last build.
const require_ = createRequire(import.meta.url);
const { seedEskomLadderRules } = require_(
  "../packages/db/dist/automation-rules-seed.js",
) as typeof AutomationRulesSeed;
const { readEskomChecks, UNCOVERED_ELECTRICAL_LABEL } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.169` / `F4.170` addendum — the boot gate (`verifyHierarchySeed`) lets
 * the stack boot after ordinary admin writes, and still fails closed on the
 * states it exists to catch.
 *
 * **No case calls `verifyHierarchySeed`.** It wraps its tenant passes in
 * `withOrganization`, which issues `BEGIN` … `COMMIT` on the seed pool's one
 * connection; inside this suite's open transaction that `COMMIT` would make
 * the fixture permanent. Each case calls the `read*Checks` passes instead,
 * inside its own `BEGIN`, `set_config('app.current_organization', …, true)`
 * and `ROLLBACK` in a `finally`, so nothing this suite writes survives it.
 *
 * **Every assertion is a delta** against a baseline read in the same
 * transaction before the fixture, never "the check passes": the database is
 * shared, and another suite's live fixture can move a count.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs (`seed-tenant.ts`), so the
 * `FORCE ROW LEVEL SECURITY` path is the real one.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.169/F4.170",
  label: "verifyHierarchySeed's checks against ordinary admin writes",
  because:
    "every count the boot gate reads is a row count under FORCE ROW LEVEL SECURITY, " +
    "and the collision exemption depends on rows the ladder seed writes, so a green " +
    "run without a real Postgres asserts nothing about any of them.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;
type SeedDb = ReturnType<typeof createDb>;
type HierarchyCheck = VerifyHierarchySeed.HierarchyCheck;
type LadderCollisionSkip = AutomationRulesSeed.LadderCollisionSkip;

/** Lowercase hex from `randomUUID`; the fixture codes carry it. */
const runId = randomUUID().slice(0, 8);
const RUN_ID = runId.toUpperCase();

/** The `actual` of the one check labelled `label`, or a failure naming it. */
function actualOf(checks: readonly HierarchyCheck[], label: string): number {
  const found = checks.filter((check) => check.label === label);
  assert(found.length === 1, `expected one check labelled "${label}", found ${found.length}`);
  return found[0]?.actual ?? Number.NaN;
}

/** The skips that name this run's fixtures; the seed walks every ESKOM asset. */
function runSkips(skips: readonly LadderCollisionSkip[]): LadderCollisionSkip[] {
  return skips.filter((skip) => skip.assetCode.toLowerCase().includes(runId));
}

describe.skipIf(!ownerUrl)("F4.169/F4.170 addendum — the boot gate after ordinary admin writes", () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";
  let rsmocWcId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.169/F4.170");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);

    const org = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    assert(eskomOrgId !== "", "the ESKOM organization is not seeded — run pnpm db:seed.");

    const location = await probePool.query<{ id: string }>(
      `SELECT l.id FROM bms.locations l
         JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'ESKOM' AND l.code = 'RSMOC-WC'`,
    );
    rsmocWcId = location.rows[0]?.id ?? "";
    assert(rsmocWcId !== "", "RSMOC-WC is not seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  /** What one ESKOM transaction hands its body. */
  type EskomTx = {
    pool: SeedPool;
    db: SeedDb;
    /** An ESKOM electrical asset at RSMOC-WC, with no RTU and no rule. */
    insertElectricalAsset: (code: string) => Promise<string>;
    /** Runs the ladder seed; its warnings go nowhere. */
    seed: () => Promise<LadderCollisionSkip[]>;
  };

  /**
   * `BEGIN` … `ROLLBACK` around `body` on the seed pool's one connection, in
   * ESKOM's tenant context. The `ROLLBACK` is in a `finally`, so a red
   * assertion leaks nothing.
   */
  async function inEskomTransaction(body: (tx: EskomTx) => Promise<void>): Promise<void> {
    if (!seedPool || !seedDb) throw new Error("pool not initialised");
    const pool = seedPool;
    const db = seedDb;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      // Lock the ESKOM electrical assets the ladder seed will read, so another
      // suite's delete waits for this ROLLBACK rather than failing an insert
      // here with 23503 (the F4.129 suite's reasoning).
      await pool.query(
        `SELECT a.id FROM bms.assets a
           JOIN bms.organizations o ON o.id = a.organization_id
          WHERE o.code = 'ESKOM' AND a.domain = 'electrical'
          FOR KEY SHARE OF a`,
      );
      await body({
        pool,
        db,
        insertElectricalAsset: async (code) => {
          const inserted = await pool.query<{ id: string }>(
            `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
             VALUES ($1, $2, $3, $4, 'F4.169 fixture', 'electrical')
             RETURNING id`,
            [eskomOrgId, rsmocWcId, code, `F4.169 fixture ${code}`],
          );
          const id = inserted.rows[0]?.id;
          assert(!!id, `the fixture asset insert for ${code} must return an id`);
          return id as string;
        },
        seed: () => seedEskomLadderRules(db, eskomOrgId, () => undefined),
      });
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /**
   * The rename-and-reuse fixture: asset A seeded under `OLD`, renamed `NEW`,
   * and a new electrical asset B given `OLD`. B's five ladder codes are the
   * five A's rules still hold, so guard 3 skips all five and B is uncovered.
   * Returns B and the skips of the seed that ran after B existed.
   */
  async function renameAndReuse(tx: EskomTx): Promise<{ bId: string; bCode: string; skips: LadderCollisionSkip[] }> {
    const oldCode = `F4169-${RUN_ID}-OLD`;
    const newCode = `F4169-${RUN_ID}-NEW`;
    const aId = await tx.insertElectricalAsset(oldCode);
    await tx.seed();
    const renamed = await tx.pool.query(`UPDATE bms.assets SET code = $1 WHERE id = $2`, [newCode, aId]);
    assert(renamed.rowCount === 1, "the rename must update asset A");
    const bId = await tx.insertElectricalAsset(oldCode);
    const skips = await tx.seed();
    return { bId, bCode: oldCode, skips };
  }

  /**
   * The uncovered count before any fixture. The ladder seed runs first, so a
   * live asset another suite committed without rules is covered before the
   * baseline, and the fixture's own seed cannot move the count under it.
   */
  async function uncoveredBaseline(tx: EskomTx): Promise<number> {
    await tx.seed();
    return actualOf(await readEskomChecks(tx.pool, eskomOrgId, { log: () => undefined }), UNCOVERED_ELECTRICAL_LABEL);
  }

  it("V2: rename-and-reuse — the seed returns B as its one skip", async () => {
    await inEskomTransaction(async (tx) => {
      const { bId, bCode, skips } = await renameAndReuse(tx);
      // Mutation: not recording the skip, or recording it once per rule,
      // changes this list.
      expect(runSkips(skips), "the seed must return exactly B, once").toEqual([{ assetId: bId, assetCode: bCode }]);
    });
  }, 60_000);

  it("V2: rename-and-reuse — the verifier exempts B, so the uncovered count stays at its baseline", async () => {
    await inEskomTransaction(async (tx) => {
      const baseline = await uncoveredBaseline(tx);
      const { skips } = await renameAndReuse(tx);
      const checks = await readEskomChecks(tx.pool, eskomOrgId, { ladderCollisionSkips: skips, log: () => undefined });
      // Mutation: dropping the exemption filter counts B, and this reads +1.
      expect(actualOf(checks, UNCOVERED_ELECTRICAL_LABEL), "B must be exempted, not counted").toBe(baseline);
    });
  }, 60_000);

  it("V2: rename-and-reuse — the verifier logs one exemption line naming B", async () => {
    await inEskomTransaction(async (tx) => {
      const { bId, bCode, skips } = await renameAndReuse(tx);
      const lines: string[] = [];
      await readEskomChecks(tx.pool, eskomOrgId, { ladderCollisionSkips: skips, log: (line) => lines.push(line) });
      // Mutation: dropping the log call leaves no line.
      const bLines = lines.filter((line) => line.includes(bId));
      expect(bLines, "exactly one exemption line must name B").toHaveLength(1);
      expect(bLines[0], "the exemption line must name B's code and id").toContain(`${bCode} (${bId})`);
    });
  }, 60_000);

  it("V3: with no options the verifier exempts nothing, so B counts (+1)", async () => {
    await inEskomTransaction(async (tx) => {
      const baseline = await uncoveredBaseline(tx);
      await renameAndReuse(tx);
      // The `verify:hierarchy` CLI's call: no skips, so it fails closed.
      // Mutation: a default that exempts something reads the baseline here.
      const checks = await readEskomChecks(tx.pool, eskomOrgId);
      expect(actualOf(checks, UNCOVERED_ELECTRICAL_LABEL), "B must count with no skips passed").toBe(baseline + 1);
    });
  }, 60_000);

  it("V4: an uncovered asset with no collision still counts, with the seed's skips passed (+1)", async () => {
    await inEskomTransaction(async (tx) => {
      const baseline = await uncoveredBaseline(tx);
      const { skips } = await renameAndReuse(tx);
      assert(runSkips(skips).length === 1, "the fixture must make the skip list non-empty");
      // C is inserted after the seed, so it carries no rule, and no seed ran
      // for it, so it is on no skip list.
      await tx.insertElectricalAsset(`F4169-${RUN_ID}-C`);
      const checks = await readEskomChecks(tx.pool, eskomOrgId, { ladderCollisionSkips: skips, log: () => undefined });
      // Mutation: exempting every uncovered asset whenever the list is
      // non-empty reads the baseline here.
      expect(actualOf(checks, UNCOVERED_ELECTRICAL_LABEL), "C must count; only B is exempt").toBe(baseline + 1);
    });
  }, 60_000);
});
