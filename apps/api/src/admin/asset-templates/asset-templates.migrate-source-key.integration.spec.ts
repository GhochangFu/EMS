import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetPoints, assets, createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";
import {
  assert,
  expectRejection,
  pinnedVersion,
  pointRows,
  seedVersion,
} from "./asset-templates.migrate.integration.spec";

/**
 * `F4.216` — the source-key cases of template version migration (ADR 0039).
 *
 * Beside `asset-templates.migrate.integration.spec.ts` rather than in it only
 * because that file is near the §4.5 line cap; its fixture builders and
 * independent SQL readers are imported, not restated. The two suites run in
 * parallel workers, so this one seeds under its own template code and asset
 * prefix — neither matches the other suite's `LIKE` cleanup, and neither
 * suite's cleanup can remove the other's rows mid-case. Both carry a per-run
 * suffix (`integration-fixture-isolation`), so two instances of this file do
 * not delete each other's committed rows either.
 *
 * **`point_keys` isolation.** The point-key codes are this suite's own
 * (`SK_KW`, `SK_VOLTS`, `SK_KWH`), never the `KW`/`VOLTS`/`KWH` the migrate
 * suite registers. `registerFixturePointKeys` deletes, on release, every code
 * its own call inserted; with shared codes, whichever suite registered first
 * would delete a code at its `afterAll` that the other suite's template_points
 * and asset_points still reference — a 23503 there, or a later FK failure.
 */
export const SK_TEMPLATE_CODE = `F4216-SRCKEY-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
export const SK_ASSET_PREFIX = `F4216-SK-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}-`;

export const SK_KW = "F4216SK_KW";
export const SK_VOLTS = "F4216SK_VOLTS";
export const SK_KWH = "F4216SK_KWH";
/** Every `point_keys` code this suite seeds — the wrapper registers exactly these. */
export const SK_POINT_KEYS: readonly string[] = [SK_KW, SK_VOLTS, SK_KWH];

export async function cleanupSourceKey(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${SK_ASSET_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT id FROM bms.asset_templates WHERE code = $1)`,
    [SK_TEMPLATE_CODE],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [
    `${SK_ASSET_PREFIX}%`,
  ]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code = $1`, [
    SK_TEMPLATE_CODE,
  ]);
}

/** `seedAsset`'s row under this suite's own prefix. */
async function seedSkAsset(
  db: BmsDb,
  fx: Fixtures,
  suffix: string,
  templateId: string,
): Promise<string> {
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code: `${SK_ASSET_PREFIX}${suffix}`,
      name: `Source Key Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId,
    })
    .returning({ id: assets.id });
  return asset.id;
}

/**
 * `F4.216` — a measured addition whose resolved source key another point on
 * the asset already holds is refused by name, before the transaction.
 *
 * `asset_points_asset_source_key_idx` (0015) makes `(asset_id,
 * source_data_key)` unique. The point-key check above cannot see this
 * collision — the keys differ — so before this refusal the insert raised 23505
 * inside the transaction and the route answered 500.
 *
 * `SK_VOLTS` is given a pattern that resolves to the key the hand-made `SK_KW`
 * row already reads. Both codes are registered in the point-key catalog by the
 * wrapper, so the seed passes the 0057/0058 foreign keys.
 */
