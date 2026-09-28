import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AutomationRulesSeed from "../packages/db/dist/automation-rules-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as DemoUsersSeed from "../packages/db/dist/demo-users-seed.js";
import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as AccessFixturesSeed from "../packages/db/dist/access-fixtures-seed.js";
import type * as MapLocationsSeed from "../packages/db/dist/map-locations-seed.js";
import type * as PheMapSeed from "../packages/db/dist/phe-map-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives. After a
// source edit, run `pnpm --filter @bms/db build` before this suite, or it runs
// the last build.
const require_ = createRequire(import.meta.url);
const { locationIdsWithoutSeedCode, seedEskomLocations } = require_(
  "../packages/db/dist/eskom-locations-seed.js",
) as typeof EskomLocationsSeed;
const { DECOMMISSIONED_LOCATION_CODE, seedDecommissionedLocation } = require_(
  "../packages/db/dist/access-fixtures-seed.js",
) as typeof AccessFixturesSeed;
const { DOMAIN_RTU_SUFFIX, ensureEskomDomainRtus, simRtuCode } = require_(
  "../packages/db/dist/hierarchy-seed.js",
) as typeof HierarchySeed;
const { seedScopedDemoUsers } = require_("../packages/db/dist/demo-users-seed.js") as typeof DemoUsersSeed;
const { readEskomChecks } = require_("../packages/db/dist/verify-hierarchy-seed.js") as typeof VerifyHierarchySeed;
const { ESKOM_LADDER_RULES, seedEskomLadderRules } = require_(
  "../packages/db/dist/automation-rules-seed.js",
) as typeof AutomationRulesSeed;
const { mapLocationRowsForInsert } = require_("../packages/db/dist/map-locations-seed.js") as typeof MapLocationsSeed;
const { pheMapLocationRowsForInsert } = require_("../packages/db/dist/phe-map-seed.js") as typeof PheMapSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.169` / `F4.170` addendum 4 section 3 — what the seed's later steps and
 * the boot gate do with an identity the location seed could not resolve, and
 * the guard 1 log line (section 4).
 *
 * **No case calls `verifyHierarchySeed` or `withOrganization`** (both commit
 * on the seed pool's one connection). Each case is one `BEGIN`, the ESKOM GUC,
 * the seed's own stamp pass, fixture, seed functions, reads, and `ROLLBACK` in
 * a `finally`. The demo-users case runs on one checked-out superuser client,
 * the connection `seed.ts` writes identity rows on, in the same shape.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.169/F4.170",
  label: "an ambiguous seed identity and its consumers",
  because:
    "every case is a seed statement against rows an administrator wrote, under FORCE ROW " +
    "LEVEL SECURITY, and the order it resolves by is created_at in a real Postgres.",
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

/** Lowercase hex from `randomUUID`; the fixture codes and slugs carry it. */
const runId = randomUUID().slice(0, 8);
const RUN_ID = runId.toUpperCase();

/** The rows `seed.ts` hands `seedEskomLocations`. */
const seedMapRows = [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert()];

const EARLY = "2001-01-01T00:00:00Z";
const VIEW_LABEL = "ESKOM RSMOC-WC control room view row";
const DECOMM_LABEL = "ESKOM decommissioned fixture location active";

describe.skipIf(!ownerUrl)("F4.169/F4.170 addendum 4 — an ambiguous seed identity and its consumers", () => {
  let probePool: IntegrationPool | undefined;
  let superPool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(url, "F4.169/F4.170");
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.169/F4.170");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);
    const org = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    assert(eskomOrgId !== "", "ESKOM must be seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await superPool?.end();
    await probePool?.end();
  }, 60_000);

  /**
   * `BEGIN` … `ROLLBACK` in ESKOM's context on the seed pool's one connection.
   * The seed's own stamp pass runs first, in the order the other two
   * `f4.169-f4.170-seed-*` files take the canonical rows' locks, so files run
   * in parallel wait instead of deadlocking.
   */
  async function inEskomTransaction(body: (pool: SeedPool, db: SeedDb) => Promise<void>): Promise<void> {
    if (!seedPool || !seedDb) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      await seedDecommissionedLocation(pool, pool, eskomOrgId, () => undefined);
      await body(pool, seedDb);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /** An ESKOM location with an explicit `created_at` and `meta.seedKey`; returns its id. */
  async function insertLocation(
    pool: SeedPool,
    fixture: { code: string; slug: string; key: string | null; createdAt: string },
  ): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, meta, created_at)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5::jsonb, $6::timestamptz)
       RETURNING id`,
      [
        eskomOrgId,
        fixture.code,
        fixture.slug,
        `F4.169 admin row ${fixture.code}`,
        JSON.stringify(fixture.key === null ? { note: "admin" } : { note: "admin", seedKey: fixture.key }),
        fixture.createdAt,
      ],
    );
    const id = inserted.rows[0]?.id;
    assert(!!id, `the ${fixture.code} insert must return an id`);
    return id as string;
  }

  /** The row keyed for `key` in ESKOM, read in the caller's context. */
  async function keyedId(pool: SeedPool, key: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND meta->>'seedKey' = $2`,
      [eskomOrgId, key],
    );
    assert(rows.length === 1, `${key} must be seeded and keyed once — run pnpm db:seed.`);
    return rows[0]?.id as string;
  }

  function actualOf(checks: readonly HierarchyCheck[], label: string): number {
    const found = checks.filter((check) => check.label === label);
    assert(found.length === 1, `expected one check labelled "${label}", found ${found.length}`);
    return found[0]?.actual ?? Number.NaN;
  }

  const simRtuCodes = (locationCode: string): string[] =>
    Object.values(DOMAIN_RTU_SUFFIX).map((suffix) => simRtuCode(locationCode, suffix));
  const DOMAIN_COUNT = Object.keys(DOMAIN_RTU_SUFFIX).length;

  async function rtusUnder(pool: SeedPool, locationId: string, locationCode: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bms.rtus WHERE location_id = $1 AND code = ANY($2::varchar[])`,
      [locationId, simRtuCodes(locationCode)],
    );
    return rows[0]?.n ?? Number.NaN;
  }

  // ── The RTU step ──────────────────────────────────────────────────────────

  it("R-ambiguous: pre-key held code (C's key wiped, code renamed, Y holds RSMOC-WC): no RTU under C's code", async () => {
    await inEskomTransaction(async (pool, db) => {
      const c = await keyedId(pool, "rsmoc-western-cape");
      const renamed = `F4169-${RUN_ID}-RA`;
      await pool.query(`UPDATE bms.locations SET meta = meta - 'seedKey', code = $2 WHERE id = $1`, [c, renamed]);
      const y = await insertLocation(pool, {
        code: "RSMOC-WC",
        slug: `f4169-${runId}-ra`,
        key: null,
        createdAt: new Date().toISOString(),
      });
      const outcomes = await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      assert(outcomes.get("rsmoc-western-cape")?.id === null, "the pre-key held code must leave RSMOC-WC ambiguous");
      await ensureEskomDomainRtus(db, pool, locationIdsWithoutSeedCode(outcomes.values()));
      // Adjacent positive: the RTU step ran, and the candidate that carries
      // the canonical code gets its set.
      expect(await rtusUnder(pool, y, "RSMOC-WC"), "Y gets its RTUs").toBe(DOMAIN_COUNT);
      // Mutation "an ambiguous identity contributes nothing to the skip set".
      expect(await rtusUnder(pool, c, renamed), "no RTU under C's admin code").toBe(0);
    });
  }, 60_000);

  // ── The boot gate ─────────────────────────────────────────────────────────

  it("V-ambiguous: an older row forged with RSMOC-WC's key makes the identity ambiguous, and the view check passes", async () => {
    await inEskomTransaction(async (pool) => {
      const c = await keyedId(pool, "rsmoc-western-cape");
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
        [c],
      );
      assert(rows[0]?.n === 1, "RSMOC-WC must carry its control room view — run pnpm db:seed.");
      await insertLocation(pool, {
        code: `F4169-${RUN_ID}-VA`,
        slug: `f4169-${runId}-va`,
        key: "rsmoc-western-cape",
        createdAt: EARLY,
      });
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation "the oldest candidate" (candidates[0]): the forged row, which
      // has no view, is read and the check reads 0.
      expect(actualOf(checks, VIEW_LABEL)).toBe(1);
    });
  }, 60_000);

  it("V-ambiguous-two: when two candidates of the ambiguous identity each carry a view, the check still reads 1", async () => {
    await inEskomTransaction(async (pool) => {
      const c = await keyedId(pool, "rsmoc-western-cape");
      const x = await insertLocation(pool, {
        code: `F4169-${RUN_ID}-VT`,
        slug: `f4169-${runId}-vt`,
        key: "rsmoc-western-cape",
        createdAt: EARLY,
      });
      // A copy of C's view row, so every CHECK the table holds is met.
      const copied = await pool.query(
        `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind, dashboard_id, builtin_key)
         SELECT $2, organization_id, kind, dashboard_id, builtin_key
           FROM bms.site_control_room_views WHERE location_id = $1`,
        [c, x],
      );
      assert(copied.rowCount === 1, "RSMOC-WC must carry its control room view — run pnpm db:seed.");
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation "the raw count on an ambiguous identity": 2, and the boot stops.
      expect(actualOf(checks, VIEW_LABEL)).toBe(1);
    });
  }, 60_000);

  /** ESK-DECOMM-01's code renamed, and an active admin row Y holding it. */
  async function decommHeldState(pool: SeedPool): Promise<string> {
    const decomm = await keyedId(pool, "esk-decomm-01");
    await pool.query(`UPDATE bms.locations SET code = $2 WHERE id = $1`, [decomm, `F4169-${RUN_ID}-DA`]);
    const y = await insertLocation(pool, {
      code: DECOMMISSIONED_LOCATION_CODE,
      slug: `f4169-${runId}-da`,
      key: null,
      createdAt: new Date().toISOString(),
    });
    const { rows } = await pool.query<{ active: boolean }>(`SELECT active FROM bms.locations WHERE id = $1`, [y]);
    assert(rows[0]?.active === true, "the admin row holding ESK-DECOMM-01 must be active");
    return decomm;
  }

  it("D-held: an active admin row holding ESK-DECOMM-01 does not move the DECOMM check", async () => {
    await inEskomTransaction(async (pool) => {
      await decommHeldState(pool);
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation "count by l.code": Y is counted and the boot stops.
      expect(actualOf(checks, DECOMM_LABEL)).toBe(0);
    });
  }, 60_000);

  it("D-held: in the same state, the resolved ESK-DECOMM-01 made active moves the DECOMM check (+1)", async () => {
    await inEskomTransaction(async (pool) => {
      const decomm = await decommHeldState(pool);
      await pool.query(`UPDATE bms.locations SET active = true WHERE id = $1`, [decomm]);
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation "a check that reads nothing": 0.
      expect(actualOf(checks, DECOMM_LABEL)).toBe(1);
    });
  }, 60_000);

  // ── The demo users ────────────────────────────────────────────────────────

  it("U-wc: seedScopedDemoUsers grants wc-admin the resolved RSMOC-WC row, not the row found by slug", async () => {
    if (!superPool) throw new Error("pool not initialised");
    const client = await superPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      // Any active ESKOM location other than the one the slug names stands in
      // for "the row the location seed resolved".
      const { rows } = await client.query<{ id: string; slug_row: string }>(
        `SELECT l.id, s.id AS slug_row
           FROM bms.locations l, bms.locations s
          WHERE l.organization_id = $1 AND s.organization_id = $1
            AND s.slug = 'rsmoc-western-cape' AND l.id <> s.id AND l.active
          ORDER BY l.created_at, l.code LIMIT 1`,
        [eskomOrgId],
      );
      const resolved = rows[0]?.id;
      const slugRow = rows[0]?.slug_row;
      assert(!!resolved && !!slugRow, "ESKOM must be seeded — run pnpm db:seed.");
      const grantsOn = async (locationId: string): Promise<number> => {
        const found = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM bms.user_location_access ula
             JOIN bms.users u ON u.id = ula.user_id
            WHERE u.email = 'wc-admin@bms.local' AND ula.location_id = $1`,
          [locationId],
        );
        return found.rows[0]?.n ?? Number.NaN;
      };
      const slugBefore = await grantsOn(slugRow as string);
      await seedScopedDemoUsers(createDb(client as never), eskomOrgId, resolved as string);
      // Mutation "find RSMOC-WC by slug": the grant lands on the slug row.
      expect(await grantsOn(resolved as string), "the grant is on the resolved row").toBe(1);
      expect(await grantsOn(slugRow as string), "no new grant on the slug row").toBe(slugBefore);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 60_000);

  it("U-null: seedScopedDemoUsers with no resolved RSMOC-WC row grants neither wc-admin nor wc-hvac-admin", async () => {
    if (!superPool) throw new Error("pool not initialised");
    const client = await superPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const grants = async (): Promise<{ wcAdmin: number; wcHvacAdmin: number }> => {
        const found = await client.query<{ wc_admin: number; wc_hvac_admin: number }>(
          `SELECT (SELECT COUNT(*)::int FROM bms.user_location_access ula
                     JOIN bms.users u ON u.id = ula.user_id
                    WHERE u.email = 'wc-admin@bms.local') AS wc_admin,
                  (SELECT COUNT(*)::int FROM bms.user_asset_group_access uaga
                     JOIN bms.users u ON u.id = uaga.user_id
                    WHERE u.email = 'wc-hvac-admin@bms.local') AS wc_hvac_admin`,
        );
        return { wcAdmin: found.rows[0]?.wc_admin ?? Number.NaN, wcHvacAdmin: found.rows[0]?.wc_hvac_admin ?? Number.NaN };
      };
      // The seeded grants exist, so a slug fallback would find its insert
      // already done and add nothing: remove them first (rolled back), and
      // prove there was something to remove.
      const seeded = await grants();
      assert(
        seeded.wcAdmin > 0 && seeded.wcHvacAdmin > 0,
        `both demo users must hold their seeded grant — run pnpm db:seed (got ${JSON.stringify(seeded)})`,
      );
      await client.query(
        `DELETE FROM bms.user_location_access
          WHERE user_id = (SELECT id FROM bms.users WHERE email = 'wc-admin@bms.local')`,
      );
      await client.query(
        `DELETE FROM bms.user_asset_group_access
          WHERE user_id = (SELECT id FROM bms.users WHERE email = 'wc-hvac-admin@bms.local')`,
      );
      await seedScopedDemoUsers(createDb(client as never), eskomOrgId, null);
      // Mutation "fall back to the slug lookup on null": one grant each. One
      // assertion on both, so a fallback for either user reddens it.
      expect(await grants(), "no grant for either scoped demo user").toEqual({ wcAdmin: 0, wcHvacAdmin: 0 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 60_000);

  // ── Guard 1's log line (section 4) ────────────────────────────────────────

  /**
   * An electrical asset at RSMOC-WC with the five ladder conditions held by
   * published rules: operator rules, or its own `simulator_threshold` ladder
   * rules (codes ending with the suffix, so guard 2 holds them too).
   */
  async function heldAsset(pool: SeedPool, tag: string, enabled: boolean, source = "operator_rule"): Promise<string> {
    const host = await keyedId(pool, "rsmoc-western-cape");
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, 'F4.169 fixture asset', 'F4.169 fixture', 'electrical')
       RETURNING id`,
      [eskomOrgId, host, `F4169-${RUN_ID}-${tag}`],
    );
    const asset = inserted.rows[0]?.id as string;
    for (const rule of ESKOM_LADDER_RULES) {
      await pool.query(
        `INSERT INTO bms.automation_rules
           (organization_id, code, name, rule_type, asset_id, point_key, operator, threshold_value,
            enabled, lifecycle_status, source)
         VALUES ($1, $2, 'F4.169 fixture published rule', 'threshold', $3, $4, $5, $6, $7, 'published', $8)`,
        [
          eskomOrgId,
          `F4169_${RUN_ID}_${tag}_${rule.suffix}`,
          asset,
          rule.pointKey,
          rule.operator,
          rule.thresholdValue,
          enabled,
          source,
        ],
      );
    }
    return asset;
  }

  it("G1-disabled: guard 1 logs one line per ladder rule it skips for a published, disabled rule", async () => {
    await inEskomTransaction(async (pool, db) => {
      const asset = await heldAsset(pool, "G1OFF", false);
      const lines: string[] = [];
      await seedEskomLadderRules(db, eskomOrgId, (line) => lines.push(line));
      // Mutation "no log line": 0.
      expect(lines.filter((line) => line.includes(asset)), "one line per skipped rule").toHaveLength(
        ESKOM_LADDER_RULES.length,
      );
    });
  }, 60_000);

  it("G1-enabled: guard 1 logs nothing when an enabled published rule holds the condition", async () => {
    await inEskomTransaction(async (pool, db) => {
      const asset = await heldAsset(pool, "G1ON", true);
      const lines: string[] = [];
      await seedEskomLadderRules(db, eskomOrgId, (line) => lines.push(line));
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM bms.automation_rules WHERE asset_id = $1 AND source = 'simulator_threshold'`,
        [asset],
      );
      assert(rows[0]?.n === 0, "guard 1 must skip all five ladder rules on the held asset");
      // Mutation "log on every guard 1 skip": five lines.
      expect(lines.filter((line) => line.includes(asset))).toHaveLength(0);
    });
  }, 60_000);

  it("G1-own-ladder: an asset whose own ladder rules are published and disabled gets no line (guard 2 holds them too)", async () => {
    await inEskomTransaction(async (pool, db) => {
      const asset = await heldAsset(pool, "G1OWN", false, "simulator_threshold");
      const lines: string[] = [];
      await seedEskomLadderRules(db, eskomOrgId, (line) => lines.push(line));
      // Mutation "drop the guard 2 clause from the log": five lines on every
      // boot for a ladder rule an administrator disabled on purpose.
      expect(lines.filter((line) => line.includes(asset))).toHaveLength(0);
    });
  }, 60_000);
});
