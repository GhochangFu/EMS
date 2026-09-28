import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AccessFixturesSeed from "../packages/db/dist/access-fixtures-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as MapLocationsSeed from "../packages/db/dist/map-locations-seed.js";
import type * as PheMapSeed from "../packages/db/dist/phe-map-seed.js";
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
const { readEskomChecks, readPhewbChecks } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { eskomCanonicalLocationRows, eskomLocationCode, resolveSeedLocation, seedEskomLocations } = require_(
  "../packages/db/dist/eskom-locations-seed.js",
) as typeof EskomLocationsSeed;
const { DECOMMISSIONED_LOCATION_CODE, DECOMMISSIONED_LOCATION_SLUG, seedAccessControlFixtures } = require_(
  "../packages/db/dist/access-fixtures-seed.js",
) as typeof AccessFixturesSeed;
const { mapLocationRowsForInsert } = require_("../packages/db/dist/map-locations-seed.js") as typeof MapLocationsSeed;
const { pheMapLocationRowsForInsert } = require_("../packages/db/dist/phe-map-seed.js") as typeof PheMapSeed;
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
  let superPool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";
  let phewbOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.169/F4.170");
    // The seed's slug reader (OQ2): `seed.ts` builds it from
    // DATABASE_URL_SUPERUSER, and so does this.
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.169/F4.170");
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
    await superPool?.end();
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
      const before = actualOf(await readPhewbChecks(pool), label);
      await insertLocation(pool, phewbOrgId, `F4169-${RUN_ID}-NEW`, adminPheSlug, "pump_station");
      const probe = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM bms.locations WHERE slug = $1`,
        [adminPheSlug],
      );
      assert(probe.rows[0]?.n === 1, "the admin location must be visible in PHEWB's context");
      // Mutation: the count back on the pattern reads +1.
      expect(actualOf(await readPhewbChecks(pool), label), "the admin slug is not a legacy row").toBe(
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

  // ── Owner ruling 16: the seed owns the slug and code of its locations ──────

  /** The rows `seed.ts` hands `seedEskomLocations`. */
  const seedMapRows = [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert()];

  /** One location's identity columns. */
  type LocationRow = { id: string; slug: string; code: string; active: boolean; seed_key: string | null };

  async function readLocation(pool: SeedPool, id: string): Promise<LocationRow | undefined> {
    const { rows } = await pool.query<LocationRow>(
      `SELECT id, slug, code, active, meta->>'seedKey' AS seed_key FROM bms.locations WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /** The id of the ESKOM location with `code`, read in the caller's ESKOM context. */
  async function eskomLocationId(pool: SeedPool, code: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND code = $2`,
      [eskomOrgId, code],
    );
    assert(rows.length === 1, `${code} must be seeded once in ESKOM — run pnpm db:seed.`);
    return rows[0]?.id as string;
  }

  /**
   * In ESKOM's context: runs `seedEskomLocations` and
   * `seedAccessControlFixtures` once first, so every canonical row and
   * ESK-DECOMM-01 carries its key (the steady state after the first boot,
   * whether or not the shared database has been re-seeded since this
   * change), then hands `body` a seed that collects its log lines. The slug reader is
   * the seed pool itself: a fixture this transaction writes is invisible to
   * any other connection, and the ESKOM holders these cases write are visible
   * in ESKOM's context. OQ2's cross-organization reader has its own cases.
   */
  async function inStampedEskomTransaction(
    body: (pool: SeedPool, seed: () => Promise<string[]>) => Promise<void>,
  ): Promise<void> {
    await inTransaction(eskomOrgId, async (pool) => {
      // A lock wait, not a hang, if a mutation lets a write meet a row
      // another connection holds.
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      // ESK-DECOMM-01 is stamped too, as every boot after this change leaves
      // it, so each case runs in the state a re-seeded database is in.
      await seedAccessControlFixtures(pool);
      await body(pool, async () => {
        const lines: string[] = [];
        await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, (line) => lines.push(line));
        return lines;
      });
    });
  }

  it("S1: a canonical location's slug renamed by an admin is reverted on the same row", async () => {
    await inStampedEskomTransaction(async (pool, seed) => {
      const id = await eskomLocationId(pool, "RSMOC-WC");
      await pool.query(`UPDATE bms.locations SET slug = $1 WHERE id = $2`, [`f4169-${runId}-s1`, id]);
      await seed();
      // Mutation: finding the row by slug alone misses it, the INSERT it
      // falls back to is refused (RSMOC-WC's code is held), and the slug
      // stays renamed.
      expect(await readLocation(pool, id), "RSMOC-WC keeps its id and gets its slug back").toMatchObject({
        slug: "rsmoc-western-cape",
        code: "RSMOC-WC",
      });
    });
  }, 60_000);

  it("S2: a canonical location's code renamed by an admin is reverted on the same row", async () => {
    await inStampedEskomTransaction(async (pool, seed) => {
      const id = await eskomLocationId(pool, "RSMOC-WC");
      await pool.query(`UPDATE bms.locations SET code = $1 WHERE id = $2`, [`F4169-${RUN_ID}-S2`, id]);
      await seed();
      expect(await readLocation(pool, id), "RSMOC-WC keeps its id and gets its code back").toMatchObject({
        slug: "rsmoc-western-cape",
        code: "RSMOC-WC",
      });
    });
  }, 60_000);

  it("S3: keys an admin strips from every canonical location are stamped again on the same rows", async () => {
    await inStampedEskomTransaction(async (pool, seed) => {
      // The ten rows seedEskomLocations owns, by their canonical slugs — not
      // every stamped row: ESK-DECOMM-01 carries a key too, and another
      // function stamps it.
      const canonicalSlugs = eskomCanonicalLocationRows(seedMapRows).map((row) => row.slug);
      const stamped = await pool.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM bms.locations
          WHERE organization_id = $1 AND slug = ANY($2::varchar[]) AND meta ? 'seedKey'
          ORDER BY id`,
        [eskomOrgId, canonicalSlugs],
      );
      assert(
        stamped.rows.length === 10,
        "the first seed must stamp the ten canonical locations: on a database seeded before the key, " +
          `that is the adoption this case is about (got ${stamped.rows.length})`,
      );
      await pool.query(
        `UPDATE bms.locations SET meta = meta - 'seedKey' WHERE id = ANY($1::uuid[])`,
        [stamped.rows.map((row) => row.id)],
      );
      await seed();
      const after = await pool.query<{ id: string; seed_key: string | null }>(
        `SELECT id, meta->>'seedKey' AS seed_key FROM bms.locations WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [stamped.rows.map((row) => row.id)],
      );
      // Mutation: a write that leaves the key out of meta reads null here.
      expect(after.rows, "every row is re-stamped with its slug as the key").toEqual(
        stamped.rows.map((row) => ({ id: row.id, seed_key: row.slug })),
      );
    });
  }, 60_000);

  it("S4: an admin location holding a canonical slug is skipped with one line, not 23505", async () => {
    await inStampedEskomTransaction(async (pool, seed) => {
      const id = await eskomLocationId(pool, "RSMOC-WC");
      const renamed = `f4169-${runId}-s4`;
      await pool.query(`UPDATE bms.locations SET slug = $1 WHERE id = $2`, [renamed, id]);
      const holder = await insertLocation(pool, eskomOrgId, `F4169-${RUN_ID}-S4`, "rsmoc-western-cape", "rsmoc");
      // Mutation: without the slug pre-read the UPDATE writes the held slug
      // and this throws 23505.
      const lines = await seed();
      expect(await readLocation(pool, id), "RSMOC-WC keeps the admin's slug").toMatchObject({
        slug: renamed,
        code: "RSMOC-WC",
      });
      const named = lines.filter((line) => line.includes(id));
      expect(named, "exactly one line names RSMOC-WC").toHaveLength(1);
      expect(named[0], "the line names the holder").toContain(holder);
    });
  }, 60_000);

  it("S5: an admin location holding a canonical code is skipped with one line, and the presence count is unchanged", async () => {
    await inStampedEskomTransaction(async (pool, seed) => {
      const label = "ESKOM seed locations present";
      const before = actualOf(await readEskomChecks(pool, eskomOrgId, { log: () => undefined }), label);
      const id = await eskomLocationId(pool, "RSMOC-WC");
      const renamed = `F4169-${RUN_ID}-S5`;
      await pool.query(`UPDATE bms.locations SET code = $1 WHERE id = $2`, [renamed, id]);
      const holder = await insertLocation(pool, eskomOrgId, "RSMOC-WC", `f4169-${runId}-s5`, "rsmoc");
      // Mutation: without the code pre-read the UPDATE writes the held code
      // and this throws 23505.
      const lines = await seed();
      expect(await readLocation(pool, id), "RSMOC-WC keeps the admin's code").toMatchObject({
        slug: "rsmoc-western-cape",
        code: renamed,
      });
      const named = lines.filter((line) => line.includes(id));
      expect(named, "exactly one line names RSMOC-WC").toHaveLength(1);
      expect(named[0], "the line names the holder").toContain(holder);
      // OQ3: the presence check still finds a row with the code; the log line
      // is the record that it is the admin's.
      expect(actualOf(await readEskomChecks(pool, eskomOrgId, { log: () => undefined }), label)).toBe(before);
    });
  }, 60_000);

  it("S6: ESK-DECOMM-01's slug, code and active flag are restored on the same row", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await pool.query("SET LOCAL lock_timeout = '5s'");
      // The first run stamps the key, as the first boot does.
      await seedAccessControlFixtures(pool);
      const id = await eskomLocationId(pool, DECOMMISSIONED_LOCATION_CODE);
      await pool.query(`UPDATE bms.locations SET slug = $1, code = $2, active = true WHERE id = $3`, [
        `f4169-${runId}-s6`,
        `F4169-${RUN_ID}-S6`,
        id,
      ]);
      await seedAccessControlFixtures(pool);
      // Mutation: the upsert back on (organization_id, code) inserts a second
      // row and leaves this one renamed and active.
      expect(await readLocation(pool, id), "ESK-DECOMM-01 is itself again, inactive").toEqual({
        id,
        slug: DECOMMISSIONED_LOCATION_SLUG,
        code: DECOMMISSIONED_LOCATION_CODE,
        active: false,
        seed_key: DECOMMISSIONED_LOCATION_SLUG,
      });
    });
  }, 60_000);

  // ── OQ2: the slug holder is read across organizations ──────────────────────

  it("OQ2a: a slug holder in another organization is invisible to the owner connection and seen by the superuser reader", async () => {
    if (!superPool) throw new Error("pool not initialised");
    const reader = superPool;
    await inTransaction(eskomOrgId, async (pool) => {
      // Read-only: RSMOC-WC's committed slug, looked up as if another row
      // wanted it. The owner connection in PHEWB's context cannot see it.
      const id = await eskomLocationId(pool, "RSMOC-WC");
      const identity = { key: `f4169-${runId}`, slug: "rsmoc-western-cape", code: `F4169-${RUN_ID}-OQ2A` };
      await pool.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      const owner = await resolveSeedLocation(pool, pool, phewbOrgId, identity);
      const superuser = await resolveSeedLocation(pool, reader, phewbOrgId, identity);
      expect(owner.slugHolder, "the owner in PHEWB's context cannot see an ESKOM holder").toBeNull();
      // Mutation: reading the slug holder on `pool` rather than on the reader
      // it is given reads null here too.
      expect(superuser.slugHolder, "the superuser reader sees the ESKOM holder").toBe(id);
    });
  }, 60_000);

  it("OQ2b: a canonical slug held by a PHEWB location is skipped with one line, not 23505", async () => {
    if (!superPool) throw new Error("pool not initialised");
    // A one-row catalog, so only this row is seeded: the canonical slug is the
    // run's own, and a PHEWB location holds it.
    const canonicalSlug = `smoc-f4169-${runId}`;
    const [template] = mapLocationRowsForInsert();
    assert(template !== undefined, "the ESKOM map catalog must not be empty");
    const row = {
      ...template,
      slug: canonicalSlug,
      name: `F4.169 fixture campus ${runId}`,
      kind: "smoc_campus",
      province: null,
      meta: { source: "f4169-fixture" },
    } as unknown as (typeof seedMapRows)[number];
    const code = eskomLocationCode(row);
    // The holder is written on a superuser connection in its own open
    // transaction: the seed's reader sees it there, and no other connection
    // can. The ROLLBACK is in the finally below.
    const holderClient = await superPool.connect();
    try {
      await holderClient.query("BEGIN");
      const holder = await holderClient.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F4.169 fixture PHEWB holder', 'pump_station', 0, 0)
         RETURNING id`,
        [phewbOrgId, `F4169-${RUN_ID}-OQ2B`, canonicalSlug],
      );
      const holderId = holder.rows[0]?.id;
      assert(!!holderId, "the PHEWB holder insert must return an id");
      await inTransaction(eskomOrgId, async (pool) => {
        // Mutation: the slug read on the owner connection misses the holder,
        // the UPDATE waits on its uncommitted unique entry, and this timeout
        // turns the wait into 55P03 rather than a hang.
        await pool.query("SET LOCAL lock_timeout = '3s'");
        const taken = await pool.query(
          `SELECT 1 FROM bms.locations WHERE organization_id = $1 AND code = $2`,
          [eskomOrgId, code],
        );
        assert(taken.rowCount === 0, `the derived code ${code} must be free in ESKOM`);
        const temporary = `f4169-${runId}-oq2b`;
        const ownId = await insertOne(
          pool,
          `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, meta)
           VALUES ($1, $2, $3, 'F4.169 fixture seed row', 'smoc_campus', 0, 0, $4::jsonb)
           RETURNING id`,
          [eskomOrgId, code, temporary, JSON.stringify({ seedKey: canonicalSlug })],
          "ESKOM seed row",
        );
        const lines: string[] = [];
        await seedEskomLocations(pool, holderClient, [row], eskomOrgId, (line) => lines.push(line));
        expect(await readLocation(pool, ownId), "the seed row keeps its slug").toMatchObject({
          slug: temporary,
          code,
        });
        expect(lines, "one line").toHaveLength(1);
        expect(lines[0], "the line names the seed row").toContain(ownId);
        expect(lines[0], "the line names the PHEWB holder").toContain(holderId as string);
      });
    } finally {
      await holderClient.query("ROLLBACK");
      holderClient.release();
    }
  }, 60_000);
});