export async function assertExistingSourceKeyRefusesAMeasuredAddition(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 1,
    points: [{ pointKey: SK_KW }],
  });
  const v2 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 2,
    points: [
      { pointKey: SK_KW },
      { pointKey: SK_VOLTS, sourceDataKeyPattern: `SITE/{asset_code}/${SK_KW}` },
    ],
  });
  const assetId = await seedSkAsset(db, fx, "SRCKEY", v1);
  const sharedKey = `${SK_ASSET_PREFIX}SRCKEY`;
  await db.insert(assetPoints).values({
    organizationId: fx.organizationId,
    assetId,
    pointKey: SK_KW,
    sourceDataKey: `SITE/${sharedKey}/${SK_KW}`,
    sourceKind: "unmapped",
    rtuId: null,
    active: true,
  });

  const preview = await svc.previewMigration(fx.adminJwt, v2, {
    assetIds: [assetId],
  });
  const refusal = preview.refusals.find(
    (r) => r.reason === "source_key_already_used",
  );
  assert(
    refusal !== undefined,
    `expected a source_key_already_used refusal, got ${JSON.stringify(preview.refusals)}`,
  );
  assert(
    refusal?.pointKey === SK_VOLTS,
    `the refusal must name the new point, not the holder, got ${String(refusal?.pointKey)}`,
  );
  assert(
    refusal?.message.includes("SRCKEY") === true,
    `and the asset, got: ${String(refusal?.message)}`,
  );
  assert(
    refusal?.message.includes(`"SITE/${sharedKey}/${SK_KW}"`) === true,
    `and the source key, got: ${String(refusal?.message)}`,
  );
  // Quoted forms, so a sentence that swaps the new point and the holder fails.
  assert(
    refusal?.message.includes(`adds "${SK_VOLTS}"`) === true &&
      refusal?.message.includes(`point "${SK_KW}" on this asset`) === true,
    `and which point already holds the key, got: ${String(refusal?.message)}`,
  );
  assert(
    preview.canApply === false,
    "a refusal must make the server's verdict false",
  );

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
    /source key/,
    "applying a migration whose measured addition reuses an existing source key",
    409,
  );
  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "and the asset must stay on its old pin — nothing was written",
  );
  const rows = await pointRows(pool, assetId);
  assert(
    rows.length === 1 && rows[0]?.point_key === SK_KW,
    `the existing row must be the only row, got ${JSON.stringify(rows)}`,
  );
}

/**
 * `F4.216` review — two measured additions of one version whose patterns
 * resolve to the same source key on one asset are refused at plan time.
 *
 * Neither collides with an existing row, so the existing-holder check above
 * passes both; without a check of the new points against each other, preview
 * answered `canApply: true` and apply then hit
 * `asset_points_asset_source_key_idx` inside the transaction — preview and
 * apply disagreeing for that input every time. The asset has **no**
 * `asset_points` rows at all, so the check must run for an asset the
 * existing-row read returned nothing for.
 *
 * `forbidden` on the apply is the write-time net's own sentence: the 409 must
 * be the named plan refusal, not the generic net catching it.
 */
export async function assertTwoAdditionsWithOneSourceKeyAreRefused(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 1,
    points: [{ pointKey: SK_KW }],
  });
  const sharedPattern = `SITE/{asset_code}/${SK_KWH}`;
  const v2 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 2,
    points: [
      { pointKey: SK_KW },
      { pointKey: SK_VOLTS, sourceDataKeyPattern: sharedPattern },
      { pointKey: SK_KWH, sourceDataKeyPattern: sharedPattern },
    ],
  });
  const assetId = await seedSkAsset(db, fx, "TWONEW", v1);
  const sharedKey = `SITE/${SK_ASSET_PREFIX}TWONEW/${SK_KWH}`;

  const preview = await svc.previewMigration(fx.adminJwt, v2, {
    assetIds: [assetId],
  });
  const refusals = preview.refusals.filter(
    (r) => r.reason === "source_key_already_used",
  );
  assert(
    refusals.length === 1,
    `expected exactly one source_key_already_used refusal (the second of the pair), got ` +
      JSON.stringify(preview.refusals),
  );
  const refusal = refusals[0];
  assert(
    refusal?.pointKey === SK_VOLTS || refusal?.pointKey === SK_KWH,
    `the refusal must name one of the two new points, got ${String(refusal?.pointKey)}`,
  );
  assert(
    refusal?.message.includes(`"${SK_VOLTS}"`) === true &&
      refusal?.message.includes(`"${SK_KWH}"`) === true,
    `the sentence must name both new point keys, got: ${String(refusal?.message)}`,
  );
  assert(
    refusal?.message.includes(`"${sharedKey}"`) === true,
    `and the shared source key, got: ${String(refusal?.message)}`,
  );
  assert(
    refusal?.message.includes("TWONEW") === true,
    `and the asset, got: ${String(refusal?.message)}`,
  );
  assert(
    preview.canApply === false,
    "two new points on one source key must make the server's verdict false",
  );

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
    /both resolve to source key/,
    "applying a migration whose two new points resolve to one source key",
    409,
    /added since the plan was read/,
  );
  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "and the asset must stay on its old pin — nothing was written",
  );
  const rows = await pointRows(pool, assetId);
  assert(
    rows.length === 0,
    `no asset_points row may be written, got ${JSON.stringify(rows)}`,
  );
}

