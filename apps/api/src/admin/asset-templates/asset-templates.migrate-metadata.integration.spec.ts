import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetPoints, assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  CALC_DIALECT_V2,
  POINT_METADATA_FIELDS,
  templateMigrationPreviewResponseSchema,
} from "@bms/shared";
import type { PointMetadataFields, TemplateMigrationRefusalDto } from "@bms/shared";

import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";

/**
 * `F2.24` — what a template version bump does to the five instrument-metadata
 * defaults (ADR 0056 decision 1), as `migration-preview` reports it; and
 * `F2.30` — what `migrate` does when the target's default would invert an
 * asset's own stored override (refusal `metadata_override_invalid_on_target`).
 *
 * ## A sibling file, not more cases in the override suite
 *
 * `asset-templates.migrate-override.integration.spec.ts` is 860 lines against
 * AGENTS.md §4.5's cap, and its subject is the calc override. This one is the
 * measured side: the class default a measured point carries, and whether the
 * service reads it at all.
 *
 * ## Why an integration case and not only the pure one
 *
 * `computeTemplateVersionDelta` is proved in its own spec. What it cannot prove
 * is that `AssetTemplateMigrationService.loadPoints` *projects* the five: a
 * projection that forgot one hands the delta `undefined` on both sides, which
 * compares equal, and the change goes unreported exactly as before `F2.24`.
 * Only a stored row read through the service can see that.
 */

/**
 * Per-run fixture codes, not constants — `cleanup` sweeps by prefix, and two
 * instances of this file against one database must not delete each other's
 * rows (`tests/integration-fixture-isolation.test.ts`).
 */
export const TEST_TEMPLATE_CODE = `F224-MIGMD-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
export const TEST_ASSET_PREFIX = `F224-MIGMD-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}-`;

/** Point keys owned by this suite alone (FK onto `point_keys(code)`, `0057`/`0058`). */
export const MEASURED_KEY = "F224_KW";
export const DERIVED_KEY = "F224_AGG";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT id FROM bms.asset_templates WHERE code LIKE $1)`,
    [`${TEST_TEMPLATE_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [
    `${TEST_TEMPLATE_CODE}%`,
  ]);
}

// --- fixture builders -------------------------------------------------------

/**
 * One published version: one measured point carrying `measuredMetadata` as its
 * class defaults, and one derived point identical in every version.
 *
 * Inserted straight through Drizzle, as the migrate suites seed their versions:
 * the subject is what migrate reads from a stored version, not which shapes the
 * authoring path accepts today.
 */
async function seedVersion(
  db: BmsDb,
  fx: Fixtures,
  opts: { version: number; measuredMetadata?: Partial<PointMetadataFields> },
): Promise<string> {
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version: opts.version,
      name: `Migrate Metadata Fixture v${opts.version}`,
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
      pointKey: MEASURED_KEY,
      kind: "measured",
      // Identical across versions: a changed pattern is `measured_rekeyed`.
      sourceDataKeyPattern: `SITE/{asset_code}/${MEASURED_KEY}`,
      required: true,
      sortOrder: 0,
      ...opts.measuredMetadata,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: DERIVED_KEY,
      kind: "derived",
      sourceDataKeyPattern: null,
      required: true,
      formula: `{${MEASURED_KEY}} * 2`,
      formulaDialect: CALC_DIALECT_V2,
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: 300,
      sortOrder: 1,
    },
  ]);

  return template.id;
}

async function seedAsset(
  db: BmsDb,
  fx: Fixtures,
  suffix: string,
  templateId: string,
): Promise<string> {
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: `Migrate Metadata Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId,
    })
    .returning({ id: assets.id });
  return asset.id;
}

/**
 * A per-asset metadata override on the measured point.
 *
 * `source_kind = 'manual'` with a `manual` source key and no `rtu_id`:
 * `asset_points_source_ref_check` requires an RTU for `measured`, and the
 * subject here is the five columns, not the wiring.
 */
async function seedOverrideRow(
  db: BmsDb,
  fx: Fixtures,
  assetId: string,
  override: Partial<PointMetadataFields>,
): Promise<void> {
  await db.insert(assetPoints).values({
    assetId,
    organizationId: fx.organizationId,
    pointKey: MEASURED_KEY,
    sourceDataKey: "manual",
    sourceKind: "manual",
    rtuId: null,
    active: true,
    unit: null,
    ...override,
  });
}

// --- independent SQL readers ------------------------------------------------

