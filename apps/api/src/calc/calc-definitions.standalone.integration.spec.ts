import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetPoints, assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { MetricsService } from "../observability/metrics.service";
import type { CalcDefinition } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";

/**
 * `F4.311` PR 1 (ADR 0109 decision 2) — the loader reads two sources, against
 * a real database.
 *
 * The template read (ADR 0039's merge) and the standalone read (a `computed`
 * row on an asset with no template) are both SQL that no unit test issues:
 * every calc unit test builds its definitions by hand. So the claims here are
 * about what the loader actually hands the engine, one per `it`:
 *
 * 1. the template-derived point is still loaded (drop the first read → red);
 * 2. the standalone point is loaded, keyed on its `asset_points.id`, with its
 *    stored dialect, trigger and interval (drop the second read → red);
 * 3. a standalone row with no formula is not a definition, and is counted once
 *    as `no_formula` on a counted reload (ADR 0037 decision 9);
 * 4. a pinned asset's computed row is the override, read once through the
 *    merge — not a second time by the standalone read (drop
 *    `isNull(assets.templateId)` → red).
 */

/** Per-run, so two instances of this file never sweep each other's rows
 * (`tests/integration-fixture-isolation.test.ts`). */
const TEST_TEMPLATE_CODE = `F4311-SA-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const TEST_ASSET_PREFIX = `F4311-SA-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

