import type pg from "pg";

import { assetPoints, assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { MetricsService } from "../observability/metrics.service";
import { CalcDefinitionsService } from "./calc-definitions.service";

/**
 * `F2.6` U3 — the inherit-vs-override matrix, against a real database.
 *
 * ADR 0039 *Consequences* calls this the single highest-risk change in the
 * item: the coalesce sits in the hot path of every scheduled and streaming
 * evaluation, and getting it wrong **computes the wrong number rather than
 * failing**. An inner join drops every derived point with no `asset_points`
 * row — the normal state, since instantiation emits none. A reversed coalesce
 * makes every override inert. A per-row rather than per-column coalesce makes
 * one override erase four inherited values. All three are green under every
 * unit test in `apps/api/src/calc/`, because those construct their
 * dependencies directly and never issue the query.
 *
 * So the assertions here are about *values*, not about shapes: what interval,
 * what trigger, what formula the loader actually hands the engine.
 */

const TEST_TEMPLATE_CODE = "F26-MERGE-TEST";
const TEST_ASSET_PREFIX = "F26-MERGE-TEST-";

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

/** The five calc columns, as either side of the coalesce writes them. */
type CalcValues = {
  formula: string;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
};

/** The template's own values, which every inherit assertion below compares against. */
const TEMPLATE_VALUES: CalcValues = {
  formula: "{INPUT} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 120,
  maxInputAgeSeconds: 600,
};

const DERIVED_KEY = "F26_MERGE_DERIVED";
const MEASURED_TEMPLATE_KEY = "F26_MERGE_MEASURED";

type Seeded = { templateId: string; assetId: string; measuredKey: string };

/**
 * One published template with a measured point and a derived point that sets
 * **all five** calc columns, plus one asset pinned to it.
 *
 * All five are set on the template deliberately: an override assertion that
 * only ever sees `null` on the other side of the coalesce cannot tell
 * "inherited" from "the template had nothing either".
 *
 * `version` is a parameter so case 6 can seed two versions of one code.
 */
async function seedVersion(
  db: BmsDb,
  fx: Fixtures,
  version: number,
  assetSuffix: string,
  overrides: Partial<CalcValues> = {},
): Promise<Seeded> {
  const measuredKey = fx.pointKeys[0].code;
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version,
      name: `Merge Fixture v${version}`,
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    { templateId: template.id, pointKey: measuredKey, kind: "measured", sortOrder: 0 },
    {
      // A second measured point, this one carrying calc columns it has no
      // business carrying — case 8's fixture. `kind` is never coalesced, so
      // an override on it must still not produce a definition.
      templateId: template.id,
      pointKey: MEASURED_TEMPLATE_KEY,
      kind: "measured",
      sourceDataKeyPattern: "{asset_code}/MEASURED",
      sortOrder: 1,
    },
    {
      templateId: template.id,
      pointKey: DERIVED_KEY,
      kind: "derived",
      sortOrder: 2,
      ...TEMPLATE_VALUES,
      ...overrides,
      formula: (overrides.formula ?? TEMPLATE_VALUES.formula).replace("{INPUT}", `{${measuredKey}}`),
    },
  ]);

  const [asset] = await db
    .insert(assets)
    .values({
      code: `${TEST_ASSET_PREFIX}${assetSuffix}`,
      name: `Merge Fixture Asset ${assetSuffix}`,
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId: template.id,
    })
    .returning({ id: assets.id });

  return { templateId: template.id, assetId: asset.id, measuredKey };
}

/**
 * Writes an `asset_points` row for the derived point.
 *
 * `source_kind: 'computed'` with `rtu_id: null` is what
 * `asset_points_source_ref_check` requires, and `source_data_key` is the
 * synthesised `computed:<pointKey>` the calc write path already invents.
 */