export async function pinnedVersion(pool: pg.Pool, assetId: string): Promise<number | null> {
  const { rows } = await pool.query<{ version: number | null }>(
    `SELECT t.version FROM bms.assets a
       LEFT JOIN bms.asset_templates t ON t.id = a.template_id
      WHERE a.id = $1`,
    [assetId],
  );
  return rows[0]?.version ?? null;
}

// --- cases ------------------------------------------------------------------

/**
 * **The case the backlog row names.** A version bump that changes only one
 * measured default is reported by `migration-preview`, not "no changes".
 *
 * The mutation this reddens: drop one of the five from `loadPoints`'s
 * projection — the delta then sees `undefined` on both sides and the entry is
 * missing.
 */
export async function assertAMetadataDefaultOnlyChangeIsReportedByPreview(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, measuredMetadata: { scaleMultiplier: null } });
  const v2 = await seedVersion(db, fx, { version: 2, measuredMetadata: { scaleMultiplier: 10 } });
  const asset = await seedAsset(db, fx, "META", v1);

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [asset] }),
  );
  const delta = preview.deltas.find((d) => d.fromVersion === 1 && d.toVersion === 2);
  assert(delta !== undefined, "the preview must carry a delta for the version pair");

  const changed = delta?.measuredMetadataChanged.find((c) => c.pointKey === MEASURED_KEY);
  assert(
    changed !== undefined,
    `migration-preview reported no metadata change at all, got ` +
      `${JSON.stringify(delta?.measuredMetadataChanged)}. Every other field of this point is ` +
      `identical between the two versions, so the operator is told "nothing changes" about a ` +
      `migration that multiplies every sample by 10 (F2.24).`,
  );
  assert(
    JSON.stringify(changed?.changedFields) === JSON.stringify(["scaleMultiplier"]),
    `the change must name scaleMultiplier alone, got ${JSON.stringify(changed?.changedFields)}`,
  );
  assert(
    changed?.from.scaleMultiplier === null && changed?.to.scaleMultiplier === 10,
    `both sides must reach the operator: expected null -> 10, got ` +
      `${String(changed?.from.scaleMultiplier)} -> ${String(changed?.to.scaleMultiplier)}`,
  );
  assert(
    preview.canApply === true && preview.refusals.length === 0,
    "a metadata-default change is reported, never refused — decision 3 refuses wiring only",
  );
  assert(
    (await pinnedVersion(pool, asset)) === 1,
    "a preview writes nothing: the asset must still be pinned to version 1",
  );
}

/**
 * **Every one of the five is projected, not only the one the first case moves.**
 *
 * A field `loadPoints` forgets reads `undefined` in an entry's `from`/`to`,
 * and `templateMigrationPreviewResponseSchema.parse` refuses that — so the
 * parse, in every case of this file, is what reddens when one field is dropped
 * from the projection (run as a mutation: a `ZodError` naming the field). This
 * case pins the other half: v1 states none of the five and v2 states all five,
 * so the delta must *name* all five, in `POINT_METADATA_FIELDS` order.
 */
export async function assertAllFiveDefaultsAreReadByPreview(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1 });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    measuredMetadata: {
      scaleMultiplier: 0.1,
      scaleOffset: -40,
      engMin: 0,
      engMax: 100,
      qualityPolicy: "accept_bad",
    },
  });
  const asset = await seedAsset(db, fx, "ALL5", v1);

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [asset] }),
  );
  const delta = preview.deltas.find((d) => d.fromVersion === 1 && d.toVersion === 2);
  const changed = delta?.measuredMetadataChanged.find((c) => c.pointKey === MEASURED_KEY);
  assert(
    JSON.stringify(changed?.changedFields) === JSON.stringify(POINT_METADATA_FIELDS),
    `all five defaults moved, so all five must be named — a field missing here is a field ` +
      `loadPoints does not project. Got ${JSON.stringify(changed?.changedFields)}`,
  );
  assert(
    changed?.to.qualityPolicy === "accept_bad" && changed?.to.engMax === 100,
    `the target side must carry the stored values, got ${JSON.stringify(changed?.to)}`,
  );
}

