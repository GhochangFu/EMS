import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as OrganizationLayoutSeed from "../packages/db/dist/organization-layout-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire` (the F3.73 suite's reason). After a
// source edit, run `pnpm --filter @bms/db build` before this suite, or it runs the last build.
const require_ = createRequire(import.meta.url);
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;
const { ORGANIZATION_LAYOUT_SEED_SLUG, seedOrganizationLayout } = require_(
  "../packages/db/dist/organization-layout-seed.js",
) as typeof OrganizationLayoutSeed;

/**
 * `F4.317` PR 6 (owner ruling Q3) — the seeded organization Control Room layouts.
 *
 * **After a full `pnpm db:seed`.** The first cases read what the seed left: for ESKOM and PHEWB
 * one pointer row, at a seed-slug copy that is organization-wide, stamped with the
 * `organization-standard` template, with its 14 tiles and 15 sources. The rest re-run the seed
 * function against a changed database inside one `BEGIN` ... `ROLLBACK` on the seed pool's one
 * connection (as `bms_owner`, under the organization's GUC), because a single seed pass only
 * ever takes the insert branch. No case calls `withOrganization`, which commits.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.317",
  label: "the seeded organization layouts",
  because:
    "which organizations the seed gives a layout, and that a re-seed never replaces, duplicates or " +
    "re-points one, are database behaviours under row-level security across two seed passes.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;

describe.skipIf(!ownerUrl)("F4.317 Q3 - the seeded organization layouts", { timeout: 60_000 }, () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  const orgIds: Record<string, string> = {};

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.317");
    seedPool = createSeedPool(url);
    const orgs = await probePool.query<{ code: string; id: string }>(
      `SELECT code, id FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    for (const row of orgs.rows) orgIds[row.code] = row.id;
    expect(Object.keys(orgIds).sort(), "run pnpm db:seed first").toEqual(["ESKOM", "PHEWB"]);
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  async function inTransaction(organizationId: string, body: (pool: SeedPool) => Promise<void>): Promise<void> {
    if (!seedPool) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [organizationId]);
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await body(pool);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  const COUNTS_SQL = `
    SELECT
      (SELECT count(*)::int FROM bms.organization_control_room_views WHERE organization_id = $1) AS views,
      (SELECT count(*)::int FROM bms.dashboards WHERE organization_id = $1 AND slug = $2) AS copies,
      (SELECT count(*)::int FROM bms.dashboard_widgets w JOIN bms.dashboards d ON d.id = w.dashboard_id
        WHERE d.organization_id = $1 AND d.slug = $2) AS widgets,
      (SELECT count(*)::int FROM bms.dashboard_widget_sources s JOIN bms.dashboard_widgets w ON w.id = s.widget_id
        JOIN bms.dashboards d ON d.id = w.dashboard_id WHERE d.organization_id = $1 AND d.slug = $2) AS sources,
      (SELECT count(*)::int FROM bms.dashboard_templates
        WHERE organization_id = $1 AND code = 'organization-standard') AS templates`;

  for (const code of ["ESKOM", "PHEWB"]) {
    it(`${code}: one pointer row at the organization-wide seed copy, stamped with organization-standard`, async () => {
      const id = orgIds[code] as string;
      const res = await probePool!.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM bms.organization_control_room_views v
           JOIN bms.dashboards d ON d.id = v.dashboard_id AND d.organization_id = v.organization_id
           JOIN bms.dashboard_templates t ON t.id = d.template_id
          WHERE v.organization_id = $1 AND d.slug = $2
            AND d.location_id IS NULL AND d.asset_group_id IS NULL AND d.asset_id IS NULL
            AND t.code = 'organization-standard' AND t.target = 'organization' AND t.status = 'published'`,
        [id, ORGANIZATION_LAYOUT_SEED_SLUG],
      );
      expect(res.rows[0]?.n).toBe(1);
      const counts = (await probePool!.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0];
      expect(counts).toMatchObject({ views: 1, copies: 1, widgets: 14, sources: 15, templates: 1 });
    });
  }

  it("writes nothing on a second run, whatever it is", async () => {
    for (const code of ["ESKOM", "PHEWB"]) {
      const id = orgIds[code] as string;
      await inTransaction(id, async (pool) => {
        const before = (await pool.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0];
        const outcome = await seedOrganizationLayout(pool, id, () => undefined);
        expect(outcome).toEqual({ made: false, reason: "has_view" });
        expect((await pool.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0]).toEqual(before);
      });
    }
  });

  it("does not re-point an organization an administrator reset (row deleted, copy kept)", async () => {
    const id = orgIds["ESKOM"] as string;
    await inTransaction(id, async (pool) => {
      await pool.query("DELETE FROM bms.organization_control_room_views WHERE organization_id = $1", [id]);
      const outcome = await seedOrganizationLayout(pool, id, () => undefined);
      expect(outcome).toEqual({ made: false, reason: "slug_taken" });
      const counts = (await pool.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0];
      expect(counts).toMatchObject({ views: 0, copies: 1 });
    });
  });

  it("re-makes the layout when the row and the copy are both gone, once", async () => {
    const id = orgIds["PHEWB"] as string;
    await inTransaction(id, async (pool) => {
      await pool.query("DELETE FROM bms.organization_control_room_views WHERE organization_id = $1", [id]);
      await pool.query("DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2", [
        id,
        ORGANIZATION_LAYOUT_SEED_SLUG,
      ]);
      const outcome = await seedOrganizationLayout(pool, id, () => undefined);
      expect(outcome).toMatchObject({ made: true, widgets: 14, sources: 15 });
      expect((await pool.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0]).toMatchObject({
        views: 1,
        copies: 1,
        widgets: 14,
        sources: 15,
        templates: 1,
      });
      expect(await seedOrganizationLayout(pool, id, () => undefined)).toEqual({ made: false, reason: "has_view" });
    });
  });

  it("leaves an administrator's pointer row alone, whatever it points at (including NULL)", async () => {
    const id = orgIds["PHEWB"] as string;
    await inTransaction(id, async (pool) => {
      await pool.query("UPDATE bms.organization_control_room_views SET dashboard_id = NULL WHERE organization_id = $1", [id]);
      expect(await seedOrganizationLayout(pool, id, () => undefined)).toEqual({ made: false, reason: "has_view" });
      const row = await pool.query<{ dashboard_id: string | null }>(
        "SELECT dashboard_id FROM bms.organization_control_room_views WHERE organization_id = $1",
        [id],
      );
      expect(row.rows[0]?.dashboard_id).toBeNull();
    });
  });
});
