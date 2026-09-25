import { afterAll, beforeAll, describe, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import { createDb } from "../packages/db/src/client.js";
import { getOrganizationId } from "../packages/db/src/hierarchy-seed.js";
import { createSeedPool, withOrganization } from "../packages/db/src/seed-tenant.js";
import { seedSiteControlRoomViews } from "../packages/db/src/site-control-room-views-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.67` U6 — the seed asserts RSMOC-WC's Control Room view exists once,
 * then the operator (or the admin, through the API) owns what it holds.
 *
 * **This exists because a unit test cannot gate what matters here** — the
 * `F1.7` precedent (`tests/f1.7-seed-ownership.integration.test.ts`). A single
 * `pnpm db:seed` pass on a fresh database only ever exercises the
 * insert-if-absent branch; a re-seed after the row already carries an admin's
 * own choice is the branch owner ruling OQ2 is about, and it is reachable only
 * by seeding twice against a real, RLS-bound `bms.site_control_room_views`.
 *
 * `RSMOC-WC` is the one real, shared, seeded location this touches — not a
 * `F367-%` per-run fixture, because the row under test is the seed's own row,
 * not something this suite creates. Every case restores it to `builtin`/`smoc`
 * afterward, the same discipline `F1.7` uses for `ingest_enabled`, so a
 * developer database and the neighbouring `site-control-room-view.integration.*`
 * suite (which only ever reads `RSMOC-WC`, never writes it) are left as found.
 */

const connectionString = requireIntegrationDb({
  item: "F3.67 U6",
  label: "seed ownership of the RSMOC-WC control room view",
  because:
    "whether a second pnpm db:seed reverts an admin's own choice of kind is a database " +
    "behaviour across two seed passes under real row-level security, so a green run " +
    "without one asserts nothing.",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

let probePool: IntegrationPool | undefined;
let seedPool: ReturnType<typeof createSeedPool> | undefined;
let seedDb: ReturnType<typeof createDb> | undefined;
let eskomOrgId = "";
let rsmocWcId = "";

type ViewRow = { kind: string; builtin_key: string | null; dashboard_id: string | null };

/** Reads the row as `bms_owner` under the ESKOM tenant GUC — the same lens the seed itself uses. */
async function readView(): Promise<ViewRow | undefined> {
  const pool = seedPool;
  if (!pool) throw new Error("seed pool not initialised");
  return withOrganization(pool, eskomOrgId, async () => {
    const res = await pool.query<ViewRow>(
      `SELECT kind, builtin_key, dashboard_id FROM bms.site_control_room_views WHERE location_id = $1`,
      [rsmocWcId],
    );
    return res.rows[0];
  });
}

/** What the API's `putSetting` does for a `generated` write: overwrite every kind-decided column. */
async function adminSetsGenerated(): Promise<void> {
  const pool = seedPool;
  if (!pool) throw new Error("seed pool not initialised");
  await withOrganization(pool, eskomOrgId, async () => {
    await pool.query(
      `UPDATE bms.site_control_room_views
         SET kind = 'generated', builtin_key = NULL, dashboard_id = NULL, updated_at = now()
       WHERE location_id = $1`,
      [rsmocWcId],
    );
  });
}

async function reseedView(): Promise<void> {
  const pool = seedPool;
  const db = seedDb;
  if (!pool || !db) throw new Error("seed pool not initialised");
  await withOrganization(pool, eskomOrgId, () => seedSiteControlRoomViews(db, eskomOrgId));
}

/** Restores the row to what a fresh `pnpm db:seed` leaves: `builtin`/`smoc`. */
async function restoreBuiltin(): Promise<void> {
  const pool = seedPool;
  if (!pool) throw new Error("seed pool not initialised");
  await withOrganization(pool, eskomOrgId, async () => {
    await pool.query(
      `UPDATE bms.site_control_room_views
         SET kind = 'builtin', builtin_key = 'smoc', dashboard_id = NULL, updated_at = now()
       WHERE location_id = $1`,
      [rsmocWcId],
    );
  });
}

describe.skipIf(!connectionString)("F3.67 U6 — seedSiteControlRoomViews ownership across two passes", () => {
  beforeAll(async () => {
    const url = connectionString as string;
    // A plain fleet pool to resolve ids — the seed's own `max: 1` pool is
    // reserved for statements that must land inside `withOrganization`'s
    // transaction (`seed-tenant.ts`'s load-bearing constraint).
    probePool = await openIntegrationPool(url, "F3.67 U6");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);

    eskomOrgId = await getOrganizationId(probePool, "ESKOM");

    const rsmoc = await probePool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`,
    );
    if (!rsmoc.rows[0]) throw new Error("F3.67 U6: RSMOC-WC is not seeded — run pnpm db:seed.");
    rsmocWcId = rsmoc.rows[0].id;

    // Known starting state, so the suite is not at the mercy of what an
    // earlier run left behind — the same F1.7 lesson (clear the stamp first).
    // `reseedView` first: on a scratch database that has never run U6's seed
    // call, no row exists yet and `restoreBuiltin`'s UPDATE would match zero.
    await reseedView();
    await restoreBuiltin();
  }, 120_000);

  afterAll(async () => {
    await restoreBuiltin();
    await seedPool?.end();
    await probePool?.end();
  }, 120_000);

  it("inserts builtin/smoc for RSMOC-WC when no row's contents have been touched", async () => {
    // The row already exists (restored in beforeAll); a re-seed over an
    // untouched row must still read builtin/smoc, or the insert-if-absent
    // behaviour itself is broken.
    await reseedView();
    const row = await readView();
    assert(row !== undefined, "expected a bms.site_control_room_views row for RSMOC-WC");
    assert(row?.kind === "builtin", `expected kind 'builtin', got '${row?.kind}'`);
    assert(row?.builtin_key === "smoc", `expected builtin_key 'smoc', got '${row?.builtin_key}'`);
  }, 120_000);

  it("does not revert an admin's own choice of kind on a re-seed (owner ruling OQ2)", async () => {
    const before = await readView();
    assert(before?.kind === "builtin", `fixture must start builtin, got '${before?.kind}'`);

    await adminSetsGenerated();
    const afterAdmin = await readView();
    assert(afterAdmin?.kind === "generated", "the admin write must have landed");

    await reseedView();

    // The defect this test exists to catch: `onConflictDoUpdate` here would
    // silently put the row back to `builtin`/`smoc` on every `pnpm db:seed`,
    // the exact class of bug F1.7 closed for `ingest_enabled`.
    const after = await readView();
    assert(
      after?.kind === "generated",
      `a re-seed must NOT revert an admin's choice; expected 'generated', got '${after?.kind}'`,
    );
    assert(after?.builtin_key === null, `expected builtin_key null, got '${after?.builtin_key}'`);
  }, 120_000);

  it("stays idempotent across two immediate seed passes with no admin write between them", async () => {
    await reseedView();
    const first = await readView();
    await reseedView();
    const second = await readView();

    assert(
      first?.kind === second?.kind &&
        first?.builtin_key === second?.builtin_key &&
        first?.dashboard_id === second?.dashboard_id,
      "two immediate re-seeds with no write between them must leave the row unchanged",
    );
  }, 120_000);
});
