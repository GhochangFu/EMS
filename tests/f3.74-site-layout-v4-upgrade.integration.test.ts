import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as SiteLayoutSeed from "../packages/db/dist/site-layout-seed.js";
import type * as SiteLayoutSeedUpgrade from "../packages/db/dist/site-layout-seed-upgrade.js";
import type * as SiteLayoutStockHistory from "../packages/db/dist/site-layout-stock-history.js";
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
const { seedEskomSiteLayouts, SITE_LAYOUT_SLUG_PREFIX, siteLayoutSlug } = require_(
  "../packages/db/dist/site-layout-seed.js",
) as typeof SiteLayoutSeed;
const { siteWidgetIdentity, TAB_WIDGET_INSERT_SQL, upgradeSeededSiteLayoutCopies } = require_(
  "../packages/db/dist/site-layout-seed-upgrade.js",
) as typeof SiteLayoutSeedUpgrade;
const { canonicalJson, OVERVIEW_V3_WIDGETS, SLD_V3_WIDGETS, smocStandardV3Content } = require_(
  "../packages/db/dist/site-layout-stock-history.js",
) as typeof SiteLayoutStockHistory;

/**
 * `F3.74` (ADR 0088 Amendment 2) — the seed moves CSMOC Gauteng's seeded copy from stock v3 to
 * v4, per tab: an untouched Overview gains the compact electrical diagram beside the class strip,
 * and an untouched electrical tab draws `lv_single_line` with the "Breakers" table under it. An
 * edited tab is left whole, the other tab still moves (OQ-A). The pure planners are
 * `packages/db/src/site-layout-seed-upgrade-tabs.spec.ts`.
 *
 * **After a full `pnpm db:seed`.** Each case first puts CSMOC's copy back to v3 by hand
 * ({@link rewindToV3}, precondition-asserted), inside one `BEGIN` … `ROLLBACK` on the seed pool's
 * one connection, in ESKOM's tenant context as `bms_owner` (bound by FORCE ROW LEVEL SECURITY):
 * a database seeded by this code holds v4 already, and would prove nothing.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.74",
  label: "the v3 → v4 seed upgrade of the SMOC standard site layout",
  because:
    "that the seed moves an untouched seeded tab to v4, leaves an edited one whole, and writes " +
    "nothing on a second run are database behaviours under row-level security.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type SeedPool = ReturnType<typeof createSeedPool>;
type StoredWidget = { id: string; identity: string; tabKey: string; rect: string; config: string; points: number };

const mapRows = seedMapLocationRows(loadPheCatalog());
const CSMOC_SLUG = siteLayoutSlug("csmoc-gauteng");
const NOTHING = { descriptions: 0, widgets: 0, packed: 0, omittedTiles: 0, overviews: 0, overviewsV4: 0, electricalTabs: 0 };
/** The two widgets v4 added, which v3 does not hold. */
const V4_ONLY = ["overview|mimic|", "sld|breaker_table|Breakers"];

