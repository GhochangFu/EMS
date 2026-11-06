import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as SharedSiteTemplates from "../packages/shared/dist/site-templates.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as SiteLayoutSeed from "../packages/db/dist/site-layout-seed.js";
import type * as SiteLayoutSeedMove from "../packages/db/dist/site-layout-seed-move.js";
import { requireIntegrationDb } from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist`, the `f3.73-site-layout-seed` way: run `pnpm --filter @bms/db
// build` after a source edit, or this suite runs the last build.
const require_ = createRequire(import.meta.url);
const { loadPheCatalog } = require_("../packages/db/dist/phe-pilot-seed.js") as typeof PhePilotSeed;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;
const {
  ensureSiteTemplate,
  pheSiteLayoutStations,
  resolvePhewbSiteLayoutLocations,
  seedSiteLayouts,
  SITE_LAYOUT_PHEWB_CHOICE,
  SITE_LAYOUT_PHEWB_PUMP_STATION_CHOICE,
} = require_("../packages/db/dist/site-layout-seed.js") as typeof SiteLayoutSeed;
const { PUMP_STATION_STANDARD_SITE_TEMPLATE } = require_(
  "../packages/shared/dist/site-templates.js",
) as typeof SharedSiteTemplates;
const { moveUntouchedPheCopies } = require_("../packages/db/dist/site-layout-seed-move.js") as typeof SiteLayoutSeedMove;

/**
 * `F4.319` (ADR 0113 decision 8, plan D5–D6) — the seed moves an untouched PHEWB `smoc-standard`
 * copy to `pump-station-standard` in place, and leaves an edited copy and a removed copy alone.
 *
 * A fresh CI seed already makes the PHE copies from `pump-station-standard` (plan D7), so each
 * case first rewinds one station to the state a pre-ADR-0113 database holds: its copy and view
 * row deleted, then a `smoc-standard` copy made by the real `seedSiteLayouts`. Every case is one
 * `BEGIN` … `ROLLBACK` on the seed pool (`bms_owner`, PHEWB's tenant GUC). Nothing commits.
 */
const ownerUrl = requireIntegrationDb({
  item: "F4.319",
  label: "the pump-station site-layout move",
  because:
    "which copies move, and that an edited or removed one stays, are database reads and writes " +
    "under row-level security that only a seeded database answers.",
  connection: "owner",
});

type SeedPool = ReturnType<typeof createSeedPool>;
type Templates = { smoc: NonNullable<Awaited<ReturnType<typeof ensureSiteTemplate>>>; station: NonNullable<Awaited<ReturnType<typeof ensureSiteTemplate>>> };

