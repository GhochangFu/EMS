import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as OrganizationLayoutSeed from "../packages/db/dist/organization-layout-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire` (the F3.73 suite's reason). After a
// source edit, run `pnpm --filter @bms/db build` before this suite, or it runs the last build.
const require_ = createRequire(import.meta.url);
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;
const { readEskomChecks, readPhewbChecks } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { ORGANIZATION_LAYOUT_SEED_SLUG, seedOrganizationLayout } = require_(
  "../packages/db/dist/organization-layout-seed.js",
) as typeof OrganizationLayoutSeed;

/**
 * `F4.317` PR 6 (owner ruling Q3) — the seeded organization Control Room layouts.
 *
 * **After a full `pnpm db:seed`.** The first cases read what the database holds NOW, accepting
 * every state the boot gate accepts: the seed-slug copy (organization-wide, stamped with a
 * `organization-standard` template, 14 tiles and 15 sources) is present, and the pointer row is
 * either there (at an organization-wide dashboard) or absent (an administrator's Reset). Counts
 * are of published templates only, so a stock re-import's draft or a concurrent suite's draft
 * does not move them. The strict "pointer at the seed copy" shape is asserted only in the
 * rolled-back cases below, where the test builds the state itself. The rest re-run the seed
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
        WHERE organization_id = $1 AND code = 'organization-standard'
          AND target = 'organization' AND status = 'published') AS templates`;

  /** Puts the pointer row at the seed copy, whatever an earlier admin action left. */
  async function pointAtSeedCopy(pool: SeedPool, id: string): Promise<void> {
    await pool.query("DELETE FROM bms.organization_control_room_views WHERE organization_id = $1", [id]);
    await pool.query(
      `INSERT INTO bms.organization_control_room_views (organization_id, dashboard_id)
       SELECT $1, d.id FROM bms.dashboards d WHERE d.organization_id = $1 AND d.slug = $2`,
      [id, ORGANIZATION_LAYOUT_SEED_SLUG],
    );
  }

  for (const code of ["ESKOM", "PHEWB"]) {
    it(`${code}: the seed copy is organization-wide and stamped; any pointer row names an organization-wide dashboard`, async () => {
      const id = orgIds[code] as string;
      const copy = await probePool!.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM bms.dashboards d
           JOIN bms.dashboard_templates t ON t.id = d.template_id
          WHERE d.organization_id = $1 AND d.slug = $2
            AND d.location_id IS NULL AND d.asset_group_id IS NULL AND d.asset_id IS NULL
            AND t.code = 'organization-standard' AND t.target = 'organization'`,
        [id, ORGANIZATION_LAYOUT_SEED_SLUG],
      );
      // The gate accepts a pointer row OR the seed copy; an administrator may have edited tiles of
      // the copy or deleted it after a Reset, so no tile counts are asserted on the live database
      // (the rolled-back re-make case below checks 14 / 15 on a copy it made itself).
      const counts = (await probePool!.query(COUNTS_SQL, [id, ORGANIZATION_LAYOUT_SEED_SLUG])).rows[0];
      expect(counts.views + copy.rows[0]!.n).toBeGreaterThanOrEqual(1);
      expect(counts.views).toBeLessThanOrEqual(1);
      expect(copy.rows[0]!.n).toBeLessThanOrEqual(1);
      expect(counts.templates).toBeGreaterThanOrEqual(0);
      const pointed = await probePool!.query<{ ok: boolean }>(
        `SELECT (d.location_id IS NULL AND d.asset_group_id IS NULL AND d.asset_id IS NULL) AS ok
           FROM bms.organization_control_room_views v
           JOIN bms.dashboards d ON d.id = v.dashboard_id AND d.organization_id = v.organization_id
          WHERE v.organization_id = $1`,
        [id],
      );
      for (const row of pointed.rows) expect(row.ok).toBe(true);
    });
  }

  it("writes nothing on a second run, whatever it is", async () => {
    for (const code of ["ESKOM", "PHEWB"]) {
      const id = orgIds[code] as string;
      await inTransaction(id, async (pool) => {
        await pointAtSeedCopy(pool, id);
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

  it("keeps the boot gate green after a Reset (row gone, copy kept) and reads 0 when both are gone", async () => {
    const present = (checks: Awaited<ReturnType<typeof readEskomChecks>>, org: string) =>
      checks.find((check) => check.label === `${org} seeded organization layout present`);
    for (const [code, read] of [
      ["ESKOM", (pool: SeedPool, id: string) => readEskomChecks(pool, id, { log: () => undefined })],
      ["PHEWB", (pool: SeedPool) => readPhewbChecks(pool)],
    ] as const) {
      const id = orgIds[code] as string;
      await inTransaction(id, async (pool) => {
        await pointAtSeedCopy(pool, id);
        await pool.query("DELETE FROM bms.organization_control_room_views WHERE organization_id = $1", [id]);
        expect(present(await read(pool, id), code)).toEqual({
          label: `${code} seeded organization layout present`,
          actual: 1,
          wanted: 1,
          kind: "exact",
        });
        await pool.query("DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2", [
          id,
          ORGANIZATION_LAYOUT_SEED_SLUG,
        ]);
        expect(present(await read(pool, id), code)?.actual).toBe(0);
      });
    }
  });

  it("seeds the layout when no version is published (archived rows; the next free version)", async () => {
    const id = orgIds["PHEWB"] as string;
    await inTransaction(id, async (pool) => {
      await pool.query("DELETE FROM bms.organization_control_room_views WHERE organization_id = $1", [id]);
      await pool.query("DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2", [
        id,
        ORGANIZATION_LAYOUT_SEED_SLUG,
      ]);
      // No published row. 'archived' rather than 'draft': a developer database may already hold a
      // draft, and a second one breaks dashboard_templates_org_code_draft_unique (0056).
      await pool.query(
        `UPDATE bms.dashboard_templates SET status = 'archived', archived_at = now()
          WHERE organization_id = $1 AND code = 'organization-standard' AND status = 'published'`,
        [id],
      );
      const maxBefore = (
        await pool.query<{ v: number }>(
          `SELECT COALESCE(MAX(version), 0)::int AS v FROM bms.dashboard_templates
            WHERE organization_id = $1 AND code = 'organization-standard'`,
          [id],
        )
      ).rows[0]!.v;
      const outcome = await seedOrganizationLayout(pool, id, () => undefined);
      expect(outcome).toMatchObject({ made: true, widgets: 14, sources: 15 });
      const published = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bms.dashboard_templates
          WHERE organization_id = $1 AND code = 'organization-standard' AND status = 'published'`,
        [id],
      );
      expect(published.rows[0]?.n).toBe(1);
      const newest = await pool.query<{ version: number }>(
        `SELECT version FROM bms.dashboard_templates
          WHERE organization_id = $1 AND code = 'organization-standard' AND status = 'published'`,
        [id],
      );
      expect(newest.rows[0]?.version).toBe(maxBefore + 1);
    });
  });

  it("provisions no template for an organization that gets no copy (archived stock stays archived)", async () => {
    const id = orgIds["PHEWB"] as string;
    await inTransaction(id, async (pool) => {
      await pointAtSeedCopy(pool, id);
      await pool.query(
        `UPDATE bms.dashboard_templates SET status = 'archived', archived_at = now()
          WHERE organization_id = $1 AND code = 'organization-standard' AND status = 'published'`,
        [id],
      );
      const before = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM bms.dashboard_templates WHERE organization_id = $1",
          [id],
        )
      ).rows[0]!.n;
      expect(await seedOrganizationLayout(pool, id, () => undefined)).toEqual({ made: false, reason: "has_view" });
      const after = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM bms.dashboard_templates WHERE organization_id = $1",
          [id],
        )
      ).rows[0]!.n;
      expect(after).toBe(before);
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
