import { eq } from "drizzle-orm";
import type pg from "pg";

import { assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { MetricsService } from "../observability/metrics.service";
import { CalcDefinitionsService } from "./calc-definitions.service";

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
    `getScheduledDefinitions must include the v2 definition — it is stored and validated in ` +
      `PR 1 even though nothing evaluates it yet. Formula: sum({${measuredKey}} @site)`,
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