async function writeOverrideRow(
  db: BmsDb,
  assetId: string,
  override: Partial<CalcValues>,
  extra: { active?: boolean; pointKey?: string } = {},
): Promise<void> {
  const pointKey = extra.pointKey ?? DERIVED_KEY;
  await db.insert(assetPoints).values({
    assetId,
    pointKey,
    sourceDataKey: `computed:${pointKey}`,
    sourceKind: "computed",
    rtuId: null,
    active: extra.active ?? true,
    formula: override.formula ?? null,
    formulaDialect: override.formulaDialect ?? null,
    calcTrigger: override.calcTrigger ?? null,
    calcIntervalSeconds: override.calcIntervalSeconds ?? null,
    maxInputAgeSeconds: override.maxInputAgeSeconds ?? null,
  });
}

/** A fresh service per assertion — the 60s TTL means one instance answers once. */
async function loadDerived(db: BmsDb, assetId: string, measuredKey: string) {
  const svc = new CalcDefinitionsService(db, new MetricsService());
  const defs = await svc.getDefinitionsForInput(assetId, measuredKey);
  return defs.find((def) => def.pointKey === DERIVED_KEY);
}

/** Case 1 — no `asset_points` row at all: the pre-F2.6 behaviour, unchanged. */
export async function assertNoRowInheritsEverything(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { assetId, measuredKey } = await seedVersion(db, fx, 1, "01");

  const def = await loadDerived(db, assetId, measuredKey);
  assert(
    def !== undefined,
    "a derived point with no asset_points row must still resolve — an INNER join here " +
      "would drop every point that has never been overridden or written, which is most of them",
  );
  assert(def?.trigger === "scheduled", `expected trigger scheduled, got ${String(def?.trigger)}`);
  assert(def?.intervalSeconds === 120, `expected interval 120, got ${String(def?.intervalSeconds)}`);
  assert(
    def?.maxInputAgeSeconds === 600,
    `expected maxInputAge 600, got ${String(def?.maxInputAgeSeconds)}`,
  );
}

/**
 * Case 2 — a row exists with all five override columns NULL: identical to
 * case 1.
 *
 * **This is the case that proves migration 0037 changed no existing meaning.**
 * Every `asset_points` row in the estate is exactly this shape.
 */
export async function assertAllNullRowIsIdenticalToNoRow(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId, measuredKey } = await seedVersion(db, fx, 1, "02");
  await writeOverrideRow(db, assetId, {});

  const def = await loadDerived(db, assetId, measuredKey);
  assert(def !== undefined, "an all-NULL asset_points row must not suppress the definition");
  assert(def?.trigger === "scheduled", `expected inherited trigger scheduled, got ${String(def?.trigger)}`);
  assert(
    def?.intervalSeconds === 120,
    `expected inherited interval 120, got ${String(def?.intervalSeconds)} — a NULL override ` +
      "must inherit, not blank the template value",
  );
  assert(
    def?.maxInputAgeSeconds === 600,
    `expected inherited maxInputAge 600, got ${String(def?.maxInputAgeSeconds)}`,
  );
}

/**
 * Case 3 — one column overridden, the rest NULL, once per column.
 *
 * The point of running it five times rather than once is that a *row*-level
 * rather than column-level coalesce passes the single-column check on whichever
 * column the author happened to pick, and blanks the other four.
 */