async function storedEngMin(pool: pg.Pool, assetId: string): Promise<number | null | undefined> {
  const { rows } = await pool.query<{ eng_min: number | null }>(
    `SELECT eng_min FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, MEASURED_KEY],
  );
  return rows[0]?.eng_min;
}

/**
 * Runs a migration that must be refused, and returns the refusals it carried.
 * The class is asserted as well as the text: a 400 with the right words in it
 * passes every message-only check. (A copy of the override suite's helper —
 * that file is not this one's to export from.)
 */
async function expectRefusal(
  run: () => Promise<unknown>,
  what: string,
): Promise<TemplateMigrationRefusalDto[]> {
  let status: number | null = null;
  let refusals: TemplateMigrationRefusalDto[] | null = null;
  let message = "";
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    status = typeof getStatus === "function" ? getStatus.call(err) : null;
    const response = (err as { response?: unknown } | null)?.response as
      | { message?: unknown; refusals?: unknown }
      | undefined;
    refusals = Array.isArray(response?.refusals)
      ? (response?.refusals as TemplateMigrationRefusalDto[])
      : null;
    message =
      typeof response?.message === "string"
        ? response.message
        : err instanceof Error
          ? err.message
          : String(err);
  }
  assert(refusals !== null || message !== "", `${what}: expected a rejection, the call succeeded`);
  assert(
    status === 409,
    `${what}: expected HTTP 409 with a refusal body, got ${String(status)} and "${message}"`,
  );
  assert(refusals !== null, `${what}: the 409 carried no refusals array — got "${message}"`);
  return refusals ?? [];
}

/**
 * **`F2.30`, the case the row exists for.** Asset A holds `eng_min 150` — legal
 * on version 1, which sets no `eng_max`. Version 2 sets `eng_max 100`, so the
 * merged band is empty. Preview says so, `migrate` answers 409, and — read by
 * independent SQL, because no response body can see it — **no pin moves**, not
 * even the control B's in the same batch (all-or-nothing). B alone, whose
 * `eng_min 50` is legal under 100, then migrates: without that, a gate that
 * refused every row with metadata would pass every assertion above it.
 */
export async function assertAMetadataOverrideInvalidOnTargetRefusesAndPinsNothing(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, measuredMetadata: { engMax: null } });
  const v2 = await seedVersion(db, fx, { version: 2, measuredMetadata: { engMax: 100 } });
  const bad = await seedAsset(db, fx, "BAD", v1);
  const good = await seedAsset(db, fx, "GOOD", v1);
  await seedOverrideRow(db, fx, bad, { engMin: 150 });
  await seedOverrideRow(db, fx, good, { engMin: 50 });

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [bad, good] }),
  );
  assert(
    preview.canApply === false,
    "migration-preview must report canApply: false — an operator shown a green preview and " +
      "a 409 on apply has been told the server changed its mind",
  );
  const shown = preview.refusals.filter((r) => r.reason === "metadata_override_invalid_on_target");
  assert(
    shown.length === 1,
    `the preview must carry exactly one metadata refusal (A only, not B), got ` +
      `[${preview.refusals.map((r) => r.reason).join(", ")}]`,
  );
  const message = shown[0]?.message ?? "";
  assert(
    shown[0]?.pointKey === MEASURED_KEY,
    `the refusal must name the point, got ${String(shown[0]?.pointKey)}`,
  );
  assert(
    message.includes(`${TEST_ASSET_PREFIX}BAD`) && !message.includes(`${TEST_ASSET_PREFIX}GOOD`),
    `the refusal must name asset A and not B, got "${message}"`,
  );
  assert(
    message.includes("eng_min 150,") &&
      message.includes("eng_max 100 (inherited from the template)"),
    `the refusal must name both bounds and mark the inherited one, got "${message}"`,
  );

  const refusals = await expectRefusal(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [bad, good] }),
    "an override the target default inverts",
  );
  assert(
    refusals.some((r) => r.reason === "metadata_override_invalid_on_target"),
    `migrate must refuse with metadata_override_invalid_on_target, got ` +
      `[${refusals.map((r) => r.reason).join(", ")}]`,
  );
  assert(
    (await pinnedVersion(pool, bad)) === 1 && (await pinnedVersion(pool, good)) === 1,
    "a refused migrate must move no pin — A's or B's. A 409 with a pin already moved is the " +
      "failure this case exists to stop, and no assertion on the response body can see it.",
  );
  assert(
    (await storedEngMin(pool, bad)) === 150,
    "a refused migrate must leave A's override row as it was",
  );

  const alone = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [good] }),
  );
  assert(
    alone.canApply === true,
    `B alone holds a legal override and must be applicable, got ` +
      `[${alone.refusals.map((r) => r.reason).join(", ")}]`,
  );
  await svc.migrate(fx.adminJwt, v2, { assetIds: [good] });
  assert(
    (await pinnedVersion(pool, good)) === 2,
    "B alone must migrate — otherwise the gate refuses every row with metadata",
  );
}