describe.skipIf(!ownerUrl)("F4.319 — the seed moves the untouched PHE copies to pump-station-standard", { timeout: 60_000 }, () => {
  let pool: SeedPool | undefined;
  let phewbOrgId = "";

  beforeAll(async () => {
    pool = createSeedPool(ownerUrl as string);
    const org = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'PHEWB'`);
    phewbOrgId = org.rows[0]?.id ?? "";
    if (phewbOrgId === "") throw new Error("F4.319: run pnpm db:seed first");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  async function inTransaction(body: (p: SeedPool, t: Templates, locationId: string) => Promise<void>): Promise<void> {
    const p = pool as SeedPool;
    await p.query("BEGIN");
    try {
      await p.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      // The f3.73 suites rewrite site-layout copies too; one case at a time across them.
      await p.query("SELECT pg_advisory_xact_lock(hashtext('site-layout seed suites'))");
      await p.query("SET LOCAL lock_timeout = '5s'");
      const smoc = await ensureSiteTemplate(p, phewbOrgId);
      const station = await ensureSiteTemplate(p, phewbOrgId, PUMP_STATION_STANDARD_SITE_TEMPLATE);
      if (smoc === null || station === null) throw new Error("F4.319: both templates must be published");
      const [locationId] = await resolvePhewbSiteLayoutLocations(p, phewbOrgId, pheSiteLayoutStations(loadPheCatalog()));
      if (locationId === undefined) throw new Error("F4.319: no PHE station resolved");
      // Rewind: the station holds a smoc-standard copy, as before ADR 0113.
      await p.query(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [locationId]);
      await p.query(`DELETE FROM bms.dashboards WHERE location_id = $1 AND slug LIKE 'site-layout-%'`, [locationId]);
      const made = await seedSiteLayouts(p, phewbOrgId, {
        template: smoc,
        locationIds: [locationId],
        choiceByGroupCode: SITE_LAYOUT_PHEWB_CHOICE,
        log: () => {},
      });
      expect(made.made).toHaveLength(1);
      await body(p, { smoc, station }, locationId);
    } finally {
      await p.query("ROLLBACK");
    }
  }

  const move = (p: SeedPool, t: Templates, locationId: string) =>
    moveUntouchedPheCopies(p, phewbOrgId, {
      from: t.smoc,
      to: t.station,
      locationIds: [locationId],
      fromChoice: SITE_LAYOUT_PHEWB_CHOICE,
      toChoice: SITE_LAYOUT_PHEWB_PUMP_STATION_CHOICE,
      log: () => {},
    });

  const copyOf = async (p: SeedPool, locationId: string) =>
    (
      await p.query<{ id: string; code: string; tabs: string }>(
        `SELECT d.id, t.code,
                (SELECT string_agg(tab.tab_key || ':' || COALESCE(g.code, '-'), ',' ORDER BY tab.sort_order)
                   FROM bms.dashboard_tabs tab LEFT JOIN bms.asset_groups g ON g.id = tab.asset_group_id
                  WHERE tab.dashboard_id = d.id) AS tabs
           FROM bms.dashboards d JOIN bms.dashboard_templates t ON t.id = d.template_id
          WHERE d.location_id = $1 AND d.slug LIKE 'site-layout-%'`,
        [locationId],
      )
    ).rows[0];

  it("moves an untouched copy in place: same dashboard, pump-station-standard, the Overview on pump-station", async () => {
    await inTransaction(async (p, t, locationId) => {
      const before = await copyOf(p, locationId);
      expect(before?.code).toBe("smoc-standard");
      const outcome = await move(p, t, locationId);
      expect(outcome.moved).toEqual([{ locationId, dashboardId: before?.id }]);
      const after = await copyOf(p, locationId);
      expect(after?.id).toBe(before?.id);
      expect(after?.code).toBe("pump-station-standard");
      expect(after?.tabs).toBe("overview:pump-station,electrical:electrical,env:environment");
      const view = await p.query<{ dashboard_id: string }>(
        `SELECT dashboard_id FROM bms.site_control_room_views WHERE location_id = $1`,
        [locationId],
      );
      expect(view.rows[0]?.dashboard_id).toBe(before?.id);
      // A second run reads it as no longer smoc-standard and writes nothing.
      const again = await move(p, t, locationId);
      expect(again.moved).toEqual([]);
      expect(again.stayed).toEqual([{ locationId, reason: "not_smoc_standard" }]);
    });
  });

  it("leaves a copy with one moved widget on smoc-standard", async () => {
    await inTransaction(async (p, t, locationId) => {
      const before = await copyOf(p, locationId);
      const moved = await p.query(
        `UPDATE bms.dashboard_widgets SET grid_x = grid_x + 1
          WHERE id = (SELECT id FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND grid_x + grid_w < 12 ORDER BY id LIMIT 1)`,
        [before?.id],
      );
      expect(moved.rowCount).toBe(1);
      const outcome = await move(p, t, locationId);
      expect(outcome.moved).toEqual([]);
      expect(outcome.stayed).toEqual([{ locationId, reason: "edited" }]);
      expect((await copyOf(p, locationId))?.code).toBe("smoc-standard");
    });
  });

  it("leaves a renamed copy on smoc-standard", async () => {
    await inTransaction(async (p, t, locationId) => {
      const before = await copyOf(p, locationId);
      await p.query(`UPDATE bms.dashboards SET name = 'Our layout' WHERE id = $1`, [before?.id]);
      const outcome = await move(p, t, locationId);
      expect(outcome.stayed).toEqual([{ locationId, reason: "edited" }]);
    });
  });

  it("leaves a removed copy removed", async () => {
    await inTransaction(async (p, t, locationId) => {
      const before = await copyOf(p, locationId);
      await p.query(`DELETE FROM bms.dashboards WHERE id = $1`, [before?.id]);
      const outcome = await move(p, t, locationId);
      expect(outcome.stayed).toEqual([{ locationId, reason: "no_copy" }]);
      const view = await p.query<{ kind: string; dashboard_id: string | null }>(
        `SELECT kind, dashboard_id FROM bms.site_control_room_views WHERE location_id = $1`,
        [locationId],
      );
      expect(view.rows[0]).toEqual({ kind: "dashboard", dashboard_id: null });
    });
  });
});
