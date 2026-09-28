import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AssetGroupsSeed from "../packages/db/dist/asset-groups-seed.js";
import type * as AutomationRulesSeed from "../packages/db/dist/automation-rules-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomAssetsSeed from "../packages/db/dist/eskom-assets-seed.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as VerifyHierarchyExpected from "../packages/db/dist/verify-hierarchy-expected.js";
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
const { readEskomChecks, readGlobalChecks, readPhewbChecks, UNCOVERED_ELECTRICAL_LABEL } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { hierarchyExpectations } = require_(
  "../packages/db/dist/verify-hierarchy-expected.js",
) as typeof VerifyHierarchyExpected;
const { assignEskomAssetRtus, ensureEskomDomainRtus } = require_(
  "../packages/db/dist/hierarchy-seed.js",
) as typeof HierarchySeed;
const { eskomSeedAssetCatalog, seedEskomAssets } = require_(
  "../packages/db/dist/eskom-assets-seed.js",
) as typeof EskomAssetsSeed;
const { backfillAssetLocations } = require_("../packages/db/dist/asset-groups-seed.js") as typeof AssetGroupsSeed;
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
  let phewbOrgId = "";
  /** One seeded PHE station, the host of the PHEWB fixtures. */
  let pheStationId = "";

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

    const phewb = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'PHEWB'`);
    phewbOrgId = phewb.rows[0]?.id ?? "";
    assert(phewbOrgId !== "", "the PHEWB organization is not seeded — run pnpm db:seed.");

    // The station hosting one catalog PHE asset, read in PHEWB's context. By
    // the asset, not by the derived location code, so a wrong location-code
    // derivation fails its own case (V5) rather than this setup.
    const hostedCode = hierarchyExpectations().phe.assetCodes[0] ?? "";
    const client = await probePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      const station = await client.query<{ location_id: string }>(
        `SELECT location_id FROM bms.assets WHERE code = $1`,
        [hostedCode],
      );
      pheStationId = station.rows[0]?.location_id ?? "";
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    assert(pheStationId !== "", `PHE asset ${hostedCode} is not seeded — run pnpm db:seed.`);
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

  // ── Every count is a claim an admin write cannot move ──────────────────────

  type Pass = "global" | "eskom" | "phewb";

  /** One check before and after a fixture, read in one rolled-back transaction. */
  type Around = { before: HierarchyCheck; after: number };

  /**
   * Reads `label` from `pass`, runs `fixture`, reads it again — all inside one
   * `BEGIN` … `ROLLBACK` in the pass's tenant context (ESKOM for the global
   * pass, which needs none). The `ROLLBACK` is in a `finally`.
   */
  async function around(pass: Pass, label: string, fixture: (pool: SeedPool) => Promise<void>): Promise<Around> {
    if (!seedPool) throw new Error("pool not initialised");
    const pool = seedPool;
    const read = async (): Promise<HierarchyCheck> => {
      const checks =
        pass === "global"
          ? await readGlobalChecks(pool)
          : pass === "eskom"
            ? await readEskomChecks(pool, eskomOrgId, { log: () => undefined })
            : await readPhewbChecks(pool);
      const found = checks.filter((check) => check.label === label);
      assert(found.length === 1, `expected one ${pass} check labelled "${label}", found ${found.length}`);
      return found[0] as HierarchyCheck;
    };
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [
        pass === "phewb" ? phewbOrgId : eskomOrgId,
      ]);
      const before = await read();
      await fixture(pool);
      const after = await read();
      return { before, after: after.actual };
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /** The seeded database meets the check before the fixture: not a vacuous baseline. */
  function assertSeeded(before: HierarchyCheck): void {
    expect(before.actual, `the seeded database must meet "${before.label}" before the fixture`).toBe(before.wanted);
  }

  async function insertOne(pool: SeedPool, sql: string, values: unknown[], what: string): Promise<string> {
    const inserted = await pool.query<{ id: string }>(sql, values);
    const id = inserted.rows[0]?.id;
    assert(!!id, `the ${what} insert must return an id`);
    return id as string;
  }

  /** An asset of `domain` at `locationId`, stamped with `organizationId`. */
  function insertAsset(
    pool: SeedPool,
    organizationId: string,
    locationId: string,
    code: string,
    domain: string,
    templateId: string | null = null,
  ): Promise<string> {
    return insertOne(
      pool,
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, template_id)
       VALUES ($1, $2, $3, $4, 'F4.169 fixture', $5, $6)
       RETURNING id`,
      [organizationId, locationId, code, `F4.169 fixture ${code}`, domain, templateId],
      `asset ${code}`,
    );
  }

  /** A hand-read point, so it needs no RTU (ADR 0018). */
  async function insertManualPoint(pool: SeedPool, organizationId: string, assetId: string, pointKey: string): Promise<void> {
    await pool.query(
      `INSERT INTO bms.asset_points (asset_id, point_key, source_data_key, rtu_id, source_kind, active, organization_id)
       VALUES ($1, $2, $3, NULL, 'manual', true, $4)`,
      [assetId, pointKey, `F4169_${pointKey.toUpperCase()}`, organizationId],
    );
  }

  /** Membership of the `groupCode` group at `locationId`, with `role`. */
  async function joinGroup(
    pool: SeedPool,
    locationId: string,
    groupCode: string,
    assetId: string,
    role: string | null,
  ): Promise<void> {
    const group = await pool.query<{ id: string }>(
      `SELECT id FROM bms.asset_groups WHERE location_id = $1 AND code = $2`,
      [locationId, groupCode],
    );
    const groupId = group.rows[0]?.id;
    assert(!!groupId, `the ${groupCode} group at the fixture location must be seeded`);
    await pool.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, $3)`, [
      groupId,
      assetId,
      role,
    ]);
  }

  it("V1: an ESKOM location with a 64-code-point code, after ensureEskomDomainRtus, leaves the ESKOM location check unmoved", async () => {
    const { before, after } = await around("eskom", "ESKOM seed locations present", async (pool) => {
      // ensureEskomDomainRtus upserts an RTU at every ESKOM location; lock
      // them so another suite's delete waits for this ROLLBACK.
      await pool.query(
        `SELECT l.id FROM bms.locations l
           JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'ESKOM'
          FOR KEY SHARE OF l`,
      );
      const code = `F4170-${runId}-` + "Z".repeat(49);
      assert(Array.from(code).length === 64, "the fixture code must be 64 code points");
      await insertOne(
        pool,
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F4.169 fixture location', 'rsmoc', 0, 0)
         RETURNING id`,
        [eskomOrgId, code, `f4169-${runId}-v1`],
        "ESKOM location",
      );
      await ensureEskomDomainRtus(seedDb as SeedDb, pool);
    });
    assertSeeded(before);
    // Mutation: the count back on every ESKOM location reads +1.
    expect(after, "an admin location must not move the ESKOM location check").toBe(before.actual);
  }, 60_000);

  it("P1: the decommissioned fixture location made active moves its zero check (+1)", async () => {
    const { before, after } = await around("eskom", "ESKOM decommissioned fixture location active", async (pool) => {
      const updated = await pool.query(
        `UPDATE bms.locations SET active = true WHERE organization_id = $1 AND code = 'ESK-DECOMM-01'`,
        [eskomOrgId],
      );
      assert(updated.rowCount === 1, "ESK-DECOMM-01 must be seeded");
    });
    assertSeeded(before);
    expect(after, "an active ESK-DECOMM-01 must fail the check").toBe(before.actual + 1);
  }, 60_000);

  it("V8: an admin IT asset in IT_LOAD leaves the IT_LOAD check unmoved", async () => {
    const { before, after } = await around("eskom", "ESKOM catalog IT assets in IT_LOAD", async (pool) => {
      const assetId = await insertAsset(pool, eskomOrgId, rsmocWcId, `F4169-${RUN_ID}-IT`, "it");
      await insertManualPoint(pool, eskomOrgId, assetId, "rack_kw");
      await joinGroup(pool, rsmocWcId, "IT_LOAD", assetId, null);
    });
    assertSeeded(before);
    // Mutation: the count back on every IT_LOAD member reads +1.
    expect(after, "an admin IT asset must not move the IT_LOAD check").toBe(before.actual);
  }, 60_000);

  it("V8: an admin IT asset with a rack_kw row leaves the rack_kw check unmoved", async () => {
    const { before, after } = await around("eskom", "ESKOM catalog IT assets with a rack_kw catalog row", async (pool) => {
      const assetId = await insertAsset(pool, eskomOrgId, rsmocWcId, `F4169-${RUN_ID}-IT`, "it");
      await insertManualPoint(pool, eskomOrgId, assetId, "rack_kw");
      await joinGroup(pool, rsmocWcId, "IT_LOAD", assetId, null);
    });
    assertSeeded(before);
    // Mutation: the count back on every ESKOM IT rack_kw row reads +1.
    expect(after, "an admin IT asset must not move the rack_kw check").toBe(before.actual);
  }, 60_000);

  it("V9: an admin organization leaves the organization check unmoved", async () => {
    const { before, after } = await around("global", "seed organizations present", async (pool) => {
      await insertOne(
        pool,
        `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F4.169 fixture organization', 'ZAR')
         RETURNING id`,
        [`F4169-${RUN_ID}`],
        "organization",
      );
    });
    assertSeeded(before);
    // Mutation: the count back on every organization reads +1.
    expect(after, "an admin organization must not move the organization check").toBe(before.actual);
  }, 60_000);

  it("V10: an admin asset pinned to the incomer template leaves the incomer check unmoved", async () => {
    const { before, after } = await around(
      "eskom",
      "ESKOM catalog incomers pinned to BASELINE-ELECTRICAL-INCOMER",
      async (pool) => {
        const template = await pool.query<{ id: string }>(
          `SELECT id FROM bms.asset_templates WHERE organization_id = $1 AND code = 'BASELINE-ELECTRICAL-INCOMER'`,
          [eskomOrgId],
        );
        const templateId = template.rows[0]?.id;
        assert(!!templateId, "BASELINE-ELECTRICAL-INCOMER must be seeded");
        await insertAsset(pool, eskomOrgId, rsmocWcId, `F4169-${RUN_ID}-INC`, "electrical", templateId as string);
      },
    );
    assertSeeded(before);
    // Mutation: the count back on every pinned ESKOM asset reads +1.
    expect(after, "an admin asset on the incomer template must not move the incomer check").toBe(before.actual);
  }, 60_000);

  it("V5: an admin PHEWB location leaves the PHEWB location check unmoved", async () => {
    const { before, after } = await around("phewb", "PHEWB catalog locations present", async (pool) => {
      await insertOne(
        pool,
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F4.169 fixture PHE location', 'pump_station', 0, 0)
         RETURNING id`,
        [phewbOrgId, `F4169-${RUN_ID}-PHE`, `f4169-${runId}-phe`],
        "PHEWB location",
      );
    });
    assertSeeded(before);
    // Mutation: the count back on every PHEWB location reads +1.
    expect(after, "an admin PHEWB location must not move the location check").toBe(before.actual);
  }, 60_000);

  it("P2: a legacy per-RTU PHEWB location moves its zero check (+1)", async () => {
    // One of the twelve slugs the cleanup deletes (owner ruling 13); a slug
    // that merely ends -ii is an admin's and is no longer counted.
    const legacySlug = hierarchyExpectations().phe.legacyLocationSlugs[0];
    assert(legacySlug !== undefined, "the PHE catalog must derive a legacy slug");
    const { before, after } = await around("phewb", "PHEWB legacy per-RTU locations", async (pool) => {
      await insertOne(
        pool,
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F4.169 fixture legacy location', 'pump_station', 0, 0)
         RETURNING id`,
        [phewbOrgId, `F4169-${RUN_ID}-LEG`, legacySlug],
        "legacy PHEWB location",
      );
    });
    assertSeeded(before);
    expect(after, "a surviving legacy per-RTU location must fail the check").toBe(before.actual + 1);
  }, 60_000);

  it("V6: an admin PHEWB RTU leaves the PHEWB RTU check unmoved", async () => {
    const { before, after } = await around("phewb", "PHEWB catalog RTUs present", async (pool) => {
      await insertOne(
        pool,
        `INSERT INTO bms.rtus (location_id, code, display_name, organization_id)
         VALUES ($1, $2, 'F4.169 fixture RTU', $3)
         RETURNING id`,
        [pheStationId, `F4169-${RUN_ID}-RTU`, phewbOrgId],
        "PHEWB RTU",
      );
    });
    assertSeeded(before);
    // Mutation: the count back on every PHEWB RTU reads +1.
    expect(after, "an admin PHEWB RTU must not move the RTU check").toBe(before.actual);
  }, 60_000);

  /** A `PHE-` electrical asset with a point and an electrical membership with a role. */
  async function adminPheAsset(pool: SeedPool): Promise<void> {
    const assetId = await insertAsset(pool, phewbOrgId, pheStationId, `PHE-F4169-${RUN_ID}`, "electrical");
    await insertManualPoint(pool, phewbOrgId, assetId, "kw");
    await joinGroup(pool, pheStationId, "electrical", assetId, "meter");
  }

  it("V7: an admin PHE- electrical asset leaves the PHE asset check unmoved", async () => {
    const { before, after } = await around("phewb", "PHE catalog assets present", adminPheAsset);
    assertSeeded(before);
    // Mutation: the count back on every PHE- asset reads +1.
    expect(after, "an admin PHE- asset must not move the asset check").toBe(before.actual);
  }, 60_000);

  it("V7: an admin PHE- asset's point leaves the PHE point check unmoved", async () => {
    const { before, after } = await around("phewb", "PHE catalog asset_points present", adminPheAsset);
    assertSeeded(before);
    // Mutation: the count back on every PHE- asset's points reads +1.
    expect(after, "an admin PHE- point must not move the point check").toBe(before.actual);
  }, 60_000);

  it("V7: an admin PHE- asset's electrical membership leaves the member check unmoved", async () => {
    const { before, after } = await around("phewb", "PHE catalog electrical group members", adminPheAsset);
    assertSeeded(before);
    // Mutation: the count back on every PHE- electrical member reads +1.
    expect(after, "an admin PHE- member must not move the member check").toBe(before.actual);
  }, 60_000);

  it("V7: an admin PHE- asset's roled membership leaves the roled check unmoved", async () => {
    const { before, after } = await around("phewb", "PHE catalog electrical members carrying a role", adminPheAsset);
    assertSeeded(before);
    // Mutation: the count back on every roled PHE- electrical member reads +1.
    expect(after, "an admin PHE- roled member must not move the roled check").toBe(before.actual);
  }, 60_000);

  it("P3: a catalogued TS point moves its zero check (+1)", async () => {
    const tsPoint = hierarchyExpectations().phe.tsPoints[0];
    assert(!!tsPoint, "the PHE catalog must carry a TS sensor");
    const { before, after } = await around("phewb", "PHE TS asset_points", async (pool) => {
      await pool.query(
        `INSERT INTO bms.point_keys (code, name) VALUES ($1, 'F4.169 fixture TS key') ON CONFLICT (code) DO NOTHING`,
        [tsPoint?.pointKey],
      );
      const asset = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code = $1`, [tsPoint?.assetCode]);
      const assetId = asset.rows[0]?.id;
      assert(!!assetId, `${tsPoint?.assetCode} must be seeded`);
      await insertManualPoint(pool, phewbOrgId, assetId as string, tsPoint?.pointKey as string);
    });
    assertSeeded(before);
    expect(after, "a catalogued TS point must fail the check").toBe(before.actual + 1);
  }, 60_000);

  // ── The simulator RTU is resolved by the asset's location ────────────────

  /** An asset's wiring, as `assignEskomAssetRtus` writes it. */
  type Wiring = { code: string; location_id: string; rtu_id: string | null; telemetry_source: string | null };

  /**
   * `BEGIN` … `ROLLBACK` in ESKOM's context, with the ESKOM locations and
   * assets locked so another suite's delete waits for this ROLLBACK: the
   * seeders under test walk every ESKOM location and asset.
   */
  async function inEskomSeedTransaction(body: (pool: SeedPool, db: SeedDb) => Promise<void>): Promise<void> {
    if (!seedPool || !seedDb) throw new Error("pool not initialised");
    const pool = seedPool;
    const db = seedDb;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      await pool.query(
        `SELECT l.id FROM bms.locations l
           JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'ESKOM'
          FOR KEY SHARE OF l`,
      );
      await pool.query(
        `SELECT a.id FROM bms.assets a
           JOIN bms.organizations o ON o.id = a.organization_id
          WHERE o.code = 'ESKOM'
          FOR KEY SHARE OF a`,
      );
      await body(pool, db);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /**
   * L2: a second ESKOM location named `RSMOC Western Cape`, with its five
   * simulator RTUs. `createdAt` backdates it, so an order by
   * `created_at` puts it FIRST — the order that makes a name resolver pick it.
   */
  async function insertSecondWesternCape(pool: SeedPool, db: SeedDb, createdAt: string | null): Promise<string> {
    const id = await insertOne(
      pool,
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, created_at)
       VALUES ($1, $2, $3, 'RSMOC Western Cape', 'rsmoc', 0, 0, COALESCE($4::timestamptz, now()))
       RETURNING id`,
      [eskomOrgId, `F4169-${RUN_ID}-L2`, `f4169-${runId}-l2`, createdAt],
      "second RSMOC Western Cape location",
    );
    await ensureEskomDomainRtus(db, pool);
    const rtus = await pool.query(`SELECT id FROM bms.rtus WHERE location_id = $1`, [id]);
    assert(rtus.rowCount === 5, `L2 must carry five simulator RTUs, got ${rtus.rowCount}`);
    return id;
  }

  /** The wiring of the assets whose `site_name` is `siteName`, by code. */
  async function wiringOf(pool: SeedPool, siteName: string): Promise<Wiring[]> {
    const { rows } = await pool.query<Wiring>(
      `SELECT code, location_id, rtu_id, meta->>'telemetrySource' AS telemetry_source
         FROM bms.assets WHERE site_name = $1 ORDER BY code`,
      [siteName],
    );
    return rows;
  }

  it("R1: a second location named RSMOC Western Cape does not capture any RSMOC-WC asset's RTU", async () => {
    await inEskomSeedTransaction(async (pool, db) => {
      await insertSecondWesternCape(pool, db, "2000-01-01T00:00:00Z");
      const before = await wiringOf(pool, "RSMOC Western Cape");
      assert(before.length > 0, "RSMOC-WC must carry seeded assets");
      assert(
        before.every((row) => row.location_id === rsmocWcId && row.rtu_id !== null),
        "every RSMOC Western Cape asset must start wired at RSMOC-WC",
      );
      await assignEskomAssetRtus(pool);
      // Mutation: resolving by name again (resolveEskomSimRtuId) picks the
      // backdated L2's RTUs, and every rtu_id here changes.
      expect(await wiringOf(pool, "RSMOC Western Cape"), "every RSMOC-WC asset must keep its RTU").toEqual(before);
    });
  }, 60_000);

  it("R2: the non-WTR- water asset, a hand-read asset and ESK-MANUAL-01 keep their rtu_id", async () => {
    await inEskomSeedTransaction(async (pool) => {
      const csmoc = await pool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND code = 'CSMOC-GP'`,
        [eskomOrgId],
      );
      const csmocId = csmoc.rows[0]?.id;
      assert(!!csmocId, "CSMOC-GP must be seeded");
      const waterCode = `F4169-${RUN_ID}-WATER`;
      await pool.query(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, meta)
         VALUES ($1, $2, $3, 'F4.169 fixture water meter', 'CSMOC Gauteng', 'water', '{"telemetrySource":"mqtt"}'::jsonb)`,
        [eskomOrgId, csmocId, waterCode],
      );
      // ESK-MANUAL-01's site_name is not its location's name, so the name
      // predicate alone keeps it out of the driving set. This hand-read asset
      // sits at RSMOC-WC under that location's own name, so only the manual
      // exemption keeps it unwired.
      const manualCode = `F4169-${RUN_ID}-MANUAL`;
      await pool.query(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, meta)
         VALUES ($1, $2, $3, 'F4.169 fixture hand-read meter', 'RSMOC Western Cape', 'electrical',
                 '{"sourceKind":"manual"}'::jsonb)`,
        [eskomOrgId, rsmocWcId, manualCode],
      );
      const read = async () =>
        (
          await pool.query<{ code: string; rtu_id: string | null; telemetry_source: string | null }>(
            `SELECT code, rtu_id, meta->>'telemetrySource' AS telemetry_source
               FROM bms.assets WHERE code = ANY($1::varchar[]) ORDER BY code`,
            [[waterCode, manualCode, "ESK-MANUAL-01"]],
          )
        ).rows;
      const before = await read();
      assert(before.length === 3, "the two fixtures and ESK-MANUAL-01 must all exist");
      await assignEskomAssetRtus(pool);
      // Mutations: dropping the WTR- filter wires the water fixture; dropping
      // the manual exemption wires the hand-read fixture.
      expect(await read(), "no one of the three may be wired to a simulator RTU").toEqual(before);
    });
  }, 60_000);

  it("R3: an asset whose location is not its site_name keeps its rtu_id and telemetrySource", async () => {
    await inEskomSeedTransaction(async (pool) => {
      const code = `F4169-${RUN_ID}-NOSITE`;
      await pool.query(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, meta)
         VALUES ($1, $2, $3, 'F4.169 fixture off-site asset', 'Not a site', 'electrical', '{"telemetrySource":"mqtt"}'::jsonb)`,
        [eskomOrgId, rsmocWcId, code],
      );
      await assignEskomAssetRtus(pool);
      const after = await pool.query<{ rtu_id: string | null; telemetry_source: string | null }>(
        `SELECT rtu_id, meta->>'telemetrySource' AS telemetry_source FROM bms.assets WHERE code = $1`,
        [code],
      );
      // Mutation: dropping `l.name = a.site_name` wires it to RSMOC-WC's
      // ELEC simulator RTU and flips it to simulator.
      expect(after.rows, "the asset must stay unwired and keep its telemetry source").toEqual([
        { rtu_id: null, telemetry_source: "mqtt" },
      ]);
    });
  }, 60_000);

  it("R4: seedEskomAssets with a newer same-name location keeps every catalog asset at the canonical location", async () => {
    await inEskomSeedTransaction(async (pool, db) => {
      await insertSecondWesternCape(pool, db, null);
      await seedEskomAssets(db, pool, eskomSeedAssetCatalog(), eskomOrgId);
      const moved = (await wiringOf(pool, "RSMOC Western Cape")).filter((row) => row.location_id !== rsmocWcId);
      // Mutation: `ORDER BY l.created_at DESC` in resolveEskomSimRtuId picks
      // the newer L2 and moves every RSMOC-WC catalog asset there.
      expect(moved.map((row) => row.code), "no RSMOC Western Cape asset may move off RSMOC-WC").toEqual([]);
    });
  }, 60_000);

  // R5 (a same-name location did not capture the backfill) held vacuously once
  // the backfill fills only a NULL location_id (owner ruling 14, OQ7); L1
  // replaces it.
  it("L1: backfillAssetLocations leaves an admin asset whose site_name names another location where it is", async () => {
    await inEskomSeedTransaction(async (pool) => {
      const csmoc = await pool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND code = 'CSMOC-GP'`,
        [eskomOrgId],
      );
      const csmocId = csmoc.rows[0]?.id;
      assert(!!csmocId, "CSMOC-GP must be seeded");
      const code = `F4169-${RUN_ID}-L1`;
      await pool.query(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, 'F4.169 fixture admin asset', 'RSMOC Western Cape', 'electrical')`,
        [eskomOrgId, csmocId, code],
      );
      await backfillAssetLocations(pool);
      const after = await pool.query<{ location_id: string }>(`SELECT location_id FROM bms.assets WHERE code = $1`, [
        code,
      ]);
      // Mutation: restoring `OR a.location_id <> l.id` moves it to RSMOC-WC.
      expect(after.rows, "the admin asset must stay at CSMOC-GP").toEqual([{ location_id: csmocId }]);
    });
  }, 60_000);
});
