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

/** Deletes only this run's own rows. `template_points` cascades on the FK. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code = $1`, [TEST_CODE]);
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

export { loadFixtures, type Fixtures };
