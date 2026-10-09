import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as MapLocationsSeed from "../packages/db/dist/map-locations-seed.js";
import type * as PheMapSeed from "../packages/db/dist/phe-map-seed.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, as
// `tests/f4.169-f4.170-seed-owned-rows.integration.test.ts` does and for its
// reason. After a seed source edit, run `pnpm --filter @bms/db build` first.
const require_ = createRequire(import.meta.url);
const { seedEskomLocations, eskomCanonicalLocationRows, eskomSeedLocationIdentity, resolveSeedLocation } = require_(
  "../packages/db/dist/eskom-locations-seed.js",
) as typeof EskomLocationsSeed;
const { loadPheCatalog, stationSlug, updatePheStationLocation } = require_(
  "../packages/db/dist/phe-pilot-seed.js",
) as typeof PhePilotSeed;
const { mapLocationRowsForInsert } = require_("../packages/db/dist/map-locations-seed.js") as typeof MapLocationsSeed;
const { pheMapLocationRowsForInsert } = require_("../packages/db/dist/phe-map-seed.js") as typeof PheMapSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F2.10` (ADR 0098 decision 5) — a re-seed does not reactivate a seeded
 * location under an inactive parent.
 *
 * The path is the PR's own API: an organization administrator moves a seeded
 * location S under a new node T, then deactivates S and T bottom-up. The
 * seed re-asserted `active = true` on every seeded row, so the next boot's
 * UPDATE of S raised `location_parent_inactive` (23514) and `seed.ts` exited 1.
 *
 * Each case is one `BEGIN` … `ROLLBACK` on the seed pool's one connection, in
 * the organization's tenant context, so nothing it writes survives. The
 * positive control (T active) proves the guard's subquery resolves the parent:
 * a subquery that bound to the wrong row would keep S inactive there too.
 *
 * The PHE cases drive `updatePheStationLocation`, the one statement
 * `seedPheCatalog` runs on an existing station, not the whole catalog: a
 * rolled-back `seedPheCatalog` holds every PHEWB RTU row for seconds and
 * deadlocked `tests/f1.7-seed-ownership`'s committed `UPDATE bms.rtus` when
 * the two files ran side by side.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs, so `FORCE ROW LEVEL SECURITY`
 * and the `locations_tree_guard` trigger both bind.
 */

const ownerUrl = requireIntegrationDb({
  item: "F2.10",
  label: "a re-seed does not reactivate a seeded location under an inactive parent",
  because:
    "the refusal is the locations_tree_guard trigger's, and it exists only in a real Postgres " +
    "migrated past 0103; a green run here would claim the boot survives a moved, deactivated station.",
  connection: "owner",
});

type SeedPool = ReturnType<typeof createSeedPool>;
type SeedDb = ReturnType<typeof createDb>;

const RUN = randomUUID().slice(0, 8).toUpperCase();
const seedMapRows = [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert()];

describe.skipIf(!ownerUrl)("F2.10 — a re-seed leaves a seeded location under an inactive parent alone", () => {
  let probePool: Awaited<ReturnType<typeof openIntegrationPool>> | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";
  let phewbOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.10");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);
    const orgs = await probePool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.organizations WHERE code = ANY($1::varchar[])`,
      [["ESKOM", "PHEWB"]],
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    if (eskomOrgId === "" || phewbOrgId === "") throw new Error("ESKOM and PHEWB must be seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  async function inTransaction(
    organizationId: string,
    body: (pool: SeedPool, db: SeedDb) => Promise<void>,
  ): Promise<void> {
    if (!seedPool || !seedDb) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [organizationId]);
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await body(pool, seedDb);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /**
   * Inserts a root T in `organizationId`, moves `stationId` under it, then
   * deactivates the station and — when `parentInactive` — T, bottom-up as
   * decision 5 requires. Returns T's id.
   */
  async function moveAndDeactivate(
    pool: SeedPool,
    organizationId: string,
    stationId: string,
    parentInactive: boolean,
  ): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F2.10 township', 'township', 0, 0)
       RETURNING id`,
      [organizationId, `F210-SEED-${RUN}`, `f210-seed-${RUN.toLowerCase()}`],
    );
    const parentId = inserted.rows[0]?.id ?? "";
    if (parentId === "") throw new Error("the township insert returned no id");
    await pool.query(`UPDATE bms.locations SET parent_id = $1 WHERE id = $2`, [parentId, stationId]);
    await pool.query(`UPDATE bms.locations SET active = false WHERE id = $1`, [stationId]);
    if (parentInactive) {
      await pool.query(`UPDATE bms.locations SET active = false WHERE id = $1`, [parentId]);
    }
    return parentId;
  }

  /**
   * What the seed hands the update: `active: true`, which the guard overrides.
   * Returned, not written inline: `typecheck:tests` is non-strict and drops the
   * optional `active` from `$inferInsert`, so an inline literal fails TS2353.
   */
  function seedValues(): Parameters<typeof updatePheStationLocation>[2] {
    const values = { organizationId: phewbOrgId, active: true, updatedAt: new Date() };
    return values;
  }

  async function readRow(pool: SeedPool, id: string): Promise<{ active: boolean; parent_id: string | null }> {
    const rows = await pool.query<{ active: boolean; parent_id: string | null }>(
      `SELECT active, parent_id FROM bms.locations WHERE id = $1`,
      [id],
    );
    const row = rows.rows[0];
    if (!row) throw new Error(`location ${id} is gone`);
    return row;
  }

  async function eskomStationId(pool: SeedPool): Promise<string> {
    const first = eskomCanonicalLocationRows(seedMapRows)[0];
    if (!first) throw new Error("no canonical ESKOM location row");
    const claim = await resolveSeedLocation(pool, pool, eskomOrgId, eskomSeedLocationIdentity(first));
    if (claim.id === null) throw new Error(`the canonical ESKOM location ${first.slug} is not seeded`);
    return claim.id;
  }

  async function pheStationId(pool: SeedPool): Promise<string> {
    const head = loadPheCatalog().rows[0];
    if (!head) throw new Error("the PHE catalog is empty");
    const slug = stationSlug(head.StationName);
    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND slug = $2`,
      [phewbOrgId, slug],
    );
    const id = rows.rows[0]?.id;
    if (!id) throw new Error(`the PHE station ${slug} is not seeded`);
    return id;
  }

  it("E1: seedEskomLocations keeps a moved station inactive under its inactive parent, and does not throw", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      const station = await eskomStationId(pool);
      const parent = await moveAndDeactivate(pool, eskomOrgId, station, true);
      await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      expect(await readRow(pool, station)).toEqual({ active: false, parent_id: parent });
    });
  }, 60_000);

  it("E2 positive control: under an active parent, seedEskomLocations reactivates the station", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      const station = await eskomStationId(pool);
      const parent = await moveAndDeactivate(pool, eskomOrgId, station, false);
      await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      expect(await readRow(pool, station)).toEqual({ active: true, parent_id: parent });
    });
  }, 60_000);

  it("P1: the PHE station update keeps a moved station inactive under its inactive parent, and does not throw", async () => {
    await inTransaction(phewbOrgId, async (pool, db) => {
      const station = await pheStationId(pool);
      const parent = await moveAndDeactivate(pool, phewbOrgId, station, true);
      await updatePheStationLocation(db, station, seedValues());
      expect(await readRow(pool, station)).toEqual({ active: false, parent_id: parent });
    });
  }, 60_000);

  it("P2 positive control: under an active parent, the PHE station update reactivates the station", async () => {
    await inTransaction(phewbOrgId, async (pool, db) => {
      const station = await pheStationId(pool);
      const parent = await moveAndDeactivate(pool, phewbOrgId, station, false);
      await updatePheStationLocation(db, station, seedValues());
      expect(await readRow(pool, station)).toEqual({ active: true, parent_id: parent });
    });
  }, 60_000);
});
