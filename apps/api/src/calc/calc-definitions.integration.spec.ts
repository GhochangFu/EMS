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

  const inputKeys = await svc.getInputKeys();
  assert(
    [...inputKeys].some((key) => key === `${assetId}:${measuredKey}`),
    "getInputKeys must include the measured point both derived formulas reference",
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
}