export async function assertEachColumnOverridesIndependently(
  pool: pg.Pool,
  fx: Fixtures,
  runCleanup: (pool: pg.Pool) => Promise<void>,
): Promise<void> {
  const db = createDb(pool);

  // formula alone
  {
    await runCleanup(pool);
    const { assetId, measuredKey } = await seedVersion(db, fx, 1, "03A");
    await writeOverrideRow(db, assetId, { formula: `{${fx.pointKeys[0].code}} * 3` });
    const def = await loadDerived(db, assetId, measuredKey);
    assert(def !== undefined, "overriding formula alone must still yield a definition");
    assert(
      def?.trigger === "scheduled" && def?.intervalSeconds === 120 && def?.maxInputAgeSeconds === 600,
      "overriding formula must leave trigger, interval and maxInputAge inherited — got " +
        `${String(def?.trigger)}/${String(def?.intervalSeconds)}/${String(def?.maxInputAgeSeconds)}`,
    );
  }

  // calcIntervalSeconds alone
  {
    await runCleanup(pool);
    const { assetId, measuredKey } = await seedVersion(db, fx, 1, "03B");
    await writeOverrideRow(db, assetId, { calcIntervalSeconds: 900 });
    const def = await loadDerived(db, assetId, measuredKey);
    assert(
      def?.intervalSeconds === 900,
      `overriding calcIntervalSeconds must win: expected 900, got ${String(def?.intervalSeconds)}`,
    );
    assert(
      def?.trigger === "scheduled" && def?.maxInputAgeSeconds === 600,
      "the other four must stay inherited",
    );
  }

  // maxInputAgeSeconds alone
  {
    await runCleanup(pool);
    const { assetId, measuredKey } = await seedVersion(db, fx, 1, "03C");
    await writeOverrideRow(db, assetId, { maxInputAgeSeconds: 30 });
    const def = await loadDerived(db, assetId, measuredKey);
    assert(
      def?.maxInputAgeSeconds === 30,
      `overriding maxInputAgeSeconds must win: expected 30, got ${String(def?.maxInputAgeSeconds)}`,
    );
    assert(def?.intervalSeconds === 120, "interval must stay inherited");
  }

  // formulaDialect alone — the same literal, so the definition stays usable.
  {
    await runCleanup(pool);
    const { assetId, measuredKey } = await seedVersion(db, fx, 1, "03D");
    await writeOverrideRow(db, assetId, { formulaDialect: "bms-calc-v1" });
    const def = await loadDerived(db, assetId, measuredKey);
    assert(def !== undefined, "overriding formulaDialect with the same dialect must stay usable");
    assert(def?.intervalSeconds === 120, "interval must stay inherited");
  }

  // calcTrigger alone — to streaming, which also drops the interval. Overriding
  // the trigger without the interval is exactly D-1's rejected write; the
  // engine's own view of it is `interval_on_streaming` if the interval is still
  // inherited, so this fixture overrides both to assert the merged pair.
  {
    await runCleanup(pool);
    const { assetId, measuredKey } = await seedVersion(db, fx, 1, "03E", {
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
    });
    await writeOverrideRow(db, assetId, {});
    const def = await loadDerived(db, assetId, measuredKey);
    assert(
      def?.trigger === "streaming",
      `expected inherited trigger streaming, got ${String(def?.trigger)}`,
    );
    assert(def?.intervalSeconds === null, "a streaming definition must carry no interval");
  }
}

/** Case 4 — all five overridden: nothing comes from the template. */
export async function assertFullOverrideTakesNothingFromTemplate(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId, measuredKey } = await seedVersion(db, fx, 1, "04");
  await writeOverrideRow(db, assetId, {
    formula: `{${fx.pointKeys[0].code}} + 7`,
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 45,
    maxInputAgeSeconds: 90,
  });

  const def = await loadDerived(db, assetId, measuredKey);
  assert(def !== undefined, "a fully overridden point must resolve");
  assert(def?.intervalSeconds === 45, `expected 45, got ${String(def?.intervalSeconds)}`);
  assert(def?.maxInputAgeSeconds === 90, `expected 90, got ${String(def?.maxInputAgeSeconds)}`);
  assert(
    def?.intervalSeconds !== 120 && def?.maxInputAgeSeconds !== 600,
    "no template value may survive a full override",
  );
}