export const STANDALONE_KEY = "F4311_STANDALONE";
export const NO_FORMULA_KEY = "F4311_NO_FORMULA";
export const DERIVED_KEY = "F4311_TEMPLATE_DERIVED";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN
       (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_CODE}%`]);
}

type Seeded = {
  pinnedAssetId: string;
  bareAssetId: string;
  standaloneRowId: string;
};

/**
 * One published template with a derived point, one asset pinned to it (with
 * a computed override row), and one asset with `template_id NULL` carrying a
 * standalone computed row with all five columns. Claim 3 adds its own
 * no-formula row, so it can count the difference that one row makes.
 */
async function seed(db: BmsDb, fx: Fixtures): Promise<Seeded> {
  const measuredKey = fx.pointKeys[0].code;
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version: 1,
      name: "Standalone Fixture v1",
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: measuredKey,
      kind: "measured",
      sortOrder: 0,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: DERIVED_KEY,
      kind: "derived",
      sortOrder: 1,
      formula: `{${measuredKey}} * 2`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 120,
      maxInputAgeSeconds: 600,
    },
  ]);

  const [pinned, bare] = await db
    .insert(assets)
    .values([
      {
        organizationId: fx.organizationId,
        code: `${TEST_ASSET_PREFIX}PINNED`,
        name: "Standalone Fixture Pinned",
        siteName: "Fixture Site",
        locationId: fx.otherLocationId,
        domain: "electrical",
        templateId: template.id,
      },
      {
        organizationId: fx.organizationId,
        code: `${TEST_ASSET_PREFIX}BARE`,
        name: "Standalone Fixture Bare",
        siteName: "Fixture Site",
        locationId: fx.otherLocationId,
        domain: "electrical",
        templateId: null,
      },
    ])
    .returning({ id: assets.id });

  // The pinned asset's override row: a computed row with a formula. The merge
  // reads it; the standalone read must not.
  await db.insert(assetPoints).values({
    organizationId: fx.organizationId,
    assetId: pinned.id,
    pointKey: DERIVED_KEY,
    sourceDataKey: `computed:${DERIVED_KEY}`,
    sourceKind: "computed",
    rtuId: null,
    formula: `{${measuredKey}} * 3`,
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
  });

  const [standalone] = await db
    .insert(assetPoints)
    .values({
      organizationId: fx.organizationId,
      assetId: bare.id,
      pointKey: STANDALONE_KEY,
      sourceDataKey: `computed:${STANDALONE_KEY}`,
      sourceKind: "computed",
      rtuId: null,
      formula: `{${measuredKey}} * 4`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 90,
      maxInputAgeSeconds: 450,
    })
    .returning({ id: assetPoints.id });

  return { pinnedAssetId: pinned.id, bareAssetId: bare.id, standaloneRowId: standalone.id };
}

async function freshDefinitions(db: BmsDb): Promise<CalcDefinition[]> {
  return new CalcDefinitionsService(db, new MetricsService()).getAllDefinitionsFresh();
}

/** Claim 1 — the template read is still there. */
export async function assertTheTemplateDefinitionIsLoaded(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { pinnedAssetId } = await seed(db, fx);
  const defs = await freshDefinitions(db);
  assert(
    defs.some((d) => d.assetId === pinnedAssetId && d.pointKey === DERIVED_KEY),
    "the template-derived point must still be loaded — the template read was dropped",
  );
}

/** Claim 2 — the standalone read is there, keyed on the asset_points row. */
export async function assertTheStandaloneDefinitionIsLoaded(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { bareAssetId, standaloneRowId } = await seed(db, fx);
  const defs = await freshDefinitions(db);
  const def = defs.find((d) => d.assetId === bareAssetId && d.pointKey === STANDALONE_KEY);
  assert(def !== undefined, "the standalone computed point must be loaded — the second read was dropped");
  assert(
    def?.templatePointId === standaloneRowId,
    `a standalone definition is keyed on its asset_points.id: expected ${standaloneRowId}, got ${String(def?.templatePointId)}`,
  );
  assert(
    def?.dialect === "bms-calc-v1" && def?.trigger === "scheduled" && def?.intervalSeconds === 90,
    `the stored dialect, trigger and interval must reach the engine — got ${String(def?.dialect)}/${String(
      def?.trigger,
    )}/${String(def?.intervalSeconds)}`,
  );
}

/** Claim 3 — a standalone row with no formula is a counted no_formula skip. */
export async function assertANoFormulaRowIsACountedSkip(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const { bareAssetId } = await seed(createDb(pool), fx);

  // The count is estate-wide, and other suites write no-formula computed rows
  // on template-less assets while this runs (`calc-write.integration.spec.ts`
  // auto-creates exactly those). So both reloads and the fixture insert run in
  // **one** `REPEATABLE READ` snapshot on one client: other suites' commits are
  // invisible to it, this insert is visible, and the difference is exactly this
  // one row. Rolled back, so nothing is left behind.
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const db = createDb(client as unknown as pg.Pool);

    // `getScheduledDefinitions` runs a **counted** reload; `getAllDefinitionsFresh`
    // is the validation read and counts nothing (F2.9 finding 30). A fresh
    // service and a fresh tally per reload: never a lifetime counter.
    const noFormulaSkips = async (): Promise<{ count: number; defs: CalcDefinition[] }> => {
      const metrics = new MetricsService();
      let count = 0;
      metrics.countCalcSkipped = (reason) => {
        if (reason === "no_formula") count += 1;
      };
      const defs = await new CalcDefinitionsService(db, metrics).getScheduledDefinitions();
      return { count, defs };
    };

    const before = await noFormulaSkips();
    await db.insert(assetPoints).values({
      organizationId: fx.organizationId,
      assetId: bareAssetId,
      pointKey: NO_FORMULA_KEY,
      sourceDataKey: `computed:${NO_FORMULA_KEY}`,
      sourceKind: "computed",
      rtuId: null,
    });
    const after = await noFormulaSkips();

    assert(
      !after.defs.some((d) => d.assetId === bareAssetId && d.pointKey === NO_FORMULA_KEY),
      "a computed row with no formula must not become a definition",
    );
    assert(
      after.count === before.count + 1,
      `the no-formula standalone row must be counted once as no_formula: before ${before.count}, after ${after.count}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** Claim 4 — the override row of a pinned asset is read once, through the merge. */
export async function assertAPinnedAssetsOverrideIsReadOnce(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { pinnedAssetId } = await seed(db, fx);
  const defs = await freshDefinitions(db);
  const forPinned = defs.filter((d) => d.assetId === pinnedAssetId && d.pointKey === DERIVED_KEY);
  assert(
    forPinned.length === 1,
    `a pinned asset's computed row is its override and must be loaded once, got ${forPinned.length} — ` +
      "the standalone read must be limited to assets with no template",
  );
  assert(
    forPinned[0]?.intervalSeconds === 60,
    `the one definition must be the merged override (interval 60), got ${String(forPinned[0]?.intervalSeconds)}`,
  );
}
