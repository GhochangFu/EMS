import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as SiteLayoutSeed from "../packages/db/dist/site-layout-seed.js";
import type * as SiteLayoutSeedUpgrade from "../packages/db/dist/site-layout-seed-upgrade.js";
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
const { seedMapLocationRows } = require_(
  "../packages/db/dist/eskom-locations-seed.js",
) as typeof EskomLocationsSeed;
const { loadPheCatalog } = require_("../packages/db/dist/phe-pilot-seed.js") as typeof PhePilotSeed;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;
const {
  pheSiteLayoutStations,
  resolvePhewbSiteLayoutLocations,
  seedEskomSiteLayouts,
  SITE_LAYOUT_SLUG_PREFIX,
  siteLayoutSlug,
} = require_("../packages/db/dist/site-layout-seed.js") as typeof SiteLayoutSeed;
const {
  SITE_LAYOUT_COPY_DESCRIPTION,
  SITE_LAYOUT_COPY_DESCRIPTION_V1,
  SMOC_STANDARD_CURRENT_RECTS,
  SMOC_STANDARD_V1_RECTS,
  siteWidgetIdentity,
  smocStandardV1Content,
  upgradeSeededSiteLayoutCopies,
  upgradeSeedSiteTemplate,
} = require_("../packages/db/dist/site-layout-seed-upgrade.js") as typeof SiteLayoutSeedUpgrade;
const { readEskomChecks } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;

