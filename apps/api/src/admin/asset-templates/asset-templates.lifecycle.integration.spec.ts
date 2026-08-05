import type pg from "pg";

import type { AdminAssetTemplateDto, JwtPayload } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F2.1` — the ADR 0015 version lifecycle, against a real database.
 *
 * The Zod contracts are proven by `asset-templates.schema.spec.ts`. Everything
 * here is a *database* rule that no pure function can express: the version-bump
 * arithmetic, the partial unique index that permits exactly one open draft, the
 * immutability of a published row, and the point-key catalog check. Each one is
 * the kind of rule that reads as obviously correct in review and is wrong in
 * practice — ADR 0015 exists because getting the shape wrong is expensive.
 *
 * These tests **write**, unlike `F4.10`'s read-only scope suite, so everything
 * they create carries `TEST_CODE` and is deleted before and after the run.
 * Cleaning up first as well as last means a crashed run does not poison the next
 * one — the shared local database is the developer's own.
 */

/** All rows this suite creates carry this code, and only this code is deleted. */
export const TEST_CODE = "F21-LIFECYCLE-TEST";

export type Fixtures = {
  organizationId: string;
  /** Two active point-key codes from the same organization's catalog. */
  pointKeys: [string, string];
  adminJwt: JwtPayload;
  locationAdminJwt: JwtPayload;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
}

/** Deletes only this suite's rows. `template_points` cascade on the FK. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code = $1`, [TEST_CODE]);
}

/** Resolves an organization with at least two active point keys. */
export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  const { rows } = await pool.query<{ organization_id: string; codes: string[] }>(
    `SELECT organization_id, ARRAY_AGG(code ORDER BY code) AS codes
       FROM bms.point_keys WHERE active = true
      GROUP BY organization_id HAVING COUNT(*) >= 2
      ORDER BY organization_id LIMIT 1`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      "F2.1 fixtures missing — no organization has two active point keys. " +
        "Run 'pnpm db:seed'; without a catalog the point-key validation tests " +
        "below cannot distinguish 'rejected correctly' from 'rejected everything'.",
    );
  }
  return {
    organizationId: row.organization_id,
    pointKeys: [row.codes[0], row.codes[1]],
    adminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "admin@bms.local",
      name: "integration:admin",
      role: "admin",
    },
    locationAdminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "wc-admin@bms.local",
      name: "integration:location-admin",
      role: "location_admin",
    },
  };
}

/** v1 starts at 1, lands as a draft, and keeps its points in sort order. */
export async function assertCreateStartsAtVersionOne(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<AdminAssetTemplateDto> {
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: TEST_CODE,
    name: "Lifecycle Fixture",
    assetType: "test_rig",
    domain: "water",
    points: [
      { pointKey: fx.pointKeys[1], kind: "measured", required: true, sortOrder: 1 },
      { pointKey: fx.pointKeys[0], kind: "derived", required: false, sortOrder: 0 },
    ],
  });

  assert(created.version === 1, `a new code must start at version 1, got ${created.version}`);
  assert(created.status === "draft", `create must produce a draft, got "${created.status}"`);
  assert(created.publishedAt === null, "a draft must have no publishedAt");
  assert(created.points.length === 2, `expected 2 points, got ${created.points.length}`);
  assert(
    created.points[0].pointKey === fx.pointKeys[0],
    "points must come back in sortOrder, not insertion order",
  );
  assert(
    created.points[0].kind === "derived",
    "the derived kind must survive the round trip — F2.2 branches on it",
  );
  return created;
}

/**
 * The partial unique index is the whole guarantee behind the version-bump rule.
 * Without it two "edit" clicks produce two rival drafts at the same version and
 * the caller learns about it only when the other unique index happens to fire.
 */
export async function assertOnlyOneDraftPerCode(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        code: TEST_CODE,
        name: "Rival draft",
        assetType: "test_rig",
        domain: "water",
        points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
      }),
    /already has an open draft/i,
    "a second draft for the same code",
  );
}

/** Point keys must resolve to an *active* catalog row, and be named when they do not. */
export async function assertPointKeyCatalogIsEnforced(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        code: `${TEST_CODE}-BADKEY`,
        name: "Bad key",
        assetType: "test_rig",
        domain: "water",
        points: [
          { pointKey: "definitely_not_a_real_point_key", kind: "measured", required: true, sortOrder: 0 },
        ],
      }),
    /definitely_not_a_real_point_key/,
    "a template referencing an uncatalogued point key",
  );
}

