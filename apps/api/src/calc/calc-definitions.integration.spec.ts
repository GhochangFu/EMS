import { eq } from "drizzle-orm";
import type pg from "pg";

import { assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { MetricsService } from "../observability/metrics.service";
import { CalcDefinitionsService } from "./calc-definitions.service";
import type { CalcInputSample } from "./calc-inputs";
import { runScheduledSweep, type CalcSchedulerDeps } from "./calc-scheduler.service";
import { CalcScopeService } from "./calc-scope.service";
import { CalcStatusRegistry } from "./calc-status.registry";
import type { CalcWriteInput } from "./calc-write.service";

/**
 * `F2.4` — `CalcDefinitionsService` against a real database. Reuses
 * `loadFixtures` from the `F2.2` instantiation suite for org/location/point-key
 * setup, then writes `asset_templates`/`template_points`/`assets` rows
 * directly rather than through the admin service or the publish/instantiate
 * flow — this suite is about what the loader does with rows already in the
 * database, not about how they got there.
 */

const TEST_TEMPLATE_CODE = "F24-CALCDEF-TEST";
const TEST_ASSET_PREFIX = "F24-CALCDEF-TEST-";

/**
 * `F3.42` — the derived codes this fixture invents, exported so the lifecycle
 * file can register them in `bms.point_keys` first. Migration `0058` makes
 * `template_points.point_key` a foreign key and these exist in no catalog; the
 * measured input is `fx.pointKeys[0]`, a real catalog row, so it needs nothing.
 *
 * Kept beside the literals rather than replacing all eleven of them: a code
 * added below and forgotten here fails loudly on the constraint, so the two
 * cannot drift silently.
 */
export const FIXTURE_DERIVED_POINT_KEYS = [
  "CALCDEF_VALID_STREAMING",
  "CALCDEF_VALID_SCHEDULED",
  "CALCDEF_NO_TRIGGER",
  "CALCDEF_V2_SITE_SUM",
  "CALCDEF_SCHEDULED_ONLY",
  // `F2.9` — the derived-sibling refusal fixture below. `CALCDEF_CYCLE_A` is
  // registered once and used twice: derived on one template, **measured** on
  // the other, which is the per-asset half of the check.
  "CALCDEF_CYCLE_A",
  "CALCDEF_CYCLE_B",
  "CALCDEF_HEALTHY",
  "CALCDEF_V2_ON_DERIVED",
  "CALCDEF_XREF_USER",
];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_CODE}%`]);
}

/**
 * One published template carrying every case `toActiveDefinition` branches
 * on, plus one asset instantiated from it (`assets.templateId` set) — the
 * fact `CalcDefinitionsService`'s join depends on.
 */
async function seedTemplate(
  db: BmsDb,
  fx: Fixtures,
): Promise<{ templateId: string; assetId: string }> {
  const measuredKey = fx.pointKeys[0].code;
  // `F2.9`: a second measured key referenced by a **scheduled** formula and by
  // nothing streaming. `getInputKeys()` must not carry it — see the assertion
  // in `assertLoaderResolvesValidRowsAndSkipsInvalidOnes`. It cannot be
  // `measuredKey`, which the streaming formula references and so stays indexed
  // whatever the scheduled ones do.
  const scheduledOnlyKey = fx.pointKeys[1].code;
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version: 1,
      name: "Calc Definitions Fixture",
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
      pointKey: "CALCDEF_VALID_STREAMING",
      kind: "derived",
      formula: `{${measuredKey}}`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      sortOrder: 1,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: "CALCDEF_VALID_SCHEDULED",
      kind: "derived",
      formula: `{${measuredKey}} * 2`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 120,
      sortOrder: 2,
    },
    {
      // Every existing derived row is exactly this shape until an author
      // sets calc_trigger under F2.4 — the case the loader must not assume a
      // default trigger for.
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: "CALCDEF_NO_TRIGGER",
      kind: "derived",
      formula: `{${measuredKey}}`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: null,
      sortOrder: 3,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: scheduledOnlyKey,
      kind: "measured",
      sortOrder: 4,
    },
    {
      // `F2.9` — the first stored `bms-calc-v2` row. Scheduled by decision 10.
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: "CALCDEF_V2_SITE_SUM",
      kind: "derived",
      formula: `sum({${measuredKey}} @site)`,
      formulaDialect: "bms-calc-v2",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 300,
      minCoverageRatio: 0.8,
      sortOrder: 5,
    },
    {
      // A `v1` scheduled formula over a key nothing streaming references — the
      // re-entrancy index must leave that key out.
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: "CALCDEF_SCHEDULED_ONLY",
      kind: "derived",
      formula: `{${scheduledOnlyKey}} * 3`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 180,
      sortOrder: 6,
    },
  ]);

  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_ASSET_PREFIX}01`,
      name: "Calc Definitions Fixture Asset",
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId: template.id,
    })
    .returning({ id: assets.id });

  return { templateId: template.id, assetId: asset.id };
}