/** Case 5 — an override on asset A does not leak to asset B on the same version. */
export async function assertOverrideDoesNotLeakBetweenAssets(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { templateId, assetId: assetA, measuredKey } = await seedVersion(db, fx, 1, "05A");

  const [assetB] = await db
    .insert(assets)
    .values({
      code: `${TEST_ASSET_PREFIX}05B`,
      name: "Merge Fixture Asset B",
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId,
    })
    .returning({ id: assets.id });

  await writeOverrideRow(db, assetA, { calcIntervalSeconds: 45 });

  const svc = new CalcDefinitionsService(db, new MetricsService());
  const defA = (await svc.getDefinitionsForInput(assetA, measuredKey)).find(
    (d) => d.pointKey === DERIVED_KEY,
  );
  const defB = (await svc.getDefinitionsForInput(assetB.id, measuredKey)).find(
    (d) => d.pointKey === DERIVED_KEY,
  );

  assert(defA?.intervalSeconds === 45, `asset A must see its override, got ${String(defA?.intervalSeconds)}`);
  assert(
    defB?.intervalSeconds === 120,
    "asset B must still inherit the template interval — the join condition must include " +
      `asset_id, not point_key alone. Got ${String(defB?.intervalSeconds)}`,
  );
}

/**
 * Case 6 — two assets on *different* versions of the same code resolve against
 * their own pins.
 *
 * `assets.templateId` points at a version row, so this is really a check that
 * the merge did not accidentally widen the join to the template *code*.
 */
export async function assertEachAssetResolvesAgainstItsOwnPin(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, 1, "06A");
  const v2 = await seedVersion(db, fx, 2, "06B", { calcIntervalSeconds: 300 });

  const svc = new CalcDefinitionsService(db, new MetricsService());
  const defV1 = (await svc.getDefinitionsForInput(v1.assetId, v1.measuredKey)).find(
    (d) => d.pointKey === DERIVED_KEY,
  );
  const defV2 = (await svc.getDefinitionsForInput(v2.assetId, v2.measuredKey)).find(
    (d) => d.pointKey === DERIVED_KEY,
  );

  assert(defV1?.intervalSeconds === 120, `v1 asset must see 120, got ${String(defV1?.intervalSeconds)}`);
  assert(defV2?.intervalSeconds === 300, `v2 asset must see 300, got ${String(defV2?.intervalSeconds)}`);
}

/**
 * Case 7 (D-2) — `active = false` on the `asset_points` row does not suppress
 * evaluation.
 *
 * `active` governs telemetry *mapping*: whether ingest writes through this row.
 * A calc definition is configuration, not wiring, and filtering on `active`
 * here would let deactivating a mapping silently stop a formula — the failure
 * mode ADR 0037 decision 9 exists to prevent.
 */
export async function assertInactiveRowStillResolves(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { assetId, measuredKey } = await seedVersion(db, fx, 1, "07");
  await writeOverrideRow(db, assetId, { calcIntervalSeconds: 45 }, { active: false });

  const def = await loadDerived(db, assetId, measuredKey);
  assert(
    def !== undefined,
    "an inactive asset_points row must not suppress the calc definition (D-2)",
  );
  assert(
    def?.intervalSeconds === 45,
    `an inactive row's override must still apply, got ${String(def?.intervalSeconds)}`,
  );
}

/**
 * Case 8 — a measured template point with an override present is still not a
 * calc definition.
 *
 * `kind` is the one column the merge does not coalesce. If it ever were,
 * writing calc columns onto an `asset_points` row would let an asset
 * unilaterally turn a physical measured tag into a computed one, and the row
 * ingest writes into would start being overwritten by a formula.
 */
export async function assertMeasuredPointIsNeverActivatedByAnOverride(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId, measuredKey } = await seedVersion(db, fx, 1, "08");
  await writeOverrideRow(
    db,
    assetId,
    {
      formula: `{${fx.pointKeys[0].code}} * 5`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
    },
    { pointKey: MEASURED_TEMPLATE_KEY },
  );

  const svc = new CalcDefinitionsService(db, new MetricsService());
  const defs = await svc.getDefinitionsForInput(assetId, measuredKey);
  assert(
    !defs.some((d) => d.pointKey === MEASURED_TEMPLATE_KEY),
    "a measured template point must never become a calc definition, however fully its " +
      "asset_points row is populated — kind is not coalesced",
  );
  assert(
    defs.some((d) => d.pointKey === DERIVED_KEY),
    "the derived point must still resolve — this assertion is otherwise vacuous",
  );
}
