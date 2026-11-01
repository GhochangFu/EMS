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
const { siteWidgetIdentity, upgradeSeededSiteLayoutCopies } = require_(
  "../packages/db/dist/site-layout-seed-upgrade.js",
) as typeof SiteLayoutSeedUpgrade;
const { canonicalJson, smocStandardV4Content } = require_(
  "../packages/db/dist/site-layout-stock-history.js",
) as typeof SiteLayoutStockHistory;

/**
 * `F4.305` (ADR 0108 Amendment 3 items 4, 5 and 8; owner answers C1 and C5) — the seed's v5 step
 * on CSMOC Gauteng's seeded copy: one trend strip under the top tile row of every tab, edited tabs
 * included, the widgets below it moved down by exactly its height, no overlap, and once per copy
 * by the `bms.dashboards.stock_version` stamp, so a strip an administrator deletes stays deleted.
 * The pure planner is `packages/db/src/site-layout-seed-upgrade-v5.spec.ts`.
 *
 * **After a full `pnpm db:seed`.** Each case first takes CSMOC's copy back to stock v4 by hand
 * ({@link rewindToV4}: every strip deleted, the widgets under it lifted, the stamp cleared) inside
 * one `BEGIN` … `ROLLBACK` on the seed pool's one connection, in ESKOM's tenant context as
 * `bms_owner` (bound by FORCE ROW LEVEL SECURITY): a database seeded by this code holds v5 already.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.305",
  label: "the v4 → v5 seed upgrade of the SMOC standard site layout (the trend strip)",
  because:
    "that the seed gives every tab of a seeded copy one trend strip, once per copy by its stamp, " +
    "and never re-inserts a deleted one, are database behaviours under row-level security.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type SeedPool = ReturnType<typeof createSeedPool>;
type Rect = [number, number, number, number];
type StoredWidget = { id: string; identity: string; tabKey: string; widgetType: string; rect: Rect; config: string };

const mapRows = seedMapLocationRows(loadPheCatalog());
const CSMOC_SLUG = siteLayoutSlug("csmoc-gauteng");
const NOTHING = {
  descriptions: 0,
  widgets: 0,
  packed: 0,
  omittedTiles: 0,
  overviews: 0,
  overviewsV4: 0,
  electricalTabs: 0,
  trendStrips: 0,
};
const STRIP_ROWS = 4;

describe.skipIf(!ownerUrl)("F4.305 — the v4 → v5 seed upgrade of the seeded site layout", { timeout: 60_000 }, () => {
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";
  let csmocId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    const probe = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.305");
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
      // One case at a time across this suite and the F3.73 / F3.74 site-layout suites: all three
      // rewrite CSMOC's copy and ESKOM's template rows, and two such transactions deadlock.
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
      grid_x: number;
      grid_y: number;
      grid_w: number;
      grid_h: number;
      config: unknown;
    }>(
      `SELECT w.id, t.tab_key, w.widget_type, w.title, w.grid_x, w.grid_y, w.grid_w, w.grid_h, w.config
         FROM bms.dashboard_widgets w
         JOIN bms.dashboard_tabs t ON t.id = w.tab_id
         JOIN bms.dashboards d ON d.id = w.dashboard_id
        WHERE d.organization_id = $1 AND d.slug = $2
        ORDER BY t.sort_order, w.grid_y, w.grid_x, w.id`,
      [eskomOrgId, CSMOC_SLUG],
    );
    return res.rows.map((row) => ({
      id: row.id,
      identity: siteWidgetIdentity(row.tab_key, row.widget_type, row.title),
      tabKey: row.tab_key,
      widgetType: row.widget_type,
      rect: [row.grid_x, row.grid_y, row.grid_w, row.grid_h],
      config: canonicalJson(row.config),
    }));
  }

  const shapeOf = (widget: StoredWidget): string => `${widget.identity}@${widget.rect.join(",")}${widget.config}`;
  const shapesOf = async (pool: Pick<SeedPool, "query">): Promise<string[]> => (await copyWidgets(pool)).map(shapeOf).sort();
  const stripsOf = (widgets: readonly StoredWidget[], tabKey: string): StoredWidget[] =>
    widgets.filter((w) => w.tabKey === tabKey && w.widgetType === "trend_strip");

  async function stockVersion(pool: Pick<SeedPool, "query">): Promise<number | null | undefined> {
    const res = await pool.query<{ stock_version: number | null }>(
      `SELECT stock_version FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
      [eskomOrgId, CSMOC_SLUG],
    );
    return res.rows[0]?.stock_version;
  }

  async function setStockVersion(pool: Pick<SeedPool, "query">, value: number | null): Promise<void> {
    const res = await pool.query(`UPDATE bms.dashboards SET stock_version = $3 WHERE organization_id = $1 AND slug = $2`, [
      eskomOrgId,
      CSMOC_SLUG,
      value,
    ]);
    assert(res.rowCount === 1, "precondition: CSMOC Gauteng holds the seeded copy");
  }

  /** The tab keys of CSMOC's copy, in tab order. */
  async function tabKeys(pool: Pick<SeedPool, "query">): Promise<string[]> {
    const res = await pool.query<{ tab_key: string }>(
      `SELECT t.tab_key FROM bms.dashboard_tabs t JOIN bms.dashboards d ON d.id = t.dashboard_id
        WHERE d.organization_id = $1 AND d.slug = $2 ORDER BY t.sort_order`,
      [eskomOrgId, CSMOC_SLUG],
    );
    return res.rows.map((row) => row.tab_key);
  }

  /** Every pair of widgets of one tab that overlap. */
  function overlaps(widgets: readonly StoredWidget[]): string[] {
    const clashes: string[] = [];
    for (const [i, a] of widgets.entries()) {
      for (const b of widgets.slice(i + 1)) {
        if (a.tabKey !== b.tabKey) continue;
        const [ax, ay, aw, ah] = a.rect;
        const [bx, by, bw, bh] = b.rect;
        if (ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay) continue;
        clashes.push(`${a.identity}/${b.identity}`);
      }
    }
    return clashes;
  }

  /**
   * CSMOC's copy back to stock v4: every `trend_strip` deleted, the widgets under it lifted by its
   * height, the stamp cleared. Precondition: every tab of the copy held exactly one strip.
   */
  async function rewindToV4(pool: Pick<SeedPool, "query">): Promise<void> {
    const widgets = await copyWidgets(pool);
    for (const tabKey of await tabKeys(pool)) {
      const strips = stripsOf(widgets, tabKey);
      assert(strips.length === 1, `precondition: ${tabKey} holds one trend strip, got ${strips.length}`);
      const [, y, , h] = strips[0]!.rect;
      const res = await pool.query(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [strips[0]!.id]);
      assert(res.rowCount === 1, `precondition: the ${tabKey} strip was deleted`);
      for (const below of widgets.filter((w) => w.tabKey === tabKey && w.widgetType !== "trend_strip" && w.rect[1] >= y + h)) {
        await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = grid_y - $2 WHERE id = $1`, [below.id, h]);
      }
    }
    await setStockVersion(pool, null);
    assert((await copyWidgets(pool)).every((w) => w.widgetType !== "trend_strip"), "precondition: no strip is left");
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

  /** ESKOM's `smoc-standard` rows back to one: the seed's version 1 at `stockVersion` with `content`. */
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

  /** CSMOC's copy as the seed makes it today (deleted, then seeded afresh): shapes and stamp. */
  async function freshCopy(): Promise<{ shapes: string[]; stockVersion: number | null | undefined }> {
    let fresh: { shapes: string[]; stockVersion: number | null | undefined } = { shapes: [], stockVersion: undefined };
    await inTransaction(async (pool) => {
      await pool.query(`DELETE FROM bms.site_control_room_views WHERE location_id = $1`, [csmocId]);
      await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [eskomOrgId, CSMOC_SLUG]);
      const outcome = await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      assert(outcome.made.length === 1, `the fresh copy was not made: ${JSON.stringify(outcome.skipped)}`);
      fresh = { shapes: await shapesOf(pool), stockVersion: await stockVersion(pool) };
    });
    return fresh;
  }

  it("V1: moves a v4 copy to where a fresh copy has it, on a re-seed", async () => {
    const fresh = await freshCopy();
    await inTransaction(async (pool) => {
      await rewindToV4(pool);
      expect(await shapesOf(pool)).not.toEqual(fresh.shapes);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await shapesOf(pool)).toEqual(fresh.shapes);
    });
  });

  /**
   * V2 — edited tabs too (owner, item 5): an administrator moved the Overview's body down a row
   * and one tile into it (so the tile row ends at `y3`), and deleted the hvac tab's alarm rail.
   * Every tab gains exactly one strip; ups, with no tile left at CSMOC, at `y0`; the Overview's at
   * `y3`; every other widget stays or moves down by exactly 4; nothing overlaps.
   */
  it("V2: gives every tab of an edited v4 copy one strip under its tiles, moves the rest by 4, overlaps nothing", async () => {
    await inTransaction(async (pool) => {
      await rewindToV4(pool);
      const v4 = await copyWidgets(pool);
      for (const widget of v4.filter((w) => w.tabKey === "overview" && w.rect[1] >= 2)) {
        await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = grid_y + 1 WHERE id = $1`, [widget.id]);
      }
      const tile = v4.find((w) => w.identity === "overview|value_tile|Total load");
      assert(tile !== undefined, "precondition: the Overview holds Total load");
      await pool.query(`UPDATE bms.dashboard_widgets SET grid_y = 1 WHERE id = $1`, [tile!.id]);
      const rail = v4.find((w) => w.identity === "hvac|active_alarms_rail|Active alarms");
      assert(rail !== undefined, "precondition: hvac holds its alarm rail");
      await pool.query(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [rail!.id]);
      const before = await copyWidgets(pool);
      assert(overlaps(before).length === 0, `precondition: the edited copy overlaps nothing: ${overlaps(before).join(",")}`);

      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const after = await copyWidgets(pool);
      const tabs = await tabKeys(pool);
      const strips = Object.fromEntries(tabs.map((key) => [key, stripsOf(after, key).map((w) => w.rect.join(","))]));
      const cutOf = (key: string): number => stripsOf(after, key)[0]?.rect[1] ?? -1;
      const wrongMoves = before.flatMap((w) => {
        const now = after.find((candidate) => candidate.id === w.id);
        const dy = now === undefined ? NaN : now.rect[1] - w.rect[1];
        const expected = w.rect[1] >= cutOf(w.tabKey) ? STRIP_ROWS : 0;
        const same = now !== undefined && now.rect[0] === w.rect[0] && now.rect[2] === w.rect[2] && now.rect[3] === w.rect[3];
        return same && dy === expected ? [] : [`${w.identity}: dy ${dy}, wanted ${expected}`];
      });
      expect({
        strips,
        configs: Object.fromEntries(tabs.map((key) => [key, stripsOf(after, key).map((w) => w.config)])),
        wrongMoves,
        overlaps: overlaps(after),
        stockVersion: await stockVersion(pool),
      }).toEqual({
        strips: {
          overview: ["0,3,12,4"],
          sld: ["0,2,12,4"],
          ups: ["0,0,12,4"],
          hvac: ["0,2,12,4"],
          water: ["0,0,12,4"],
        },
        configs: {
          overview: [canonicalJson({ defaultRange: "24h" })],
          sld: [canonicalJson({ tabKey: "sld", defaultRange: "24h" })],
          ups: [canonicalJson({ tabKey: "ups", defaultRange: "24h" })],
          hvac: [canonicalJson({ tabKey: "hvac", defaultRange: "24h" })],
          water: [canonicalJson({ tabKey: "water", defaultRange: "24h" })],
        },
        wrongMoves: [],
        overlaps: [],
        stockVersion: 5,
      });
    });
  });

  it("V3: writes nothing when the upgrade runs a second time, and leaves the copy stamped 5", async () => {
    await inTransaction(async (pool) => {
      await rewindToV4(pool);
      const first = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      const snapshot = JSON.stringify(await copyWidgets(pool));
      const second = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      expect({
        first: first.trendStrips,
        second,
        after: JSON.stringify(await copyWidgets(pool)),
        stockVersion: await stockVersion(pool),
      }).toEqual({ first: (await tabKeys(pool)).length, second: NOTHING, after: snapshot, stockVersion: 5 });
    });
  });

  /**
   * V4 — once per copy (owner answer C5): an administrator deleted the hvac strip of a stamped
   * copy; a re-seed does not put it back. Cleared stamp, then the step runs again: hvac only gets
   * a strip, the tabs that hold one are left whole.
   * Mutation: gate the step on the tab's content instead of the stamp → the deleted strip is
   * re-inserted on the first re-seed → red.
   */
  it("V4: keeps a deleted strip deleted on a re-seed, and puts it back only when the stamp is cleared", async () => {
    await inTransaction(async (pool) => {
      expect(await stockVersion(pool)).toBe(5);
      const hvacStrip = stripsOf(await copyWidgets(pool), "hvac");
      expect(hvacStrip).toHaveLength(1);
      await pool.query(`DELETE FROM bms.dashboard_widgets WHERE id = $1`, [hvacStrip[0]!.id]);
      const deleted = await shapesOf(pool);

      const reseed = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      const kept = await shapesOf(pool);

      await setStockVersion(pool, null);
      const cleared = await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, [csmocId], SITE_LAYOUT_SLUG_PREFIX);
      const after = await copyWidgets(pool);
      const added = after.map(shapeOf).filter((shape) => !kept.includes(shape));
      expect({
        reseed: reseed.trendStrips,
        kept: JSON.stringify(kept) === JSON.stringify(deleted),
        cleared: cleared.trendStrips,
        added: added.filter((shape) => shape.includes("|trend_strip|")),
        stripsPerTab: (await tabKeys(pool)).map((key) => `${key}:${stripsOf(after, key).length}`),
        stockVersion: await stockVersion(pool),
      }).toEqual({
        reseed: 0,
        kept: true,
        cleared: 1,
        added: [`hvac|trend_strip|Trends@0,2,12,4${canonicalJson({ tabKey: "hvac", defaultRange: "24h" })}`],
        stripsPerTab: ["overview:1", "sld:1", "ups:1", "hvac:1", "water:1"],
        stockVersion: 5,
      });
    });
  });

  it("V5: supersedes the seed's stock-4 template row with a published stock-5 row and archives it", async () => {
    await inTransaction(async (pool) => {
      await rewindTemplate(pool, 4, smocStandardV4Content());
      expect(await templateRows(pool)).toBe("1:published:4");
      await seedEskomSiteLayouts(pool, eskomOrgId, mapRows, () => undefined);
      expect(await templateRows(pool)).toBe("1:archived:4,2:published:5");
    });
  });

  it("V6: stamps a fresh seed copy with its template's stock version, 5", async () => {
    const fresh = await freshCopy();
    expect(fresh.stockVersion).toBe(5);
  });
});