/** Publishing freezes the row and stamps `publishedAt`. */
export async function assertPublishFreezes(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  draftId: string,
): Promise<void> {
  const published = await svc.publish(fx.adminJwt, draftId);
  assert(published.status === "published", `expected published, got "${published.status}"`);
  assert(published.publishedAt !== null, "publish must stamp publishedAt");

  // The central decision of ADR 0015: instantiated asset_points are physical
  // wiring that apps/ingest and the rule engine read, so a template edit must
  // never reach assets already built from it.
  await expectRejection(
    () => svc.update(fx.adminJwt, draftId, { name: "Renamed after publish" }),
    /cannot be edited/i,
    "editing a published version",
  );
  await expectRejection(
    () => svc.publish(fx.adminJwt, draftId),
    /cannot be published/i,
    "publishing an already-published version",
  );
  await expectRejection(
    () => svc.deleteDraft(fx.adminJwt, draftId),
    /cannot be deleted/i,
    "deleting a published version — an asset's pin must stay resolvable forever",
  );
}

/** Editing a published version means a new draft at max(version) + 1, points copied. */
export async function assertVersionBumpCopiesPoints(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  publishedId: string,
): Promise<void> {
  const published = await svc.getById(fx.adminJwt, publishedId);
  const draft = await svc.createDraftFrom(fx.adminJwt, publishedId);

  assert(
    draft.version === published.version + 1,
    `expected version ${published.version + 1}, got ${draft.version}`,
  );
  assert(draft.status === "draft", `expected a draft, got "${draft.status}"`);
  assert(draft.id !== published.id, "the new draft must be a distinct row");
  assert(
    draft.points.length === published.points.length,
    `the draft must copy all ${published.points.length} points, got ${draft.points.length}`,
  );
  assert(
    draft.points.every((point, i) => point.pointKey === published.points[i].pointKey),
    "copied points must preserve their keys and order",
  );
  assert(
    draft.points.every((point) => point.templateId === draft.id),
    "copied points must belong to the new draft, not still to the source version",
  );

  // Publishing v2 does not touch v1. Ever. That is what makes a pin meaningful.
  const before = await svc.getById(fx.adminJwt, publishedId);
  await svc.publish(fx.adminJwt, draft.id);
  const after = await svc.getById(fx.adminJwt, publishedId);
  assert(
    after.status === before.status && after.updatedAt === before.updatedAt,
    "publishing v2 modified v1 — assets pinned to v1 would silently change",
  );
}

/** Archive is permitted while assets pin the version; only published rows archive. */
export async function assertArchiveRules(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  publishedId: string,
): Promise<void> {
  const archived = await svc.archive(fx.adminJwt, publishedId);
  assert(archived.status === "archived", `expected archived, got "${archived.status}"`);
  assert(archived.archivedAt !== null, "archive must stamp archivedAt");

  await expectRejection(
    () => svc.archive(fx.adminJwt, publishedId),
    /only a published template can be archived/i,
    "archiving an already-archived version",
  );
}

/** An empty draft may be saved, but must not be publishable. */
export async function assertEmptyDraftCannotPublish(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  const empty = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: `${TEST_CODE}-EMPTY`,
    name: "Empty draft",
    assetType: "test_rig",
    domain: "water",
    points: [],
  });
  await expectRejection(
    () => svc.publish(fx.adminJwt, empty.id),
    /no points/i,
    "publishing a template with no points",
  );
  await svc.deleteDraft(fx.adminJwt, empty.id);
}

/**
 * ADR 0015 §7: templates are org-scoped master data, and `location_admin` is
 * excluded from authoring them. The asymmetry is deliberate — a location admin
 * may *instantiate* a published template into their own location (F2.2), which
 * is the point of model-once-deploy-many.
 */
export async function assertLocationAdminCannotAuthor(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.locationAdminJwt, {
        organizationId: fx.organizationId,
        code: `${TEST_CODE}-FORBIDDEN`,
        name: "Should not exist",
        assetType: "test_rig",
        domain: "water",
        points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
      }),
    /cannot author asset templates/i,
    "a location admin authoring a template",
  );

  // Reading is a separate question and is governed by org scope, not by role.
  await expectRejection(
    () =>
      svc.list(fx.locationAdminJwt, "00000000-0000-4000-8000-0000000000aa"),
    /outside your access scope/i,
    "listing templates for an organization the caller has no grant on",
  );
}

export { assert };