export async function assertHandCreatedAssetContributesNothing(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  await seedTemplate(db, fx);

  // A hand-created asset — templateId: null, "every seeded asset is" per the
  // column's own comment — must join to no template_points row at all, so it
  // must never appear in the loader's output regardless of what point keys
  // its own (unrelated) asset_points carry.
  const [handCreated] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_ASSET_PREFIX}HANDCREATED`,
      name: "Hand-created, no template",
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId: null,
    })
    .returning({ id: assets.id });

  const metrics = new MetricsService();
  const svc = new CalcDefinitionsService(db, metrics);
  const forHandCreated = await svc.getDefinitionsForInput(handCreated.id, fx.pointKeys[0].code);
  assert(
    forHandCreated.length === 0,
    "a hand-created asset (templateId: null) must never resolve to a calc definition",
  );
}

export async function assertLoaderResolvesValidRowsAndSkipsInvalidOnes(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seedTemplate(db, fx);
  const measuredKey = fx.pointKeys[0].code;
  const scheduledOnlyKey = fx.pointKeys[1].code;

  const metrics = new MetricsService();
  const svc = new CalcDefinitionsService(db, metrics);

  const forStreaming = await svc.getDefinitionsForInput(assetId, measuredKey);
  const streamingDef = forStreaming.find((def) => def.pointKey === "CALCDEF_VALID_STREAMING");
  assert(streamingDef !== undefined, "the valid streaming definition must be loaded and indexed by its input");
  assert(streamingDef?.trigger === "streaming", "the streaming definition must carry trigger: streaming");
  assert(streamingDef?.intervalSeconds === null, "a streaming definition must never carry an interval");

  const scheduledDef = forStreaming.find((def) => def.pointKey === "CALCDEF_VALID_SCHEDULED");
  assert(scheduledDef !== undefined, "the valid scheduled definition must be loaded and indexed by its input");
  assert(scheduledDef?.intervalSeconds === 120, "the scheduled definition must carry its configured interval");

  const noTriggerDef = forStreaming.find((def) => def.pointKey === "CALCDEF_NO_TRIGGER");
  assert(
    noTriggerDef === undefined,
    "a derived row with calc_trigger: null must never be loaded, regardless of a valid formula",
  );

  const scheduled = await svc.getScheduledDefinitions();
  assert(
    scheduled.some((def) => def.pointKey === "CALCDEF_VALID_SCHEDULED"),
    "getScheduledDefinitions must include the scheduled definition",
  );
  assert(
    !scheduled.some((def) => def.pointKey === "CALCDEF_VALID_STREAMING"),
    "getScheduledDefinitions must not include a streaming definition",
  );

  // ---- `F2.9`: the first stored `bms-calc-v2` row resolves, carrying its cross ref --

  const v2Def = scheduled.find((def) => def.pointKey === "CALCDEF_V2_SITE_SUM");
  assert(
    v2Def !== undefined,
    `getScheduledDefinitions must include the v2 definition — the loader resolves it and the ` +
      `scheduled sweep evaluates it. Formula: sum({${measuredKey}} @site)`,
  );
  assert(
    v2Def?.dialect === "bms-calc-v2",
    `the v2 definition must carry its own dialect, got ${String(v2Def?.dialect)}`,
  );
  assert(
    v2Def?.crossRefs.length === 1,
    `the site sum is one cross reference, got ${String(v2Def?.crossRefs.length)}`,
  );
  assert(v2Def?.minCoverageRatio === 0.8, `min_coverage_ratio must round-trip, got ${String(v2Def?.minCoverageRatio)}`);

  // ---- the re-entrancy index carries streaming inputs only (ADR 0037 decision 11) ---

  const inputKeys = await svc.getInputKeys();
  assert(
    [...inputKeys].some((key) => key === `${assetId}:${measuredKey}`),
    "getInputKeys must include the measured point both derived formulas reference",
  );
  assert(
    !inputKeys.has(`${assetId}:${scheduledOnlyKey}`),
    `getInputKeys must not carry ${scheduledOnlyKey} — only a **scheduled** formula reads it, and ` +
      "the set exists to decide which of the engine's own writes may wake the streaming host " +
      "(ADR 0037 decision 11). Indexing a scheduled formula's inputs widens that filter for no " +
      "gain: the streaming host skips a scheduled definition anyway.",
  );
}

/**
 * `E7.1b` — why the calc cache read must be on fleet. `CalcDefinitionsService`
 * reads the cross-org cache on `fleetDb`; the fix moved it off `TENANT_DRIZZLE`
 * (ADR 0043 Amendment 3 — a system cache with no JWT and no org context). Had it
 * stayed on the bare tenant pool, the 0047 FORCE policy on
 * `assets`/`template_points`/`asset_points` would return nothing with no GUC set,
 * and the engine would compute no derived telemetry at all. A fleet-backed loader
 * resolves the seeded formula; a tenant-pool-backed one resolves nothing.
 *
 * A necessity proof, not a wiring guard: it constructs the service with explicit
 * pools, so the `@Inject(FLEET_DRIZZLE)` token itself is gated by
 * `database/fleet-read-wiring.test.ts`, not here.
 */
export async function assertLoaderGoesDarkOnBareTenantPool(
  fleetPool: pg.Pool,
  tenantPool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const fleetDb = createDb(fleetPool);
  const { assetId } = await seedTemplate(fleetDb, fx);
  const measuredKey = fx.pointKeys[0].code;

  const fleetSvc = new CalcDefinitionsService(fleetDb, new MetricsService());
  const onFleet = await fleetSvc.getDefinitionsForInput(assetId, measuredKey);
  assert(
    onFleet.some((def) => def.pointKey === "CALCDEF_VALID_STREAMING"),
    "the fleet-backed loader must resolve the seeded derived formula (positive control)",
  );

  const tenantSvc = new CalcDefinitionsService(createDb(tenantPool), new MetricsService());
  const onTenant = await tenantSvc.getDefinitionsForInput(assetId, measuredKey);
  assert(
    onTenant.length === 0,
    `a bare tenant pool must resolve no calc definitions under 0047 FORCE, got ${onTenant.length}`,
  );
  const scheduled = await tenantSvc.getScheduledDefinitions();
  assert(
    !scheduled.some((def) => def.pointKey === "CALCDEF_VALID_SCHEDULED"),
    "a bare tenant pool must schedule no derived formulas",
  );
}

export async function assertCacheIsNotReReadWithinTtl(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seedTemplate(db, fx);
  const measuredKey = fx.pointKeys[0].code;

  const metrics = new MetricsService();
  const svc = new CalcDefinitionsService(db, metrics);

  await svc.getInputKeys();
  const first = await svc.getDefinitionsForInput(assetId, measuredKey);
  assert(first.length === 2, `expected 2 definitions before the mutation, got ${first.length}`);

  // Delete one derived point directly, bypassing replacePoints — the cache
  // must not notice within its 60s TTL.
  await db.delete(templatePoints).where(eq(templatePoints.pointKey, "CALCDEF_VALID_SCHEDULED"));

  const second = await svc.getDefinitionsForInput(assetId, measuredKey);
  assert(
    second.length === 2,
    `the 60s cache must not re-read within its TTL — expected 2 definitions still, got ${second.length}`,
  );

  // `F2.9` — the exact complement, and the only guard on what "fresh" means.
  // `getAllDefinitionsFresh()` is the save-time cycle detector's read (Task 12):
  // it must see the database as it is *now*, because a detector answering from a
  // cache up to 60s old would admit a formula that closes a loop against a
  // definition written in that window. Run after the cached read above, since
  // this call resets the TTL.
  const fresh = await svc.getAllDefinitionsFresh();
  assert(
    !fresh.some((def) => def.pointKey === "CALCDEF_VALID_SCHEDULED"),
    "getAllDefinitionsFresh must bypass the cache and reflect the deleted row",
  );
  assert(
    fresh.some((def) => def.pointKey === "CALCDEF_VALID_STREAMING"),
    "getAllDefinitionsFresh must still return the rows that remain — a read that returned " +
      "nothing would pass the assertion above while proving nothing",
  );
}

// ---------------------------------------------------------------------------
// `F2.9` — a `v1` definition may never reference a derived point on its own
// asset (ADR 0036 decision 7, frozen for `v1` by ADR 0055 decision 3)
// ---------------------------------------------------------------------------

const CYCLE_TEMPLATE_CODE = `${TEST_TEMPLATE_CODE}-CYCLE`;
const XREF_TEMPLATE_CODE = `${TEST_TEMPLATE_CODE}-XREF`;
/** Any instant; the fixture's samples are stamped with it, so every input is
 * fresh against the 300s default `max_input_age_seconds` the rows inherit. */
const SWEEP_NOW_MS = 1_767_000_000_000;

/**
 * Two templates, two assets, and the state no write path can produce — which is
 * the point. A `v1` label on a formula that reads a derived point arrives by
 * template migration repointing `assets.template_id` without re-validating the
 * surviving override (plan finding 34), so the fixture writes the rows directly
 * rather than through `replacePoints`, which would refuse them.
 *
 * On the **cycle** asset: `CALCDEF_CYCLE_A` and `CALCDEF_CYCLE_B` read each
 * other — two hops, which the one-hop self-reference backstop (`f2f0023`) does
 * not see, and which compound every tick. Beside them, two definitions that
 * must survive: `CALCDEF_HEALTHY` (`v1` over a measured point — every stock
 * derived point is this shape) and `CALCDEF_V2_ON_DERIVED` (`v2`, which ADR
 * 0055 decision 7 allows to read a derived point).
 *
 * On the **xref** asset: `CALCDEF_CYCLE_A` again, declared **measured** there,
 * read by a `v1` formula. A derived-key set built globally rather than per
 * asset would refuse it.
 */
async function seedDerivedSiblingTemplates(
  db: BmsDb,
  fx: Fixtures,
): Promise<{ cycleAssetId: string; xrefAssetId: string; measuredKey: string }> {
  const measuredKey = fx.pointKeys[0].code;
  const [cycleTemplate] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: CYCLE_TEMPLATE_CODE,
      version: 1,
      name: "Derived-sibling refusal fixture",
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    {
      organizationId: fx.organizationId,
      templateId: cycleTemplate.id,
      pointKey: measuredKey,
      kind: "measured",
      sortOrder: 0,
    },
    {
      organizationId: fx.organizationId,
      templateId: cycleTemplate.id,
      pointKey: "CALCDEF_CYCLE_A",
      kind: "derived",
      formula: "{CALCDEF_CYCLE_B} + 1",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      sortOrder: 1,
    },
    {
      organizationId: fx.organizationId,
      templateId: cycleTemplate.id,
      pointKey: "CALCDEF_CYCLE_B",
      kind: "derived",
      formula: "{CALCDEF_CYCLE_A} + 1",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      sortOrder: 2,
    },
    {
      organizationId: fx.organizationId,
      templateId: cycleTemplate.id,
      pointKey: "CALCDEF_HEALTHY",
      kind: "derived",
      formula: `{${measuredKey}} * 2`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      sortOrder: 3,
    },
    {
      organizationId: fx.organizationId,
      templateId: cycleTemplate.id,
      pointKey: "CALCDEF_V2_ON_DERIVED",
      kind: "derived",
      formula: "{CALCDEF_HEALTHY} * 2",
      formulaDialect: "bms-calc-v2",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      sortOrder: 4,
    },
  ]);

  const [xrefTemplate] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: XREF_TEMPLATE_CODE,
      version: 1,
      name: "Same key, measured on another template",
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    {
      organizationId: fx.organizationId,
      templateId: xrefTemplate.id,
      pointKey: "CALCDEF_CYCLE_A",
      kind: "measured",
      sortOrder: 0,
    },
    {
      organizationId: fx.organizationId,
      templateId: xrefTemplate.id,
      pointKey: "CALCDEF_XREF_USER",
      kind: "derived",
      formula: "{CALCDEF_CYCLE_A} * 5",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      sortOrder: 1,
    },
  ]);

  const inserted = await db
    .insert(assets)
    .values([
      {
        organizationId: fx.organizationId,
        code: `${TEST_ASSET_PREFIX}CYCLE01`,
        name: "Derived-sibling fixture asset",
        siteName: "Fixture Site",
        locationId: fx.otherLocationId,
        domain: "electrical",
        templateId: cycleTemplate.id,
      },
      {
        organizationId: fx.organizationId,
        code: `${TEST_ASSET_PREFIX}XREF01`,
        name: "Same-key-measured fixture asset",
        siteName: "Fixture Site",
        locationId: fx.otherLocationId,
        domain: "electrical",
        templateId: xrefTemplate.id,
      },
    ])
    .returning({ id: assets.id, code: assets.code });

  const cycleAssetId = inserted.find((a) => a.code === `${TEST_ASSET_PREFIX}CYCLE01`)?.id;
  const xrefAssetId = inserted.find((a) => a.code === `${TEST_ASSET_PREFIX}XREF01`)?.id;
  if (!cycleAssetId || !xrefAssetId) {
    throw new Error("both fixture assets must be inserted");
  }
  return { cycleAssetId, xrefAssetId, measuredKey };
}

/** The value of one labelled series, e.g. `reason="v1_references_derived"`. */
function labelledSeriesValue(text: string, metricName: string, label: string): number | undefined {
  const line = text.split("\n").find((l) => l.startsWith(metricName) && l.includes(label) && !l.startsWith("#"));
  const match = line?.match(/\s(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export async function assertV1ReferencingADerivedSiblingIsRefused(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { cycleAssetId, xrefAssetId } = await seedDerivedSiblingTemplates(db, fx);

  const metrics = new MetricsService();
  const svc = new CalcDefinitionsService(db, metrics);
  // One read, so the counter below reflects exactly one reload.
  const scheduled = await svc.getScheduledDefinitions();
  const onCycleAsset = scheduled.filter((def) => def.assetId === cycleAssetId);

  for (const refused of ["CALCDEF_CYCLE_A", "CALCDEF_CYCLE_B"]) {
    assert(
      !onCycleAsset.some((def) => def.pointKey === refused),
      `${refused} is a v1 formula reading a derived point on its own asset — ADR 0036 decision 7 ` +
        "bans it at save and ADR 0055 decision 3 freezes that ban, so the loader must refuse the " +
        "stored row too. Two such rows reference each other and compound every tick.",
    );
  }

  // The refusal must happen **before** the input index, or the definition stays
  // reachable through the streaming host's own path while looking refused here.
  const byInput = await svc.getDefinitionsForInput(cycleAssetId, "CALCDEF_CYCLE_B");
  assert(
    byInput.length === 0,
    `a refused definition must not be indexed by its inputs either, got ${byInput.length} — ` +
      "filtering after the index build leaves getDefinitionsForInput serving the runaway",
  );

  // ---- the over-refusal guards -------------------------------------------------

  assert(
    onCycleAsset.some((def) => def.pointKey === "CALCDEF_HEALTHY"),
    "a v1 formula over a measured sibling must stay active — that is every derived point in the " +
      "stock catalog, and refusing it would take the calc engine down",
  );
  const v2OnDerived = onCycleAsset.find((def) => def.pointKey === "CALCDEF_V2_ON_DERIVED");
  assert(
    v2OnDerived?.dialect === "bms-calc-v2",
    "a v2 formula may read a derived point (ADR 0055 decision 7) — the sweep orders it after the " +
      `point it reads and refuses only a cycle, never this loader, got ${String(v2OnDerived?.dialect)}`,
  );
  assert(
    scheduled.some((def) => def.assetId === xrefAssetId && def.pointKey === "CALCDEF_XREF_USER"),
    "CALCDEF_CYCLE_A is measured on this asset's template and derived on the other one. The " +
      "derived key set is per asset; a global set would refuse this formula and break cross-asset " +
      "work before PR 2 starts.",
  );

  // ---- counted, never silent (ADR 0037 decision 9) --------------------------------

  const skipped = await metrics.registry.getSingleMetricAsString("bms_api_calc_skipped_total");
  assert(
    labelledSeriesValue(skipped, "bms_api_calc_skipped_total", 'reason="v1_references_derived"') === 2,
    `both refusals must be counted under their own reason after one reload, got: ${skipped}`,
  );
}

export async function assertTheTwoHopCycleWritesNothingAndTheHealthyFormulaStillWrites(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { cycleAssetId, xrefAssetId, measuredKey } = await seedDerivedSiblingTemplates(db, fx);
  const svc = new CalcDefinitionsService(db, new MetricsService());

  // The samples a compounding cycle actually reads: its own previous tick's
  // stored values. Without them the two cycle definitions would skip as
  // `missing_input` whether or not they were refused, and this test would prove
  // nothing about the refusal. The stored `CALCDEF_HEALTHY` (7) deliberately
  // differs from what this sweep computes for it (5 * 2 = 10), so the `v2`
  // formula that reads it proves *where* it read from.
  const samples = new Map<string, CalcInputSample>([
    [`${cycleAssetId}:${measuredKey}`, { value: 5, timeMs: SWEEP_NOW_MS }],
    [`${cycleAssetId}:CALCDEF_CYCLE_A`, { value: 100, timeMs: SWEEP_NOW_MS }],
    [`${cycleAssetId}:CALCDEF_CYCLE_B`, { value: 200, timeMs: SWEEP_NOW_MS }],
    [`${cycleAssetId}:CALCDEF_HEALTHY`, { value: 7, timeMs: SWEEP_NOW_MS }],
    [`${xrefAssetId}:CALCDEF_CYCLE_A`, { value: 3, timeMs: SWEEP_NOW_MS }],
  ]);

  const writes: CalcWriteInput[] = [];
  const skips: string[] = [];
  const deps: CalcSchedulerDeps = {
    definitions: svc,
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        const found = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samples.get(`${assetId}:${ref}`);
          if (sample) found.set(ref, sample);
        }
        return found;
      },
      getLatestSamplesForPairs: async () => new Map(),
    },
    // The real resolver: no definition here carries a cross reference, so it
    // answers without a query — the early return the sweep relies on for a
    // `v2` formula whose references are all local.
    scope: new CalcScopeService(db),
    writer: {
      writeValues: async (values) => {
        writes.push(...values);
        return { written: values.length, assetPointsCreated: 0 };
      },
    },
    metrics: {
      countCalcSkipped: (reason) => skips.push(reason),
      countCalcAggregateExcluded: () => undefined,
      setCalcAggregateMembersMax: () => undefined,
    },
    // `F2.9` Task 16 — a real registry, discarded: this suite is about what the
    // sweep writes to the database, and the registry's own behaviour is
    // asserted in `calc-status.registry.spec.ts` and `calc-scheduler.status.spec.ts`.
    status: new CalcStatusRegistry(),
    logger: { warn: () => undefined },
  };

  await runScheduledSweep(deps, new Map(), SWEEP_NOW_MS);

  const written = writes.filter((w) => w.assetId === cycleAssetId || w.assetId === xrefAssetId);
  const cycleWrites = written.filter((w) => w.pointKey === "CALCDEF_CYCLE_A" || w.pointKey === "CALCDEF_CYCLE_B");
  assert(
    cycleWrites.length === 0,
    `neither half of the two-hop cycle may write. Each reads the other's stored value, so a write ` +
      `here is the runaway compounding: ${JSON.stringify(cycleWrites)}`,
  );
  const healthy = written.find((w) => w.pointKey === "CALCDEF_HEALTHY");
  assert(
    healthy?.value === 10,
    `the v1 formula over a measured point on the **same asset** must still write 5 * 2 = 10 in the ` +
      `same sweep — otherwise the assertion above only proves the sweep is broken, got ${String(healthy?.value)}`,
  );
  const xref = written.find((w) => w.pointKey === "CALCDEF_XREF_USER");
  assert(
    xref?.value === 15,
    `the other asset's v1 formula reading the same key, measured there, must write 3 * 5 = 15, ` +
      `got ${String(xref?.value)}`,
  );
  // `F2.9` Task 13: the `v2` formula over the derived sibling is evaluated —
  // ordered after `CALCDEF_HEALTHY` and reading this tick's value from the
  // overlay (10), not the stored 7. This is the first cross-derived value the
  // engine has ever computed, and it lands in the same batch as its input.
  const v2OverDerived = written.find((w) => w.pointKey === "CALCDEF_V2_ON_DERIVED");
  assert(
    v2OverDerived?.value === 20,
    `the v2 formula reading the derived sibling must write (5 * 2) * 2 = 20 from the overlay — ` +
      `14 would mean it read the stored 7, absent would mean it was refused; got ` +
      `${String(v2OverDerived?.value)}, skips: ${JSON.stringify(skips)}`,
  );
  assert(
    !skips.includes("dependency_cycle"),
    `the refused v1 pair never reaches the sweep, so the sweep sees no cycle to count, got skips: ` +
      `${JSON.stringify(skips)}`,
  );
  assert(
    !skips.includes("v1_references_derived"),
    "the loader's refusal is counted in the loader's metrics, never in the sweep's — a definition " +
      `it refused never reaches the sweep at all, got skips: ${JSON.stringify(skips)}`,
  );
}
