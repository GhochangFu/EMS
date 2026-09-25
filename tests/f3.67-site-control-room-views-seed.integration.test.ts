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
  resolveIntegrationRoleUrl,
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
 * by seeding twice against a real `bms.site_control_room_views`.
 *
 * **Two pools, two roles.** The seed runs on a `max: 1` pool as `bms_owner` —
 * the role `pnpm db:seed` uses, bound by `FORCE ROW LEVEL SECURITY` — so the
 * seed's insert meets migration `0082`'s `WITH CHECK` half under the ESKOM
 * tenant GUC, exactly as a real seed does (`beforeAll` asserts the role). Reads
 * run on a `bms_fleet` probe pool, which sees the row whatever the GUC.
 *
 * `RSMOC-WC` is the one real, shared, seeded location this touches — not a
 * `F367-%` per-run fixture, because the row under test is the seed's own row,
 * not something this suite creates. **The suite leaves the row as it found
 * it**: `beforeAll` captures every column (or the row's absence), `afterAll`
 * puts that back, and test 1, which deletes the row, restores its own capture
 * in a `finally`. The neighbouring `site-control-room-view.integration.*`
 * suite only ever reads `RSMOC-WC`, never writes it.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.67 U6",
  label: "seed ownership of the RSMOC-WC control room view",
  because:
    "whether a second pnpm db:seed reverts an admin's own choice of kind is a database " +
    "behaviour across two seed passes under real row-level security, so a green run " +
    "without one asserts nothing.",
  connection: "owner",
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

/** Every column but the key, so a restore puts back exactly what was there. */
type ViewRow = {
  organization_id: string;
  kind: string;
  builtin_key: string | null;
  dashboard_id: string | null;
  /** `::text`, not a `Date`: node-pg's `Date` drops the microseconds, and the restore is exact. */
  updated_at: string;
  updated_by: string | null;
};

/** What the suite found in `beforeAll` — `undefined` when RSMOC-WC had no row. */
let found: ViewRow | undefined;

/** Reads the row as `bms_fleet`: under FORCE an owner read depends on the GUC, the fleet read does not. */
async function readView(): Promise<ViewRow | undefined> {
  const pool = probePool;
  if (!pool) throw new Error("probe pool not initialised");
  const res = await pool.query<ViewRow>(
    `SELECT organization_id, kind, builtin_key, dashboard_id, updated_at::text AS updated_at, updated_by
       FROM bms.site_control_room_views WHERE location_id = $1`,
    [rsmocWcId],
  );
  return res.rows[0];
}

/** Runs one statement on the seed pool as `bms_owner` under the ESKOM tenant GUC. */
async function asOwner(sql: string, params: unknown[]): Promise<void> {
  const pool = seedPool;
  if (!pool) throw new Error("seed pool not initialised");
  await withOrganization(pool, eskomOrgId, async () => {
    await pool.query(sql, params);
  });
}

/** What the API's `putSetting` does for a `generated` write: overwrite every kind-decided column. */
async function adminSetsGenerated(): Promise<void> {
  await asOwner(
    `UPDATE bms.site_control_room_views
        SET kind = 'generated', builtin_key = NULL, dashboard_id = NULL, updated_at = now()
      WHERE location_id = $1`,
    [rsmocWcId],
  );
}

async function reseedView(): Promise<void> {
  const pool = seedPool;
  const db = seedDb;
  if (!pool || !db) throw new Error("seed pool not initialised");
  await withOrganization(pool, eskomOrgId, () => seedSiteControlRoomViews(db, eskomOrgId));
}

/** Sets the row to what a fresh `pnpm db:seed` leaves, `builtin`/`smoc` — tests 2 and 3 start there. */
async function forceBuiltin(): Promise<void> {
  await asOwner(
    `UPDATE bms.site_control_room_views
        SET kind = 'builtin', builtin_key = 'smoc', dashboard_id = NULL, updated_at = now()
      WHERE location_id = $1`,
    [rsmocWcId],
  );
}

/** Puts back a captured row, every column; a capture of "no row" deletes the row. */
async function restoreRow(row: ViewRow | undefined): Promise<void> {
  if (!row) {
    await asOwner(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [rsmocWcId]);
    return;
  }
  await asOwner(
    `INSERT INTO bms.site_control_room_views
            (location_id, organization_id, kind, builtin_key, dashboard_id, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
     ON CONFLICT (location_id) DO UPDATE
        SET organization_id = EXCLUDED.organization_id, kind = EXCLUDED.kind,
            builtin_key = EXCLUDED.builtin_key, dashboard_id = EXCLUDED.dashboard_id,
            updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [
      rsmocWcId,
      row.organization_id,
      row.kind,
      row.builtin_key,
      row.dashboard_id,
      row.updated_at,
      row.updated_by,
    ],
  );
}

describe.skipIf(!ownerUrl)("F3.67 U6 — seedSiteControlRoomViews ownership across two passes", () => {
  beforeAll(async () => {
    const url = ownerUrl as string;
    // A plain fleet pool to resolve ids and read the row — the seed's own
    // `max: 1` pool is reserved for statements that must land inside
    // `withOrganization`'s transaction (`seed-tenant.ts`'s load-bearing constraint).
    probePool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "fleet", process.env),
      "F3.67 U6",
    );
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);

    const role = await seedPool.query<{ current_user: string }>("SELECT current_user");
    assert(
      role.rows[0]?.current_user === "bms_owner",
      `the seed pool must run as bms_owner (the pnpm db:seed role), got '${role.rows[0]?.current_user}'`,
    );

    eskomOrgId = await getOrganizationId(probePool, "ESKOM");

    const rsmoc = await probePool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`,
    );
    if (!rsmoc.rows[0]) throw new Error("F3.67 U6: RSMOC-WC is not seeded — run pnpm db:seed.");
    rsmocWcId = rsmoc.rows[0].id;

    found = await readView();

    // Known starting state for tests 2 and 3 — the F1.7 lesson (clear the
    // stamp first). `reseedView` first: on a scratch database that has never
    // run U6's seed call, no row exists yet and the UPDATE would match zero.
    await reseedView();
    await forceBuiltin();
  }, 120_000);

  afterAll(async () => {
    if (seedPool && rsmocWcId) {
      await restoreRow(found);
    }
    await seedPool?.end();
    await probePool?.end();
  }, 120_000);

  it("inserts builtin/smoc for RSMOC-WC when the row is absent", async () => {
    const captured = await readView();
    try {
      await asOwner(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [rsmocWcId]);
      assert((await readView()) === undefined, "the fixture delete must have removed the row");

      await reseedView();

      // Read back what the SEED wrote: the row did not exist before it ran.
      const row = await readView();
      assert(row !== undefined, "expected the seed to insert a bms.site_control_room_views row for RSMOC-WC");
      assert(row?.kind === "builtin", `expected kind 'builtin', got '${row?.kind}'`);
      assert(row?.builtin_key === "smoc", `expected builtin_key 'smoc', got '${row?.builtin_key}'`);
    } finally {
      await restoreRow(captured);
    }
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
