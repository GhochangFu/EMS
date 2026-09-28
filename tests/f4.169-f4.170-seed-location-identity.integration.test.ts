import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AccessFixturesSeed from "../packages/db/dist/access-fixtures-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as MapLocationsSeed from "../packages/db/dist/map-locations-seed.js";
import type * as PheMapSeed from "../packages/db/dist/phe-map-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as SiteControlRoomViewsSeed from "../packages/db/dist/site-control-room-views-seed.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import { openIntegrationPool, requireIntegrationDb } from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives. After a
// source edit, run `pnpm --filter @bms/db build` before this suite, or it runs
// the last build.
const require_ = createRequire(import.meta.url);
const { eskomLocationCode, locationIdsWithoutSeedCode, seedEskomLocations } = require_(
  "../packages/db/dist/eskom-locations-seed.js",
) as typeof EskomLocationsSeed;
const { DECOMMISSIONED_LOCATION_CODE, seedDecommissionedLocation } = require_(
  "../packages/db/dist/access-fixtures-seed.js",
) as typeof AccessFixturesSeed;
const { assignEskomAssetRtus, DOMAIN_RTU_SUFFIX, ensureEskomDomainRtus, simRtuCode } = require_(
  "../packages/db/dist/hierarchy-seed.js",
) as typeof HierarchySeed;
const { seedSiteControlRoomViews } = require_(
  "../packages/db/dist/site-control-room-views-seed.js",
) as typeof SiteControlRoomViewsSeed;
const { readEskomChecks } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { mapLocationRowsForInsert } = require_("../packages/db/dist/map-locations-seed.js") as typeof MapLocationsSeed;
const { pheMapLocationRowsForInsert } = require_("../packages/db/dist/phe-map-seed.js") as typeof PheMapSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.169` / `F4.170` addendum 3 — which row is a seed identity's, and what
 * the later steps do with it (owner rulings 17 and 19).
 *
 * Section 1's six states (a)–(f) each run `seedEskomLocations` over a
 * one-row (or two-row) catalog of this run's own identities, so no other
 * identity's write can move the state before the one under test resolves,
 * and each pins the rows' `created_at` explicitly: rows written in one
 * transaction share `now()`, and the rule's order would otherwise fall to a
 * random uuid.
 *
 * **No case calls `verifyHierarchySeed` or `withOrganization`** (both commit
 * on the seed pool's one connection). Each case is one `BEGIN`, the ESKOM
 * GUC, fixture, seed functions, reads, and `ROLLBACK` in a `finally`.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.169/F4.170",
  label: "which row is a seed identity's",
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
type MapRow = EskomLocationsSeed.MapLocationSeedRow;
type HierarchyCheck = VerifyHierarchySeed.HierarchyCheck;

/** Lowercase hex from `randomUUID`; the fixture codes and slugs carry it. */
const runId = randomUUID().slice(0, 8);
const RUN_ID = runId.toUpperCase();

/** The rows `seed.ts` hands `seedEskomLocations`. */
const seedMapRows = [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert()];

/**
 * A canonical row of this run's own, tagged `a` or `b`. The slug's initials
 * are `F`, six hex digits and the tag, so its derived code
 * (`eskomLocationCode`) is this run's too.
 */
function fixtureRow(tag: "a" | "b"): MapRow {
  const [template] = mapLocationRowsForInsert();
  assert(template !== undefined, "the ESKOM map catalog must not be empty");
  return {
    ...template,
    slug: `f4169-${runId.slice(0, 6).split("").join("-")}-${tag}`,
    name: `F4.169 fixture canonical ${tag} ${runId}`,
    kind: "smoc_campus",
    province: null,
    meta: { source: "f4169-fixture" },
  } as unknown as MapRow;
}

const EARLY = "2001-01-01T00:00:00Z";
const LATE = "2002-01-01T00:00:00Z";

describe.skipIf(!ownerUrl)("F4.169/F4.170 addendum 3 — which row is a seed identity's", () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let eskomOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(url, "F4.169/F4.170");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);
    const org = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    assert(eskomOrgId !== "", "ESKOM must be seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  /**
   * `BEGIN` … `ROLLBACK` in ESKOM's context on the seed pool's one connection.
   * The seed's own stamp pass runs first, before any fixture write: on a
   * keyed database it changes nothing, but it takes the canonical rows'
   * locks in the seed's order, the order `tests/f4.169-f4.170-seed-owned-rows`
   * takes them in, so two files run in parallel wait instead of deadlocking.
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

  type Fixture = { code: string; slug: string; key: string | null; createdAt: string; name?: string };

  /** An ESKOM location with an explicit `created_at` and `meta.seedKey`; returns its id. */
  async function insertLocation(pool: SeedPool, fixture: Fixture): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, meta, created_at)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5::jsonb, $6::timestamptz)
       RETURNING id`,
      [
        eskomOrgId,
        fixture.code,
        fixture.slug,
        fixture.name ?? `F4.169 admin row ${fixture.code}`,
        JSON.stringify(fixture.key === null ? { note: "admin" } : { note: "admin", seedKey: fixture.key }),
        fixture.createdAt,
      ],
    );
    const id = inserted.rows[0]?.id;
    assert(!!id, `the ${fixture.code} insert must return an id`);
    return id as string;
  }

  /** The whole row, as JSON: "unchanged" means every column, `meta` and `updated_at` included. */
  async function wholeRow(pool: SeedPool, id: string): Promise<unknown> {
    const { rows } = await pool.query<{ row: unknown }>(
      `SELECT to_jsonb(l) AS row FROM bms.locations l WHERE id = $1`,
      [id],
    );
    return rows[0]?.row;
  }

  async function nameOf(pool: SeedPool, id: string): Promise<string | undefined> {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM bms.locations WHERE id = $1`, [id]);
    return rows[0]?.name;
  }

  async function seed(pool: SeedPool, rows: readonly MapRow[]): Promise<{ lines: string[] }> {
    const lines: string[] = [];
    await seedEskomLocations(pool, pool, rows, eskomOrgId, (line) => lines.push(line));
    return { lines };
  }

  // ── Section 1: the six states ─────────────────────────────────────────────

  it("(a) a wiped key on C and a forged key on a newer X: nothing adopted, X unchanged, one line", async () => {
    await inEskomTransaction(async (pool) => {
      const row = fixtureRow("a");
      const code = eskomLocationCode(row);
      const c = await insertLocation(pool, { code, slug: row.slug, key: null, createdAt: EARLY });
      const x = await insertLocation(pool, {
        code: `F4169-${RUN_ID}-X`,
        slug: `f4169-${runId}-x`,
        key: row.slug,
        createdAt: LATE,
      });
      const [cBefore, xBefore] = [await wholeRow(pool, c), await wholeRow(pool, x)];
      const { lines } = await seed(pool, [row]);
      // Mutation "key first regardless of age": X is adopted and rewritten.
      expect(await wholeRow(pool, x), "the forged row X is not written").toEqual(xBefore);
      expect(await wholeRow(pool, c), "C is not written either").toEqual(cBefore);
      expect(lines, "one line").toHaveLength(1);
      expect(lines[0], "naming C").toContain(c);
      expect(lines[0], "naming X").toContain(x);
    });
  }, 60_000);

  it("(b) no keys, C's slug renamed and an admin Z takes it: nothing adopted, Z and C unchanged", async () => {
    await inEskomTransaction(async (pool) => {
      const row = fixtureRow("a");
      const c = await insertLocation(pool, {
        code: eskomLocationCode(row),
        slug: `f4169-${runId}-renamed`,
        key: null,
        createdAt: EARLY,
      });
      const z = await insertLocation(pool, { code: `F4169-${RUN_ID}-Z`, slug: row.slug, key: null, createdAt: LATE });
      const [cBefore, zBefore] = [await wholeRow(pool, c), await wholeRow(pool, z)];
      const { lines } = await seed(pool, [row]);
      // Mutation "slug before code": Z is adopted and rewritten.
      expect(await wholeRow(pool, z), "the admin row Z is not written").toEqual(zBefore);
      // Mutation "oldest regardless of key": C is adopted and stamped.
      expect(await wholeRow(pool, c), "C is not written").toEqual(cBefore);
      expect(lines, "one line").toHaveLength(1);
      expect(lines[0]).toContain(c);
      expect(lines[0]).toContain(z);
    });
  }, 60_000);

  it("(c) no keys, two canonical rows swap slugs: neither identity overwrites the other's row", async () => {
    await inEskomTransaction(async (pool) => {
      const [rowA, rowB] = [fixtureRow("a"), fixtureRow("b")];
      // RA carries A's code and B's slug; RB carries B's code and A's slug.
      const ra = await insertLocation(pool, {
        code: eskomLocationCode(rowA),
        slug: rowB.slug,
        key: null,
        createdAt: EARLY,
      });
      const rb = await insertLocation(pool, {
        code: eskomLocationCode(rowB),
        slug: rowA.slug,
        key: null,
        createdAt: LATE,
      });
      const [raBefore, rbBefore] = [await wholeRow(pool, ra), await wholeRow(pool, rb)];
      const { lines } = await seed(pool, [rowA, rowB]);
      // Mutation "slug before code": identity A adopts RB and writes A's name on it.
      expect(await wholeRow(pool, rb), "RB is not written").toEqual(rbBefore);
      expect(await wholeRow(pool, ra), "RA is not written").toEqual(raBefore);
      expect(lines, "one line per identity").toHaveLength(2);
    });
  }, 60_000);

  it("(d) C keyed, its code renamed and an admin Y takes the code: C adopted, the code skipped and logged", async () => {
    await inEskomTransaction(async (pool) => {
      const row = fixtureRow("a");
      const renamed = `F4169-${RUN_ID}-D`;
      const c = await insertLocation(pool, {
        code: renamed,
        slug: row.slug,
        key: row.slug,
        createdAt: EARLY,
        name: "admin name on C",
      });
      const y = await insertLocation(pool, {
        code: eskomLocationCode(row),
        slug: `f4169-${runId}-y`,
        key: null,
        createdAt: LATE,
      });
      const yBefore = await wholeRow(pool, y);
      const { lines } = await seed(pool, [row]);
      // Mutation "adopt only a single candidate" (no oldest-keyed clause):
      // nothing is adopted and C keeps the admin's name.
      expect(await nameOf(pool, c), "C is adopted: its name is the seed's").toBe(row.name);
      const { rows } = await pool.query<{ code: string }>(`SELECT code FROM bms.locations WHERE id = $1`, [c]);
      expect(rows[0]?.code, "C keeps the admin's code").toBe(renamed);
      expect(await wholeRow(pool, y), "Y is not written").toEqual(yBefore);
      expect(lines, "one line").toHaveLength(1);
      expect(lines[0]).toContain(c);
      expect(lines[0]).toContain(y);
      expect(lines[0]).toContain("code");
    });
  }, 60_000);

  it("(e) C keyed, its slug renamed and an admin Z takes the slug: C adopted, the slug skipped and logged", async () => {
    await inEskomTransaction(async (pool) => {
      const row = fixtureRow("a");
      const renamed = `f4169-${runId}-e`;
      const c = await insertLocation(pool, {
        code: eskomLocationCode(row),
        slug: renamed,
        key: row.slug,
        createdAt: EARLY,
        name: "admin name on C",
      });
      const z = await insertLocation(pool, { code: `F4169-${RUN_ID}-Z`, slug: row.slug, key: null, createdAt: LATE });
      const zBefore = await wholeRow(pool, z);
      const { lines } = await seed(pool, [row]);
      // Mutation "adopt only a single candidate": C keeps the admin's name.
      expect(await nameOf(pool, c), "C is adopted: its name is the seed's").toBe(row.name);
      const { rows } = await pool.query<{ slug: string }>(`SELECT slug FROM bms.locations WHERE id = $1`, [c]);
      expect(rows[0]?.slug, "C keeps the admin's slug").toBe(renamed);
      expect(await wholeRow(pool, z), "Z is not written").toEqual(zBefore);
      expect(lines, "one line").toHaveLength(1);
      expect(lines[0]).toContain(c);
      expect(lines[0]).toContain(z);
      expect(lines[0]).toContain("slug");
    });
  }, 60_000);

  it("(f) a row keyed for another identity holds B's slug: it is no candidate for B, and B is adopted", async () => {
    await inEskomTransaction(async (pool) => {
      const rowB = fixtureRow("b");
      // A is older than B, so an unrestricted fallback makes A the oldest
      // candidate and leaves B unadopted.
      const a = await insertLocation(pool, {
        code: `F4169-${RUN_ID}-A`,
        slug: rowB.slug,
        key: `f4169-${runId}-other-identity`,
        createdAt: EARLY,
      });
      const b = await insertLocation(pool, {
        code: eskomLocationCode(rowB),
        slug: `f4169-${runId}-b-renamed`,
        key: rowB.slug,
        createdAt: LATE,
        name: "admin name on B",
      });
      const aBefore = await wholeRow(pool, a);
      const { lines } = await seed(pool, [rowB]);
      // Mutation "fallback not restricted to a NULL or own key": A becomes a
      // candidate, the oldest, unkeyed for B, and B is not adopted.
      expect(await nameOf(pool, b), "B is adopted: its name is the seed's").toBe(rowB.name);
      expect(await wholeRow(pool, a), "A is not written").toEqual(aBefore);
      expect(lines, "one line: B's slug is held by A").toHaveLength(1);
      expect(lines[0]).toContain(a);
      expect(lines[0]).toContain(b);
    });
  }, 60_000);

  // ── Section 2 / owner ruling 17: later steps use the resolved rows ────────

  /** The real RSMOC-WC row's id, read in the caller's ESKOM context. */
  async function rsmocWcId(pool: SeedPool): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND meta->>'seedKey' = 'rsmoc-western-cape'`,
      [eskomOrgId],
    );
    assert(rows.length === 1, "RSMOC-WC must be seeded and keyed once — run pnpm db:seed.");
    return rows[0]?.id as string;
  }

  function actualOf(checks: readonly HierarchyCheck[], label: string): number {
    const found = checks.filter((check) => check.label === label);
    assert(found.length === 1, `expected one check labelled "${label}", found ${found.length}`);
    return found[0]?.actual ?? Number.NaN;
  }

  const VIEW_LABEL = "ESKOM RSMOC-WC control room view row";

  async function viewsOn(pool: SeedPool, locationId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
      [locationId],
    );
    return rows[0]?.n ?? Number.NaN;
  }

  /**
   * The held-code state on the real RSMOC-WC: its code renamed, and an admin
   * location Y holding `RSMOC-WC`. Returns both ids and the seed's outcomes.
   */
  async function heldCodeState(pool: SeedPool): Promise<{
    c: string;
    y: string;
    renamed: string;
    outcomes: Map<string, EskomLocationsSeed.SeedLocationOutcome>;
  }> {
    const c = await rsmocWcId(pool);
    assert((await viewsOn(pool, c)) === 1, "RSMOC-WC must carry its control room view — run pnpm db:seed.");
    const renamed = `F4169-${RUN_ID}-HC`;
    await pool.query(`UPDATE bms.locations SET code = $1 WHERE id = $2`, [renamed, c]);
    const y = await insertLocation(pool, {
      code: "RSMOC-WC",
      slug: `f4169-${runId}-hc`,
      key: null,
      createdAt: new Date().toISOString(),
    });
    const outcomes = await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
    return { c, y, renamed, outcomes };
  }

  it("V-held: in the held-code state the view seed writes nothing on the code holder", async () => {
    await inEskomTransaction(async (pool, db) => {
      const { y, outcomes } = await heldCodeState(pool);
      await seedSiteControlRoomViews(db, eskomOrgId, outcomes, () => undefined);
      // Mutation: the view seed back on `code = 'RSMOC-WC'` puts a view on Y.
      expect(await viewsOn(pool, y), "no view on the admin's row").toBe(0);
    });
  }, 60_000);

  it("V-held: in the held-code state the verifier's view check reads the seed's row and passes", async () => {
    await inEskomTransaction(async (pool) => {
      await heldCodeState(pool);
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation: the check back on `l.code = 'RSMOC-WC'` reads Y, which has none.
      expect(actualOf(checks, VIEW_LABEL)).toBe(1);
    });
  }, 60_000);

  it("V-a: with C's key wiped and a forged key on a newer X, the verifier's view check still passes", async () => {
    await inEskomTransaction(async (pool, db) => {
      const c = await rsmocWcId(pool);
      assert((await viewsOn(pool, c)) === 1, "RSMOC-WC must carry its control room view — run pnpm db:seed.");
      await pool.query(`UPDATE bms.locations SET meta = meta - 'seedKey' WHERE id = $1`, [c]);
      const x = await insertLocation(pool, {
        code: `F4169-${RUN_ID}-VX`,
        slug: `f4169-${runId}-vx`,
        key: "rsmoc-western-cape",
        createdAt: new Date().toISOString(),
      });
      const outcomes = await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      assert(outcomes.get("rsmoc-western-cape")?.id === null, "state (a) must leave RSMOC-WC unresolved");
      const viewLines: string[] = [];
      await seedSiteControlRoomViews(db, eskomOrgId, outcomes, (line) => viewLines.push(line));
      assert(viewLines.length === 1, "the view seed must log that it wrote nothing");
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      // Mutation: the check on the keyed row reads the forged X, which has none.
      expect(actualOf(checks, VIEW_LABEL)).toBe(1);
      expect(await viewsOn(pool, x), "no view on the forged row").toBe(0);
    });
  }, 60_000);

  it("V-none: with no view on RSMOC-WC the verifier's view check fails", async () => {
    await inEskomTransaction(async (pool) => {
      const c = await rsmocWcId(pool);
      const deleted = await pool.query(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [c]);
      assert(deleted.rowCount === 1, "RSMOC-WC must carry its control room view — run pnpm db:seed.");
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      expect(actualOf(checks, VIEW_LABEL)).toBe(0);
    });
  }, 60_000);

  /** The codes `ensureEskomDomainRtus` writes under a location code, one per domain. */
  const simRtuCodes = (locationCode: string): string[] =>
    Object.values(DOMAIN_RTU_SUFFIX).map((suffix) => simRtuCode(locationCode, suffix));
  const DOMAIN_COUNT = Object.keys(DOMAIN_RTU_SUFFIX).length;

  /** The RTUs at `locationId` that `ensureEskomDomainRtus` writes under `locationCode`. */
  async function rtusUnder(pool: SeedPool, locationId: string, locationCode: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bms.rtus WHERE location_id = $1 AND code = ANY($2::varchar[])`,
      [locationId, simRtuCodes(locationCode)],
    );
    return rows[0]?.n ?? Number.NaN;
  }

  /** Every asset at `locationId` with its wiring, by id. */
  async function wiring(pool: SeedPool, locationId: string): Promise<unknown[]> {
    const { rows } = await pool.query(
      `SELECT id, rtu_id, meta->>'telemetrySource' AS telemetry_source
         FROM bms.assets WHERE location_id = $1 ORDER BY id`,
      [locationId],
    );
    return rows;
  }

  it("R-held: the held-code row gets no RTU under the admin's code, and its assets keep their wiring", async () => {
    await inEskomTransaction(async (pool, db) => {
      const { c, y, renamed, outcomes } = await heldCodeState(pool);
      const before = await wiring(pool, c);
      assert(before.length > 0, "RSMOC-WC must carry seeded assets — run pnpm db:seed.");
      await ensureEskomDomainRtus(db, pool, locationIdsWithoutSeedCode(outcomes.values()));
      await assignEskomAssetRtus(pool);
      // Adjacent positive: the RTU step ran in this transaction. The admin
      // row Y, which holds the code RSMOC-WC, gets its own set as every
      // other ESKOM location does.
      expect(await rtusUnder(pool, y, "RSMOC-WC"), "Y gets its RTUs").toBe(DOMAIN_COUNT);
      // Mutation: ensureEskomDomainRtus without the skip writes a second RTU
      // set under the renamed code, and the assets are rewired onto it.
      expect(await rtusUnder(pool, c, renamed), "no RTU under the admin's code").toBe(0);
      expect(await wiring(pool, c), "every asset keeps its rtu_id and telemetrySource").toEqual(before);
    });
  }, 60_000);

  it("R-decomm: a code PATCH on ESK-DECOMM-01, through seed.ts's order on two boots, leaves no RTU under it", async () => {
    await inEskomTransaction(async (pool, db) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND code = $2`,
        [eskomOrgId, DECOMMISSIONED_LOCATION_CODE],
      );
      const decomm = rows[0]?.id;
      assert(!!decomm, "ESK-DECOMM-01 must be seeded — run pnpm db:seed.");
      const patched = `F4169-${RUN_ID}-DC`;
      await pool.query(`UPDATE bms.locations SET code = $1 WHERE id = $2`, [patched, decomm]);
      // An ordinary admin location, for the adjacent positive below.
      const plainCode = `F4169-${RUN_ID}-PL`;
      const plain = await insertLocation(pool, {
        code: plainCode,
        slug: `f4169-${runId}-pl`,
        key: null,
        createdAt: new Date().toISOString(),
      });
      // Two boots of seed.ts's first ESKOM bracket, in its order.
      for (let boot = 0; boot < 2; boot += 1) {
        const outcomes = await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
        const decommissioned = await seedDecommissionedLocation(pool, pool, eskomOrgId, () => undefined);
        await ensureEskomDomainRtus(
          db,
          pool,
          locationIdsWithoutSeedCode([...outcomes.values(), decommissioned]),
        );
      }
      // Adjacent positive: the RTU step ran in this transaction.
      expect(await rtusUnder(pool, plain, plainCode), "the admin location gets its RTUs").toBe(DOMAIN_COUNT);
      // Mutation: the RTU step before ESK-DECOMM-01's restore (the order
      // before addendum 3) leaves a permanent RTU set under the admin's code.
      // seed.ts's own order is held by eskom-locations-seed.spec.ts's scan.
      expect(await rtusUnder(pool, decomm as string, patched), "no RTU under the admin's code").toBe(0);
    });
  }, 60_000);

  it("R-decomm-held: ESK-DECOMM-01 whose code an admin row holds gets no RTU under the admin's code", async () => {
    await inEskomTransaction(async (pool, db) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND code = $2`,
        [eskomOrgId, DECOMMISSIONED_LOCATION_CODE],
      );
      const decomm = rows[0]?.id;
      assert(!!decomm, "ESK-DECOMM-01 must be seeded — run pnpm db:seed.");
      const patched = `F4169-${RUN_ID}-DH`;
      await pool.query(`UPDATE bms.locations SET code = $1 WHERE id = $2`, [patched, decomm]);
      const holder = await insertLocation(pool, {
        code: DECOMMISSIONED_LOCATION_CODE,
        slug: `f4169-${runId}-dh`,
        key: null,
        createdAt: new Date().toISOString(),
      });
      const outcomes = await seedEskomLocations(pool, pool, seedMapRows, eskomOrgId, () => undefined);
      const decommissioned = await seedDecommissionedLocation(pool, pool, eskomOrgId, () => undefined);
      assert(decommissioned.id === decomm && !decommissioned.codeWritten, "ESK-DECOMM-01 adopted, code held");
      await ensureEskomDomainRtus(db, pool, locationIdsWithoutSeedCode([...outcomes.values(), decommissioned]));
      // Adjacent positive: the RTU step ran; the holder gets its own set.
      expect(await rtusUnder(pool, holder, DECOMMISSIONED_LOCATION_CODE), "the holder gets its RTUs").toBe(
        DOMAIN_COUNT,
      );
      // Mutation: ensureEskomDomainRtus without the skip writes RTUs under
      // the admin's code.
      expect(await rtusUnder(pool, decomm as string, patched)).toBe(0);
    });
  }, 60_000);
});