/**
 * `F3.73` plan D12 — the SMOC standard site layout on the seed-owned demo sites.
 *
 * **After a full `pnpm db:seed`.** The first five cases read what the seed left: seven copies
 * (CSMOC Gauteng and the six PHE stations), none at RSMOC-WC, and the tabs each shape of site
 * gets. The rest re-run a seed function against a changed database, the `F1.7` precedent: a
 * single seed pass only ever takes the insert branch.
 *
 * **Every changing case is one `BEGIN` … `ROLLBACK`** on the seed pool's one connection, in the
 * organization's tenant context as `bms_owner` (the role `pnpm db:seed` runs as, bound by FORCE
 * ROW LEVEL SECURITY). No case calls `withOrganization`, which commits. Reads of the seeded
 * state run on a `bms_fleet` probe pool.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.73",
  label: "the seeded SMOC standard site layouts",
  because:
    "which sites the seed copies the layout onto, and that a re-seed never replaces or " +
    "duplicates one, are database behaviours under row-level security across two seed passes.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;

const runId = randomUUID().slice(0, 8);
const RUN_ID = runId.toUpperCase();
const mapRows = seedMapLocationRows(loadPheCatalog());
const pheSlugs = pheSiteLayoutStations(loadPheCatalog()).map((station) => station.slug);
const CSMOC_SLUG = siteLayoutSlug("csmoc-gauteng");

describe.skipIf(!ownerUrl)("F3.73 D12 — the seeded SMOC standard site layouts", () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";
  let phewbOrgId = "";
  let csmocId = "";
  let rsmocWcId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F3.73");
    seedPool = createSeedPool(url);
    const role = await seedPool.query<{ current_user: string }>("SELECT current_user");
    assert(role.rows[0]?.current_user === "bms_owner", "the seed pool must run as bms_owner");
    const orgs = await probePool.query<{ code: string; id: string }>(
      `SELECT code, id FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    const locations = await probePool.query<{ key: string; id: string }>(
      `SELECT meta->>'seedKey' AS key, id FROM bms.locations
        WHERE meta->>'seedKey' IN ('csmoc-gauteng', 'rsmoc-western-cape')`,
    );
    csmocId = locations.rows.find((row) => row.key === "csmoc-gauteng")?.id ?? "";
    rsmocWcId = locations.rows.find((row) => row.key === "rsmoc-western-cape")?.id ?? "";
    assert(eskomOrgId !== "" && phewbOrgId !== "" && csmocId !== "" && rsmocWcId !== "", "run pnpm db:seed first");
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

  /** `tab_key:group code` in sort order ('-' for no group), read on the given pool. */
  async function tabsOf(
    pool: Pick<SeedPool, "query">,
    organizationId: string,
    slug: string,
  ): Promise<string[]> {
    const res = await pool.query<{ tab: string }>(
      `SELECT t.tab_key || ':' || COALESCE(g.code, '-') AS tab
         FROM bms.dashboard_tabs t
         JOIN bms.dashboards d ON d.id = t.dashboard_id
         LEFT JOIN bms.asset_groups g ON g.id = t.asset_group_id
        WHERE d.organization_id = $1 AND d.slug = $2
        ORDER BY t.sort_order`,
      [organizationId, slug],
    );
    return res.rows.map((row) => row.tab);
  }

  /** The seed-owned copies: slug `site-layout-<location slug>` at CSMOC or a catalog station. */
  const SEEDED_COPIES_SQL = `
    FROM bms.dashboards d
    JOIN bms.locations l ON l.id = d.location_id
    JOIN bms.dashboard_templates t ON t.id = d.template_id
   WHERE d.slug = 'site-layout-' || l.slug
     AND t.code = 'smoc-standard' AND t.target = 'site'
     AND (l.id = $1 OR l.slug = ANY($2::varchar[]))`;

  it("made seven copies, each stamped with the smoc-standard site template", async () => {
    const res = await probePool!.query<{ n: number }>(`SELECT count(*)::int AS n ${SEEDED_COPIES_SQL}`, [
      csmocId,
      pheSlugs,
    ]);
    expect(pheSlugs).toHaveLength(6);
    expect(res.rows[0]?.n).toBe(7);
  });

  it("points each copy's site view at it, kind dashboard", async () => {
    const res = await probePool!.query<{ n: number }>(
      `SELECT count(*)::int AS n ${SEEDED_COPIES_SQL}
         AND EXISTS (SELECT 1 FROM bms.site_control_room_views v
                      WHERE v.location_id = l.id AND v.kind = 'dashboard' AND v.dashboard_id = d.id)`,
      [csmocId, pheSlugs],
    );
    expect(res.rows[0]?.n).toBe(7);
  });

  // The copy count only, not the view row's kind: `f3.67-site-control-room-views-seed` commits
  // writes to RSMOC-WC's view row while it runs, and CI runs the two files in parallel.
  it("makes no copy at RSMOC-WC", async () => {
    const copies = await probePool!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bms.dashboards WHERE location_id = $1 AND slug LIKE 'site-layout-%'`,
      [rsmocWcId],
    );
    expect(copies.rows[0]?.n).toBe(0);
  });

  it("gives each PHE station the tabs overview, sld and env, exactly", async () => {
    for (const slug of pheSlugs) {
      expect(await tabsOf(probePool!, phewbOrgId, siteLayoutSlug(slug)), slug).toEqual([
        "overview:-",
        "sld:electrical",
        "env:environment",
      ]);
    }
  });

  it("gives CSMOC Gauteng overview, sld, ups, hvac and water, its water tab on the water group", async () => {
    expect(await tabsOf(probePool!, eskomOrgId, CSMOC_SLUG)).toEqual([
      "overview:-",
      "sld:electrical",
      "ups:ups-battery",
      "hvac:hvac",
      "water:water",
    ]);
  });

  it("writes no row on a second run", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      // Only the rows the seed owns: another suite may commit a view row or a tab meanwhile.
      const count = async (): Promise<string> =>
        (
          await pool.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM bms.dashboards WHERE slug LIKE 'site-layout-%')::text || '/' ||
                    (SELECT count(*) FROM bms.dashboard_tabs t
                       JOIN bms.dashboards d ON d.id = t.dashboard_id
                      WHERE d.slug LIKE 'site-layout-%')::text || '/' ||
                    (SELECT count(*) FROM bms.site_control_room_views WHERE location_id = $1)::text AS n`,
            [csmocId],
          )
        ).rows[0]?.n ?? "";
      const before = await count();
      const outcome = await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(outcome.made).toEqual([]);
      expect(await count()).toBe(before);
    });
  });

  it("keeps a renamed copy's name on a second run", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await pool.query(`UPDATE bms.dashboards SET name = $2 WHERE organization_id = $1 AND slug = $3`, [
        eskomOrgId,
        `F3.73 renamed ${RUN_ID}`,
        CSMOC_SLUG,
      ]);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const res = await pool.query<{ name: string }>(
        `SELECT name FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
        [eskomOrgId, CSMOC_SLUG],
      );
      expect(res.rows.map((row) => row.name)).toEqual([`F3.73 renamed ${RUN_ID}`]);
    });
  });

  it("gives an ESKOM location without meta.seedKey no copy, and reports CSMOC's view row", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      const fixture = await pool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, meta)
         VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, '{}'::jsonb) RETURNING id`,
        [eskomOrgId, `F373-${RUN_ID}`, `f373-${runId}`, `F3.73 admin site ${RUN_ID}`],
      );
      const fixtureId = fixture.rows[0]?.id ?? "";
      const outcome = await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const copies = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bms.dashboards WHERE location_id = $1`,
        [fixtureId],
      );
      expect(copies.rows[0]?.n).toBe(0);
      expect(outcome.skipped).toContainEqual({ locationId: csmocId, reason: "has_view" });
    });
  });

  /**
   * The PHEWB ownership predicate, through a station list of this run's own: the catalog's slug
   * AND its station code in `meta.phe`, as one pair. A: both → owned. B: the code under another
   * slug. C: the slug with no `meta.phe`.
   */
  async function resolvePheFixtures(): Promise<{ owned: string[]; ids: Record<"a" | "b" | "c", string> }> {
    let result: { owned: string[]; ids: Record<"a" | "b" | "c", string> } | undefined;
    await inTransaction(phewbOrgId, async (pool) => {
      const insert = async (tag: string, slug: string, meta: unknown): Promise<string> => {
        const res = await pool.query<{ id: string }>(
          `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, meta)
           VALUES ($1, $2, $3, $4, 'pump_station', 0, 0, $5::jsonb) RETURNING id`,
          [phewbOrgId, `F373-${tag}-${RUN_ID}`, slug, `F3.73 station ${tag} ${RUN_ID}`, JSON.stringify(meta)],
        );
        return res.rows[0]?.id ?? "";
      };
      const code = (tag: string): string => `F373${tag}${RUN_ID}`;
      const ids = {
        a: await insert("A", `f373-${runId}-a`, { phe: { stationCode: code("A") } }),
        b: await insert("B", `f373-${runId}-b-admin`, { phe: { stationCode: code("B") } }),
        c: await insert("C", `f373-${runId}-c`, {}),
      };
      const owned = await resolvePhewbSiteLayoutLocations(pool, phewbOrgId, [
        { slug: `f373-${runId}-a`, stationCode: code("A") },
        { slug: `f373-${runId}-b`, stationCode: code("B") },
        { slug: `f373-${runId}-c`, stationCode: code("C") },
      ]);
      result = { owned, ids };
    });
    assert(result !== undefined, "the PHE fixture transaction ran no body");
    return result as { owned: string[]; ids: Record<"a" | "b" | "c", string> };
  }

  it("owns a PHEWB location that holds a catalog station's slug and code", async () => {
    const { owned, ids } = await resolvePheFixtures();
    expect(owned).toContain(ids.a);
  });

  it("does not own a PHEWB location holding a catalog code under a non-catalog slug", async () => {
    const { owned, ids } = await resolvePheFixtures();
    expect(owned).not.toContain(ids.b);
    expect(owned).toContain(ids.a);
  });

  it("does not own a PHEWB location holding a catalog slug with no catalog code", async () => {
    const { owned, ids } = await resolvePheFixtures();
    expect(owned).not.toContain(ids.c);
    expect(owned).toContain(ids.a);
  });

  it("keeps the boot verify green and makes no second copy after a copy is deleted by hand", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [
        eskomOrgId,
        CSMOC_SLUG,
      ]);
      const outcome = await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const copies = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bms.dashboards WHERE location_id = $1 AND slug LIKE 'site-layout-%'`,
        [csmocId],
      );
      const checks = await readEskomChecks(pool, eskomOrgId, { log: () => undefined });
      const view = checks.find((check) => check.label === "ESKOM seed-owned site-layout view rows");
      expect(outcome.made).toEqual([]);
      expect(copies.rows[0]?.n).toBe(0);
      expect(view).toEqual({ label: "ESKOM seed-owned site-layout view rows", actual: 1, wanted: 1, kind: "exact" });
    });
  });

  // ── The v1 → v2 upgrade (`site-layout-seed-upgrade.ts`) ─────────────────────────────────────
  // Each case first puts ESKOM's template and CSMOC's copy back to what the v1 seed wrote, inside
  // its rolled-back transaction: a database seeded by this code holds v2 already, and would prove
  // nothing. The rewind accepts the two states this code's seed leaves: a fresh database (one
  // seed-owned version 1 row, holding stock version 2), and a database the upgrade already ran
  // on (version 1 archived, a seed-owned published version 2 that no dashboard names). Any other
  // newer `smoc-standard` row fails its precondition.

  type StoredWidget = { id: string; identity: string; tabKey: string; rect: string };
  const rectText = (rect: { gridX: number; gridY: number; gridW: number; gridH: number }): string =>
    `${rect.gridX},${rect.gridY},${rect.gridW},${rect.gridH}`;

  async function copyWidgets(pool: Pick<SeedPool, "query">): Promise<StoredWidget[]> {
    const res = await pool.query<{
      id: string;
      tab_key: string;
      widget_type: string;
      title: string | null;
      rect: string;
    }>(
      `SELECT w.id, t.tab_key, w.widget_type, w.title,
              w.grid_x || ',' || w.grid_y || ',' || w.grid_w || ',' || w.grid_h AS rect
         FROM bms.dashboard_widgets w
         JOIN bms.dashboard_tabs t ON t.id = w.tab_id
         JOIN bms.dashboards d ON d.id = w.dashboard_id
        WHERE d.organization_id = $1 AND d.slug = $2
        ORDER BY t.sort_order, w.grid_y, w.grid_x`,
      [eskomOrgId, CSMOC_SLUG],
    );
    return res.rows.map((row) => ({
      id: row.id,
      identity: siteWidgetIdentity(row.tab_key, row.widget_type, row.title),
      tabKey: row.tab_key,
      rect: row.rect,
    }));
  }

  async function descriptionOf(pool: Pick<SeedPool, "query">): Promise<string | null | undefined> {
    const res = await pool.query<{ description: string | null }>(
      `SELECT description FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
      [eskomOrgId, CSMOC_SLUG],
    );
    return res.rows[0]?.description;
  }

  async function templateRows(pool: Pick<SeedPool, "query">): Promise<string> {
    const res = await pool.query<{ row: string }>(
      `SELECT version || ':' || status || ':' || stock_version AS row FROM bms.dashboard_templates
        WHERE organization_id = $1 AND code = 'smoc-standard' ORDER BY version`,
      [eskomOrgId],
    );
    return res.rows.map((row) => row.row).join(",");
  }

  async function rewindToV1(pool: Pick<SeedPool, "query">): Promise<void> {
    // The upgraded state: the seed's own version 2, which no copy names (copies keep v1's id).
    // Deleted before v1 is published again; any other newer row survives and fails the
    // precondition below.
    await pool.query(
      `DELETE FROM bms.dashboard_templates t
        WHERE t.organization_id = $1 AND t.code = 'smoc-standard' AND t.version = 2
          AND t.status = 'published' AND t.created_by IS NULL AND t.stock_version = 2
          AND NOT EXISTS (SELECT 1 FROM bms.dashboards d WHERE d.template_id = t.id)`,
      [eskomOrgId],
    );
    const template = await pool.query(
      `UPDATE bms.dashboard_templates
          SET content = $2::jsonb, stock_version = 1, status = 'published', archived_at = NULL
        WHERE organization_id = $1 AND code = 'smoc-standard' AND version = 1
          AND status IN ('published', 'archived') AND created_by IS NULL
          AND NOT EXISTS (SELECT 1 FROM bms.dashboard_templates n
                           WHERE n.organization_id = $1 AND n.code = 'smoc-standard' AND n.version > 1)`,
      [eskomOrgId, JSON.stringify(smocStandardV1Content())],
    );
    assert(template.rowCount === 1, "precondition: ESKOM's only smoc-standard row is the seed's version 1");
    const copy = await pool.query(`UPDATE bms.dashboards SET description = $3 WHERE organization_id = $1 AND slug = $2`, [
      eskomOrgId,
      CSMOC_SLUG,
      SITE_LAYOUT_COPY_DESCRIPTION_V1,
    ]);
    assert(copy.rowCount === 1, "precondition: CSMOC Gauteng holds the seeded copy");
    for (const widget of await copyWidgets(pool)) {
      const rect = SMOC_STANDARD_V1_RECTS.get(widget.identity);
      assert(rect !== undefined, `precondition: ${widget.identity} is a template widget`);
      await pool.query(
        `UPDATE bms.dashboard_widgets SET grid_x = $2, grid_y = $3, grid_w = $4, grid_h = $5 WHERE id = $1`,
        [widget.id, rect?.gridX, rect?.gridY, rect?.gridW, rect?.gridH],
      );
    }
  }

  it("moves a v1 copy's widgets to the v2 rects on a re-seed", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      const before = await copyWidgets(pool);
      expect(before.length).toBeGreaterThan(0);
      expect(before.map((w) => w.rect)).toEqual(before.map((w) => rectText(SMOC_STANDARD_V1_RECTS.get(w.identity)!)));
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const after = await copyWidgets(pool);
      expect(after.map((w) => `${w.identity}@${w.rect}`)).toEqual(
        after.map((w) => `${w.identity}@${rectText(SMOC_STANDARD_CURRENT_RECTS.get(w.identity)!)}`),
      );
      expect(after).toHaveLength(before.length);
    });
  });

  it("replaces a v1 copy's description on a re-seed", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      expect(await descriptionOf(pool)).toBe(SITE_LAYOUT_COPY_DESCRIPTION_V1);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await descriptionOf(pool)).toBe(SITE_LAYOUT_COPY_DESCRIPTION);
    });
  });

  it("supersedes the seed's v1 template with a published version 2 and archives v1", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      expect(await templateRows(pool)).toBe("1:published:1");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await templateRows(pool)).toBe("1:archived:1,2:published:2");
    });
  });

  it("writes nothing when the upgrade runs a second time", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const snapshot = async (): Promise<string> =>
        JSON.stringify([await templateRows(pool), await descriptionOf(pool), await copyWidgets(pool)]);
      const first = await snapshot();
      expect(await upgradeSeedSiteTemplate(pool, eskomOrgId)).toBeNull();
      expect(await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX)).toEqual({
        descriptions: 0,
        widgets: 0,
      });
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await snapshot()).toBe(first);
    });
  });

  it("rewinds and upgrades again a database the seed already upgraded", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await templateRows(pool)).toBe("1:archived:1,2:published:2");
      await rewindToV1(pool);
      expect(await templateRows(pool)).toBe("1:published:1");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await templateRows(pool)).toBe("1:archived:1,2:published:2");
    });
  });

  it("keeps an admin's moved widget's tab and edited description, and moves the other tabs", async () => {
    await inTransaction(eskomOrgId, async (pool) => {
      await rewindToV1(pool);
      const rail = (await copyWidgets(pool)).find((w) => w.identity === "sld|active_alarms_rail|Active alarms");
      expect(rail).toBeDefined();
      await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = grid_y + 1 WHERE id = $1`, [rail?.id]);
      await pool.query(`UPDATE bms.dashboards SET description = $3 WHERE organization_id = $1 AND slug = $2`, [
        eskomOrgId,
        CSMOC_SLUG,
        `Edited ${RUN_ID}`,
      ]);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const after = await copyWidgets(pool);
      const sld = after.filter((w) => w.tabKey === "sld" && w.id !== rail?.id);
      const ups = after.filter((w) => w.tabKey === "ups");
      expect(sld.length).toBeGreaterThan(0);
      expect(sld.map((w) => w.rect)).toEqual(sld.map((w) => rectText(SMOC_STANDARD_V1_RECTS.get(w.identity)!)));
      expect(ups.length).toBeGreaterThan(0);
      expect(ups.map((w) => w.rect)).toEqual(ups.map((w) => rectText(SMOC_STANDARD_CURRENT_RECTS.get(w.identity)!)));
      expect(await descriptionOf(pool)).toBe(`Edited ${RUN_ID}`);
    });
  });
});
