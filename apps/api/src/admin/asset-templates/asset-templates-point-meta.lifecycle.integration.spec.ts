import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { AdminAssetTemplateDto } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { assert, loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `F2.13` / ADR 0052 decision 2, ADR 0040 open question 4 — `meta.tier` is
 * authorable and re-stamped on every write, exactly like every other point
 * field.
 *
 * **A separate file, not a fifth case in `asset-templates.lifecycle.integration.spec.ts`.**
 * That file sits at the §4.5 1000-line cap; this row's own addition would
 * have crossed it. `loadFixtures` (organization + two active point keys) is
 * imported rather than restated, so the two files cannot drift on how a
 * fixture organization is resolved. `TEST_CODE` here is this file's own —
 * per-run, per-file, same reasoning `TEST_CODE`'s docblock in the sibling
 * gives for why a shared one would race across two suites.
 */
const TEST_CODE = `F213-META-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/**
 * `F2.7` / ADR 0056's five metadata defaults get their own template, per-run
 * for the same reason `TEST_CODE` is: two codes, so neither case can see the
 * other's points and a failure names one subject.
 */
const METADATA_TEST_CODE = `F27-META-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Deletes only this run's own rows. `template_points` cascades on the FK. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code = $1`, [TEST_CODE]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code = $1`, [METADATA_TEST_CODE]);
}

const tierOf = (t: AdminAssetTemplateDto, key: string): string | undefined =>
  (t.points.find((p) => p.pointKey === key)?.meta as { tier?: string } | null)?.tier;

/** create -> GET :id -> createDraftFrom, meta.tier surviving every hop. */
export async function assertPointMetaRoundTrips(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: TEST_CODE,
    name: "Meta round trip",
    assetType: "test_rig",
    domain: "water",
    points: [
      {
        pointKey: fx.pointKeys[0],
        kind: "measured",
        required: true,
        sortOrder: 0,
        meta: { tier: "core" },
      },
      { pointKey: fx.pointKeys[1], kind: "measured", required: false, sortOrder: 1 },
    ],
  });
  assert(tierOf(created, fx.pointKeys[0]) === "core", "create must write meta.tier");
  assert(
    tierOf(created, fx.pointKeys[1]) === undefined,
    "a point with no meta must not invent a tier",
  );

  const read = await svc.getById(fx.adminJwt, created.id);
  assert(tierOf(read, fx.pointKeys[0]) === "core", "GET :id must carry meta.tier forward");

  const published = await svc.publish(fx.adminJwt, created.id);
  const draft = await svc.createDraftFrom(fx.adminJwt, published.id);
  assert(
    tierOf(draft, fx.pointKeys[0]) === "core",
    "createDraftFrom must carry meta.tier forward — replacePoints re-stamps every point field",
  );
}

/** The five as the DTO carries them, for one point key of a template. */
function metadataOf(
  template: AdminAssetTemplateDto,
  key: string,
): Record<string, unknown> | undefined {
  const point = template.points.find((p) => p.pointKey === key);
  if (!point) {
    return undefined;
  }
  return {
    scaleMultiplier: point.scaleMultiplier,
    scaleOffset: point.scaleOffset,
    engMin: point.engMin,
    engMax: point.engMax,
    qualityPolicy: point.qualityPolicy,
  };
}

/**
 * The five as this case authors them, and as every hop must read them back.
 * `as const` so `qualityPolicy` stays the enum member the body demands rather
 * than widening to `string`.
 */
const AUTHORED = {
  scaleMultiplier: 0.1,
  scaleOffset: -40,
  engMin: 0,
  engMax: 100,
  qualityPolicy: "accept_bad",
} as const;

const NOT_SET = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

/**
 * `F2.7` / ADR 0056 decisions 1 and 3 — create -> GET :id -> publish ->
 * `createDraftFrom`, with the five instrument-metadata defaults surviving every
 * hop.
 *
 * **The version bump is the hazard this case exists for** (the `F2.9`
 * correction 15 shape, on the measured side): `createDraftFrom` copies the
 * parent's rows through `toTemplatePointInsert`, which re-stamps every column.
 * A field the mapper forgets is not an error — it is a new draft whose scale
 * silently reverts to 1 and whose range test disappears, on every asset the
 * next migration touches.
 */
export async function assertPointMetadataRoundTrips(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: METADATA_TEST_CODE,
    name: "Point metadata round trip",
    assetType: "test_rig",
    domain: "water",
    points: [
      {
        pointKey: fx.pointKeys[0],
        kind: "measured",
        required: true,
        sortOrder: 0,
        ...AUTHORED,
      },
      { pointKey: fx.pointKeys[1], kind: "measured", required: false, sortOrder: 1 },
    ],
  });
  assert(
    JSON.stringify(metadataOf(created, fx.pointKeys[0])) === JSON.stringify(AUTHORED),
    `create must write all five: ${JSON.stringify(metadataOf(created, fx.pointKeys[0]))}`,
  );
  assert(
    JSON.stringify(metadataOf(created, fx.pointKeys[1])) === JSON.stringify(NOT_SET),
    "a point that states none of the five must read back null, never a default",
  );

  const read = await svc.getById(fx.adminJwt, created.id);
  assert(
    JSON.stringify(metadataOf(read, fx.pointKeys[0])) === JSON.stringify(AUTHORED),
    `GET :id must carry the five forward: ${JSON.stringify(metadataOf(read, fx.pointKeys[0]))}`,
  );

  const published = await svc.publish(fx.adminJwt, created.id);
  const draft = await svc.createDraftFrom(fx.adminJwt, published.id);
  assert(
    JSON.stringify(metadataOf(draft, fx.pointKeys[0])) === JSON.stringify(AUTHORED),
    "createDraftFrom must carry the five onto the copy — replacePoints re-stamps every " +
      `column, and a forgotten one silently rescales every migrated asset: ${JSON.stringify(metadataOf(draft, fx.pointKeys[0]))}`,
  );
}

export { loadFixtures, type Fixtures };