describe.skipIf(!ownerUrl)("F3.74 — the v3 → v4 seed upgrade of the seeded site layout", { timeout: 60_000 }, () => {
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";
  let csmocId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    // Reads of the seeded ids on a `bms_fleet` probe, as the F3.73 suite reads them.
    const probe = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F3.74");
    try {
      const ids = await probe.query<{ org: string | null; csmoc: string | null }>(
        `SELECT (SELECT id FROM bms.organizations WHERE code = 'ESKOM') AS org,
                (SELECT id FROM bms.locations WHERE meta->>'seedKey' = 'csmoc-gauteng') AS csmoc`,
      );
      eskomOrgId = ids.rows[0]?.org ?? "";
      csmocId = ids.rows[0]?.csmoc ?? "";
    } finally {
      await probe.end();
    }
    assert(eskomOrgId !== "" && csmocId !== "", "run pnpm db:seed first");
    seedPool = createSeedPool(url);
    const role = await seedPool.query<{ current_user: string }>("SELECT current_user");
    assert(role.rows[0]?.current_user === "bms_owner", "the seed pool must run as bms_owner");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
  }, 60_000);

  async function inTransaction(body: (pool: SeedPool) => Promise<void>): Promise<void> {
    if (!seedPool) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      // One case at a time across this suite and the F3.73 site-layout suite: both rewrite
      // CSMOC's copy and ESKOM's template rows, and two such transactions deadlock.
      await pool.query("SELECT pg_advisory_xact_lock(hashtext('site-layout seed suites'))");
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await body(pool);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  async function copyWidgets(pool: Pick<SeedPool, "query">): Promise<StoredWidget[]> {
    const res = await pool.query<{
      id: string;
      tab_key: string;
      widget_type: string;
      title: string | null;
      rect: string;
      config: unknown;
      points: number;
    }>(
      `SELECT w.id, t.tab_key, w.widget_type, w.title,
              w.grid_x || ',' || w.grid_y || ',' || w.grid_w || ',' || w.grid_h AS rect, w.config,
              (SELECT count(*)::int FROM bms.dashboard_widget_points p WHERE p.widget_id = w.id) AS points
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
      config: canonicalJson(row.config),
      points: row.points,
    }));
  }

  /** A widget as the comparisons see it: identity, rect and config. */
  const shapeOf = (widget: StoredWidget): string => `${widget.identity}@${widget.rect}${widget.config}`;
  const shapesOf = async (pool: Pick<SeedPool, "query">, tabKey?: string): Promise<string[]> =>
    (await copyWidgets(pool)).filter((w) => tabKey === undefined || w.tabKey === tabKey).map(shapeOf).sort();

  /** CSMOC's copy as the seed makes it today (deleted, then seeded afresh), as sorted shapes. */
  async function freshCopyShapes(): Promise<string[]> {
    let shapes: string[] = [];
    await inTransaction(async (pool) => {
      await pool.query(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [csmocId]);
      await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [eskomOrgId, CSMOC_SLUG]);
      const outcome = await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      assert(outcome.made.length === 1, `the fresh copy was not made: ${JSON.stringify(outcome.skipped)}`);
      shapes = await shapesOf(pool);
    });
    return shapes;
  }

  /**
   * Puts CSMOC's Overview and electrical tab back to what the v3 seed's copy rule wrote: the two
   * v4-only widgets deleted, every other widget of the two tabs at its frozen v3 rect and config,
   * the one kept role tile (Main bus load, CSMOC's only bound electrical tile) packed to `0,0`.
   * Accepts a copy at v3 or v4; anything else fails a precondition. Other tabs are left as they are.
   */
  async function rewindToV3(pool: Pick<SeedPool, "query">): Promise<void> {
    const frozen = new Map<string, { rect: [number, number, number, number]; config: unknown }>();
    for (const [tabKey, widgets] of [["overview", OVERVIEW_V3_WIDGETS], ["sld", SLD_V3_WIDGETS]] as const) {
      for (const widget of widgets) {
        frozen.set(siteWidgetIdentity(tabKey, widget.widgetType, widget.title), {
          rect: [widget.gridX, widget.gridY, widget.gridW, widget.gridH],
          config: widget.config,
        });
      }
    }
    const tabs = (await copyWidgets(pool)).filter((w) => w.tabKey === "overview" || w.tabKey === "sld");
    for (const widget of tabs.filter((w) => V4_ONLY.includes(w.identity))) {
      assert(widget.points === 0, `precondition: ${widget.identity} holds no point row`);
      const res = await pool.query(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [widget.id]);
      assert(res.rowCount === 1, `precondition: ${widget.identity} was deleted`);
    }
    const kept = tabs.filter((w) => !V4_ONLY.includes(w.identity));
    const tiles = kept.filter((w) => w.identity.startsWith("sld|value_tile|")).map((w) => `${w.identity}:${w.points}`);
    assert(tiles.join(",") === "sld|value_tile|Main bus load:1", `precondition: CSMOC keeps one bound tile, got ${tiles.join(",")}`);
    assert(kept.length === 8 + 4, `precondition: the Overview and the electrical tab hold 12 v3 widgets, got ${kept.length}`);
    for (const widget of kept) {
      const v3 = frozen.get(widget.identity);
      assert(v3 !== undefined, `precondition: ${widget.identity} is a v3 widget`);
      const [gridX, gridY, gridW, gridH] = widget.identity === "sld|value_tile|Main bus load" ? [0, 0, 3, 2] : v3!.rect;
      const res = await pool.query(
        `UPDATE bms.dashboard_widgets SET grid_x = $2, grid_y = $3, grid_w = $4, grid_h = $5, config = $6::jsonb WHERE id = $1`,
        [widget.id, gridX, gridY, gridW, gridH, JSON.stringify(v3!.config)],
      );
      assert(res.rowCount === 1, `precondition: ${widget.identity} was reshaped`);
    }
    const sld = await shapesOf(pool, "sld");
    assert(
      sld.includes('sld|mimic|@0,2,12,7{"preset":"electrical_distribution","source":"preset"}') &&
        sld.includes("sld|active_alarms_rail|Active alarms@0,9,6,5" + canonicalJson({ rows: 8, showSummary: true })),
      `precondition: the electrical tab is at v3: ${sld.join(";")}`,
    );
  }

  async function templateRows(pool: Pick<SeedPool, "query">): Promise<string> {
    const res = await pool.query<{ row: string }>(
      `SELECT version || ':' || status || ':' || COALESCE(stock_version::text, '-') AS row
         FROM bms.dashboard_templates
        WHERE organization_id = $1 AND code = 'smoc-standard' ORDER BY version`,
      [eskomOrgId],
    );
    return res.rows.map((row) => row.row).join(",");
  }

  /**
   * ESKOM's `smoc-standard` rows back to one: the seed's own version 1, published at stock
   * `stockVersion` with `content`. The seed's own newer rows that no dashboard names are deleted
   * first; any other newer row survives and fails the precondition.
   */
  async function rewindTemplate(pool: Pick<SeedPool, "query">, stockVersion: number, content: unknown): Promise<void> {
    await pool.query(
      `DELETE FROM bms.dashboard_templates t
        WHERE t.organization_id = $1 AND t.code = 'smoc-standard' AND t.version > 1
          AND t.status IN ('published', 'archived') AND t.created_by IS NULL AND t.stock_version IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM bms.dashboards d WHERE d.template_id = t.id)`,
      [eskomOrgId],
    );
    const template = await pool.query(
      `UPDATE bms.dashboard_templates
          SET content = $2::jsonb, stock_version = $3, status = 'published', archived_at = NULL
        WHERE organization_id = $1 AND code = 'smoc-standard' AND version = 1
          AND status IN ('published', 'archived') AND created_by IS NULL
          AND NOT EXISTS (SELECT 1 FROM bms.dashboard_templates n
                           WHERE n.organization_id = $1 AND n.code = 'smoc-standard' AND n.version > 1)`,
      [eskomOrgId, JSON.stringify(content), stockVersion],
    );
    assert(template.rowCount === 1, "precondition: ESKOM's only smoc-standard row is the seed's version 1");
  }

  it("I1: moves a v3 copy's Overview and electrical tab to where a fresh copy has them, on a re-seed", async () => {
    const fresh = await freshCopyShapes();
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      expect(await shapesOf(pool)).not.toEqual(fresh);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await shapesOf(pool)).toEqual(fresh);
    });
  });

  it("I2: writes nothing when the upgrade runs a second time", async () => {
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      const first = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      const snapshot = JSON.stringify(await copyWidgets(pool));
      const second = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      // One claim: the first run wrote both tabs, and the second wrote nothing and changed no row.
      expect({
        first: [first.overviewsV4, first.electricalTabs],
        second,
        after: JSON.stringify(await copyWidgets(pool)),
      }).toEqual({ first: [1, 1], second: NOTHING, after: snapshot });
    });
  });

  it("I3: leaves an Overview with one tile moved whole and still moves the electrical tab to v4", async () => {
    const freshSld = (await freshCopyShapes()).filter((shape) => shape.startsWith("sld|"));
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      const tile = (await copyWidgets(pool)).find((w) => w.identity === "overview|value_tile|Total load");
      expect(tile).toBeDefined();
      await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = grid_y + 1 WHERE id = $1`, [tile?.id]);
      const overview = await shapesOf(pool, "overview");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect({ overview: await shapesOf(pool, "overview"), sld: await shapesOf(pool, "sld") }).toEqual({
        overview,
        sld: freshSld,
      });
    });
  });

  it("I4: leaves an electrical tab with the rail moved whole and still moves the Overview to v4", async () => {
    const freshOverview = (await freshCopyShapes()).filter((shape) => shape.startsWith("overview|"));
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      const rail = (await copyWidgets(pool)).find((w) => w.identity === "sld|active_alarms_rail|Active alarms");
      expect(rail).toBeDefined();
      await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = grid_y + 1 WHERE id = $1`, [rail?.id]);
      const sld = await shapesOf(pool, "sld");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect({ overview: await shapesOf(pool, "overview"), sld: await shapesOf(pool, "sld") }).toEqual({
        overview: freshOverview,
        sld,
      });
    });
  });

  /**
   * I8 (ADR 0088 Amendment 2, "nothing deleted") — an administrator deleted "Main bus load", a tile
   * the copy rule keeps at CSMOC (its `lt-panel` member has `kw`), and the tab's body sits where a
   * copy that omitted it would: the mimic at `0,0`, the rail and the table at `y7`. The tab is
   * left whole; the Overview, untouched, still moves.
   * Mutation: `planElectricalV4Upgrade` keeps only the tiles the store holds (drop
   * `bindableTiles.has`) → the tab reads as a copy that omitted the tile and moves → red. The
   * lift is what makes this case able to fail: without it the stored rects match neither shape.
   */
  it("I8: leaves an electrical tab whose bindable tile was deleted whole and still moves the Overview", async () => {
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      const sldWidgets = (await copyWidgets(pool)).filter((w) => w.tabKey === "sld");
      const reshape = async (identity: string, rect: [number, number, number, number]): Promise<void> => {
        const widget = sldWidgets.find((w) => w.identity === identity);
        const res = await pool.query(
          `UPDATE bms.dashboard_widgets SET grid_x = $2, grid_y = $3, grid_w = $4, grid_h = $5 WHERE id = $1`,
          [widget?.id, ...rect],
        );
        assert(res.rowCount === 1, `precondition: ${identity} was reshaped`);
      };
      const tile = sldWidgets.find((w) => w.identity === "sld|value_tile|Main bus load");
      const deleted = await pool.query(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [tile?.id]);
      assert(deleted.rowCount === 1, "precondition: Main bus load was deleted");
      await reshape("sld|mimic|", [0, 0, 12, 7]);
      await reshape("sld|active_alarms_rail|Active alarms", [0, 7, 6, 5]);
      await reshape("sld|table|Assets", [6, 7, 6, 5]);
      const sld = await shapesOf(pool, "sld");
      const outcome = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      expect({
        overviewsV4: outcome.overviewsV4,
        electricalTabs: outcome.electricalTabs,
        sld: await shapesOf(pool, "sld"),
      }).toEqual({ overviewsV4: 1, electricalTabs: 0, sld });
    });
  });

  /**
   * I9 — the tab step's insert writes a widget once: run twice on the Overview's diagram (no
   * title, so the guard must compare with `IS NOT DISTINCT FROM`), the second writes no row, which
   * the runner's `RETURNING` check turns into a throw.
   * Mutation: drop the `NOT EXISTS` of `TAB_WIDGET_INSERT_SQL` → the second insert returns a row → red.
   */
  it("I9: inserts a tab widget once when the insert runs twice", async () => {
    await inTransaction(async (pool) => {
      await rewindToV3(pool);
      const ids = await pool.query<{ dashboard_id: string; tab_id: string }>(
        `SELECT d.id AS dashboard_id, t.id AS tab_id FROM bms.dashboards d
           JOIN bms.dashboard_tabs t ON t.dashboard_id = d.id AND t.tab_key = 'overview'
          WHERE d.organization_id = $1 AND d.slug = $2`,
        [eskomOrgId, CSMOC_SLUG],
      );
      const row = ids.rows[0];
      assert(row !== undefined, "precondition: CSMOC's copy has an Overview tab");
      const params = [eskomOrgId, row!.dashboard_id, row!.tab_id, "mimic", null, 0, 9, 6, 2, JSON.stringify({ compact: true })];
      const first = await pool.query(TAB_WIDGET_INSERT_SQL, params);
      const second = await pool.query(TAB_WIDGET_INSERT_SQL, params);
      expect([first.rows.length, second.rows.length]).toEqual([1, 0]);
    });
  });

  it("I5: supersedes the seed's stock-3 template row with a published stock-4 row and archives it", async () => {
    await inTransaction(async (pool) => {
      await rewindTemplate(pool, 3, smocStandardV3Content());
      expect(await templateRows(pool)).toBe("1:published:3");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await templateRows(pool)).toBe("1:archived:3,2:published:4");
    });
  });
});