/**
 * `F4.216` write-time net — the plan-to-write race.
 *
 * The plan reads `asset_points` before the transaction opens, so a row that
 * lands between the read and the insert is invisible to the refusal above.
 * The unique index still stops the write; this asserts it is answered as a
 * 409 with a sentence, not a 500, and that the rollback leaves nothing behind.
 *
 * The race is made deterministic by wrapping this instance's `buildPlan`: the
 * plan is built as normal, then the colliding row is inserted before the
 * write runs. The holder uses a different point key (`SK_KWH`) so only
 * `asset_points_asset_source_key_idx` can fire.
 */
export async function assertRacedSourceKeyAnswers409(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 1,
    points: [{ pointKey: SK_KW }],
  });
  const v2 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 2,
    points: [{ pointKey: SK_KW }, { pointKey: SK_VOLTS }],
  });
  const assetId = await seedSkAsset(db, fx, "RACE", v1);

  let raced = false;
  await withRowInsertedAfterPlan(
    svc,
    async () => {
      await db.insert(assetPoints).values({
        organizationId: fx.organizationId,
        assetId,
        pointKey: SK_KWH,
        sourceDataKey: `SITE/${SK_ASSET_PREFIX}RACE/${SK_VOLTS}`,
        sourceKind: "unmapped",
        rtuId: null,
        active: true,
      });
      raced = true;
    },
    () =>
      expectRejection(
        () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
        /source key/,
        "a migration whose new point's source key was taken after the plan read",
        409,
        /point key/,
      ),
  );
  assert(
    raced,
    "the race fixture must have inserted the colliding row after the plan",
  );
  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "and the asset must stay on its old pin — the transaction rolled back",
  );
  const rows = await pointRows(pool, assetId);
  assert(
    rows.length === 1 && rows[0]?.point_key === SK_KWH,
    `only the raced row may stand, got ${JSON.stringify(rows)}`,
  );
}

/**
 * `F4.222` — the write-time net also translates the point-key unique. A raced
 * row on the new point's **point key** (another source key) trips
 * `asset_points_asset_id_point_key_unique`; the caller gets a 409 with the
 * point-key sentence, not a 500 and not the source-key sentence, which would
 * tell the operator the wrong thing.
 */
export async function assertRacedPointKeyAnswers409(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 1,
    points: [{ pointKey: SK_KW }],
  });
  const v2 = await seedVersion(db, fx, {
    code: SK_TEMPLATE_CODE,
    version: 2,
    points: [{ pointKey: SK_KW }, { pointKey: SK_VOLTS }],
  });
  const assetId = await seedSkAsset(db, fx, "RACEPK", v1);

  let raced = false;
  await withRowInsertedAfterPlan(
    svc,
    async () => {
      await db.insert(assetPoints).values({
        organizationId: fx.organizationId,
        assetId,
        pointKey: SK_VOLTS,
        sourceDataKey: `SITE/${SK_ASSET_PREFIX}RACEPK/ELSEWHERE`,
        sourceKind: "unmapped",
        rtuId: null,
        active: true,
      });
      raced = true;
    },
    () =>
      expectRejection(
        () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
        /point key/,
        "a migration whose new point's point key was taken after the plan read",
        409,
        /source key/,
      ),
  );
  assert(
    raced,
    "the race fixture must have inserted the colliding row after the plan",
  );
  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "and the asset must stay on its old pin — the transaction rolled back",
  );
  const rows = await pointRows(pool, assetId);
  assert(
    rows.length === 1 &&
      rows[0]?.source_data_key.endsWith("/ELSEWHERE") === true,
    `only the raced row may stand, got ${JSON.stringify(rows)}`,
  );
}

/**
 * Runs `act` with this instance's private `buildPlan` wrapped so `race` runs
 * after the plan is built and before the write — the plan-to-write race, made
 * deterministic. An own property shadows the prototype method; deleting it
 * restores the shared instance for the cases that follow.
 */
async function withRowInsertedAfterPlan(
  svc: AssetTemplateMigrationService,
  race: () => Promise<void>,
  act: () => Promise<void>,
): Promise<void> {
  type BuildPlan = (...args: unknown[]) => Promise<unknown>;
  const target = svc as unknown as { buildPlan: BuildPlan };
  const original = target.buildPlan;
  target.buildPlan = async (...args: unknown[]): Promise<unknown> => {
    const plan = await original.apply(svc, args);
    await race();
    return plan;
  };
  try {
    await act();
  } finally {
    delete (target as { buildPlan?: BuildPlan }).buildPlan;
  }
}
