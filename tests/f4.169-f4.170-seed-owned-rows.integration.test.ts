import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as DbClient from "../packages/db/dist/client.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
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
const { cleanupLegacyPheRtuLocations } = require_("../packages/db/dist/hierarchy-seed.js") as typeof HierarchySeed;
const { loadPheCatalog, phePilotExpectedRows } = require_(
  "../packages/db/dist/phe-pilot-seed.js",
) as typeof PhePilotSeed;
const { readPhewbChecks } = require_("../packages/db/dist/verify-hierarchy-seed.js") as typeof VerifyHierarchySeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.169` / `F4.170` addendum 2 — the seed changes only the rows it owns.
 *
 * The security review of addendum 1 found admin-reachable seed paths that
 * changed or deleted rows an administrator wrote, or stopped the boot on them.
 * Each case here writes the admin's row, runs the seed function that used to
 * touch it, and reads the row back.
 *
 * **No case calls `verifyHierarchySeed` or `withOrganization`**: both commit
 * on the seed pool's one connection. Each case is one `BEGIN`,
 * `set_config('app.current_organization', …, true)`, fixture, seed function,
 * read, and `ROLLBACK` in a `finally`, so nothing this suite writes survives.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs (`seed-tenant.ts`), so the
 * `FORCE ROW LEVEL SECURITY` path is the real one.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.169/F4.170",
  label: "the seed changes only the rows it owns",
  because:
    "every case is a seed statement against rows an administrator wrote, under " +
    "FORCE ROW LEVEL SECURITY, and the unique and foreign-key failures it guards " +
    "against exist only in a real Postgres.",
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

/** The list `seed.ts` hands `cleanupLegacyPheRtuLocations`, derived the same way. */
const legacySlugs = phePilotExpectedRows(loadPheCatalog()).legacyLocationSlugs;

describe.skipIf(!ownerUrl)("F4.169/F4.170 addendum 2 — the seed changes only the rows it owns", () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";
  let phewbOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.169/F4.170");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);

    const orgs = await probePool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.organizations WHERE code = ANY($1::varchar[])`,
      [["ESKOM", "PHEWB"]],
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    assert(eskomOrgId !== "" && phewbOrgId !== "", "ESKOM and PHEWB must be seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  /**
   * `BEGIN` … `ROLLBACK` around `body` on the seed pool's one connection, in
   * `organizationId`'s tenant context. The `ROLLBACK` is in a `finally`, so a
   * red assertion leaks nothing.
   */
  async function inTransaction(
    organizationId: string,
    body: (pool: SeedPool, db: SeedDb) => Promise<void>,
  ): Promise<void> {
    if (!seedPool || !seedDb) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [organizationId]);
      await body(pool, seedDb);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  async function insertOne(pool: SeedPool, sql: string, values: unknown[], what: string): Promise<string> {
    const inserted = await pool.query<{ id: string }>(sql, values);
    const id = inserted.rows[0]?.id;
    assert(!!id, `the ${what} insert must return an id`);
    return id as string;
  }

  /** A location in `organizationId` with `code` and `slug`; returns its id. */
  function insertLocation(
    pool: SeedPool,
    organizationId: string,
    code: string,
    slug: string,
    type: string,
  ): Promise<string> {
    return insertOne(
      pool,
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0)
       RETURNING id`,
      [organizationId, code, slug, `F4.169 fixture ${code}`, type],
      `location ${code}`,
    );
  }

  /** The `actual` of the one check labelled `label`. */
  function actualOf(checks: readonly HierarchyCheck[], label: string): number {
    const found = checks.filter((check) => check.label === label);
    assert(found.length === 1, `expected one check labelled "${label}", found ${found.length}`);
    return found[0]?.actual ?? Number.NaN;
  }

  // ── Owner ruling 13: the legacy PHE cleanup deletes only the legacy slugs ──

  /** An admin PHEWB location whose slug the old pattern `^phe-.+-(i|ii)$` matched. */
  const adminPheSlug = `phe-f4169${runId}-new-station-ii`;

  it("C1: an admin PHEWB location whose slug ends -ii keeps its row and its asset through the cleanup", async () => {
    assert(!legacySlugs.includes(adminPheSlug), "the admin slug must not be a legacy slug");
    await inTransaction(phewbOrgId, async (pool) => {
      const locationId = await insertLocation(pool, phewbOrgId, `F4169-${RUN_ID}-NEW`, adminPheSlug, "pump_station");
      const assetId = await insertOne(
        pool,
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, 'F4.169 fixture admin PHE asset', 'F4.169 fixture', 'electrical')
         RETURNING id`,
        [phewbOrgId, locationId, `F4169-${RUN_ID}-NEWASSET`],
        "admin PHE asset",
      );
      // Mutation: the cleanup back on the pattern deletes the location, and
      // its asset's foreign key stops the statement with 23503 here.
      await cleanupLegacyPheRtuLocations(pool, legacySlugs);
      const rows = await pool.query<{ id: string }>(
        `SELECT a.id FROM bms.assets a
           JOIN bms.locations l ON l.id = a.location_id
          WHERE l.id = $1`,
        [locationId],
      );
      expect(rows.rows, "the admin location and its asset must both survive").toEqual([{ id: assetId }]);
    });
  }, 60_000);

  it("C2: an admin PHEWB location whose slug ends -ii leaves the legacy zero count unmoved", async () => {
    await inTransaction(phewbOrgId, async (pool) => {
      const label = "PHEWB legacy per-RTU locations";
      const before = actualOf(await readPhewbChecks(pool, phewbOrgId), label);
      await insertLocation(pool, phewbOrgId, `F4169-${RUN_ID}-NEW`, adminPheSlug, "pump_station");
      const probe = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM bms.locations WHERE slug = $1`,
        [adminPheSlug],
      );
      assert(probe.rows[0]?.n === 1, "the admin location must be visible in PHEWB's context");
      // Mutation: the count back on the pattern reads +1.
      expect(actualOf(await readPhewbChecks(pool, phewbOrgId), label), "the admin slug is not a legacy row").toBe(
        before,
      );
    });
  }, 60_000);

  it("C3: a location with a legacy slug, an RTU and an empty group is removed with both", async () => {
    const legacySlug = legacySlugs[0];
    assert(legacySlug !== undefined, "the catalog must derive at least one legacy slug");
    await inTransaction(phewbOrgId, async (pool) => {
      const locationId = await insertLocation(
        pool,
        phewbOrgId,
        `F4169-${RUN_ID}-LEG`,
        legacySlug as string,
        "pump_station",
      );
      await insertOne(
        pool,
        `INSERT INTO bms.rtus (location_id, code, display_name, organization_id)
         VALUES ($1, $2, 'F4.169 fixture legacy RTU', $3)
         RETURNING id`,
        [locationId, `F4169-${RUN_ID}-LEGRTU`, phewbOrgId],
        "legacy RTU",
      );
      await insertOne(
        pool,
        `INSERT INTO bms.asset_groups (location_id, code, name, organization_id)
         VALUES ($1, 'electrical', 'F4.169 fixture legacy group', $2)
         RETURNING id`,
        [locationId, phewbOrgId],
        "legacy group",
      );
      await cleanupLegacyPheRtuLocations(pool, legacySlugs);
      const left = await pool.query<{ locations: number; rtus: number; groups: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM bms.locations WHERE id = $1) AS locations,
           (SELECT COUNT(*)::int FROM bms.rtus WHERE location_id = $1) AS rtus,
           (SELECT COUNT(*)::int FROM bms.asset_groups WHERE location_id = $1) AS groups`,
        [locationId],
      );
      // Mutation: an empty list deletes nothing, and all three read 1.
      expect(left.rows[0], "the legacy location, its RTU and its group must all be gone").toEqual({
        locations: 0,
        rtus: 0,
        groups: 0,
      });
    });
  }, 60_000);
});
