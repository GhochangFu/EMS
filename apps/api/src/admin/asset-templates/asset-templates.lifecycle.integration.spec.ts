import type pg from "pg";

import type { AdminAssetTemplateDto, JwtPayload } from "@bms/shared";

import {
  templateContentSchema,
  type TemplateContentParsed,
} from "./asset-templates-content.schema";
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

/**
 * Deletes only this suite's rows. `template_points` cascade on the FK.
 *
 * Prefix match, not equality: several cases author under `${TEST_CODE}-…` and a
 * run that crashes between creating one and deleting it would otherwise leave a
 * row that fails the *next* run's one-draft-per-code index.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
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

// ---------------------------------------------------------------------------
// `E1.7` / ADR 0019 — the content model, where it needs a database
//
// The contract itself is proven by `asset-templates-content.schema.spec.ts`.
// What is left here is everything that depends on *stored* state: resolving a
// content patch against points the request did not send, the orphan window
// between two independent patches, and rows written before the contract
// existed. None of it is expressible as a pure function.
// ---------------------------------------------------------------------------

const CONTENT_CODE = `${TEST_CODE}-CONTENT`;

/** Content referencing exactly the point keys named, as the parsed shape the
 * service receives after Zod. */
function contentReferencing(...pointKeys: string[]): TemplateContentParsed {
  return templateContentSchema.parse({
    alarms: pointKeys.map((pointKey, index) => ({
      code: `ALARM_${index}`,
      pointKey,
      operator: "gt",
      thresholdValue: 10,
      severity: "warning",
      message: `${pointKey} above limit`,
    })),
    dashboards: { overview: { featured: pointKeys } },
  });
}

/** Content round-trips through `jsonb` with its structure intact. */
export async function assertContentRoundTrips(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<AdminAssetTemplateDto> {
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: CONTENT_CODE,
    name: "Content fixture",
    assetType: "test_rig",
    domain: "water",
    content: contentReferencing(fx.pointKeys[0], fx.pointKeys[1]),
    points: [
      { pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 },
      { pointKey: fx.pointKeys[1], kind: "measured", required: true, sortOrder: 1 },
    ],
  });

  const content = created.content as TemplateContentParsed;
  assert(content.contentVersion === 1, "contentVersion must be persisted, not just defaulted");
  assert(content.alarms?.length === 2, `expected 2 alarms to survive jsonb, got ${content.alarms?.length}`);
  assert(
    content.dashboards?.overview?.featured[0] === fx.pointKeys[0],
    "featured ordering must survive the jsonb round trip — the order IS the information",
  );
  return created;
}

/** A create whose content names a key the template does not declare is rejected,
 * and the key is named. */
export async function assertContentRefsCheckedOnCreate(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        code: `${TEST_CODE}-ORPHANCREATE`,
        name: "Orphan on create",
        assetType: "test_rig",
        domain: "water",
        // The second key is in the org's *catalog* — `loadFixtures` guarantees
        // it is active — but this template does not declare it. That is the
        // distinction ADR 0019 §6 makes, and a catalog-scoped check would pass.
        content: contentReferencing(fx.pointKeys[0], fx.pointKeys[1]),
        points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
      }),
    new RegExp(fx.pointKeys[1]),
    "content referencing a catalogued point the template does not declare",
  );
}

/**
 * A `PATCH` carrying content but no points resolves against the **stored**
 * points. This is the ordinary authoring case — edit the overlay, leave the tag
 * list alone — and it is the one a request-scoped check would get wrong.
 */
export async function assertContentPatchResolvesAgainstStoredPoints(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  draftId: string,
): Promise<void> {
  const patched = await svc.update(fx.adminJwt, draftId, {
    content: contentReferencing(fx.pointKeys[1]),
  });
  const content = patched.content as TemplateContentParsed;
  assert(content.alarms?.length === 1, "the content patch must replace, not merge");

  await expectRejection(
    () =>
      svc.update(fx.adminJwt, draftId, {
        content: templateContentSchema.parse({
          kpis: [
            {
              code: "GHOST",
              name: "Ghost KPI",
              pointKeys: ["not_declared_by_this_template"],
              expression: "x",
              dialect: "unvalidated",
            },
          ],
        }),
      }),
    /not_declared_by_this_template/,
    "a content patch naming an undeclared key",
  );
}

/**
 * The reason publish re-checks: `content` and `points` are patched
 * independently, so replacing the point set orphans content the request never
 * mentioned. The orphaning write **succeeds** — it validates only what it
 * carries — and publish is what refuses.
 *
 * If this test ever passes because the `update` call throws, the check has been
 * moved to the wrong place and the assertion below will say so.
 */
export async function assertOrphanedRefsAreCaughtAtPublish(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  draftId: string,
): Promise<void> {
  // Stored content references pointKeys[1]. Drop that point, mention nothing
  // about content.
  const orphaned = await svc.update(fx.adminJwt, draftId, {
    points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
  });
  assert(
    orphaned.points.length === 1,
    "the points patch must be accepted — a write validates what it carries",
  );

  await expectRejection(
    () => svc.publish(fx.adminJwt, draftId),
    new RegExp(fx.pointKeys[1]),
    "publishing a template whose content was orphaned by an earlier points patch",
  );

  // And the way out is to fix the content, not to fight the check.
  await svc.update(fx.adminJwt, draftId, { content: contentReferencing(fx.pointKeys[0]) });
  const published = await svc.publish(fx.adminJwt, draftId);
  assert(published.status === "published", "a repaired template must publish");
}

/**
 * A row written before ADR 0019 holds arbitrary JSON — `F2.1` shipped this
 * column behind `z.record(z.unknown())`. Written directly through the pool
 * because the API can no longer produce one, which is the point.
 *
 * Such a row still reads. It cannot be published, because publishing puts it
 * behind an immutable version. But forking it must still work, or the template
 * is stranded: its published version is immutable and forking is the only route
 * to an editable copy.
 */
export async function assertLegacyContentBlocksPublishButNotForking(
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const legacy = { arbitrary: "shape", health: { model: "written in 2026-08" } };

  const draft = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: `${TEST_CODE}-LEGACY`,
    name: "Legacy content",
    assetType: "test_rig",
    domain: "water",
    points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
  });
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    draft.id,
    JSON.stringify(legacy),
  ]);

  // Reads keep working — nothing consumes `content`, so a legacy row is not a
  // broken row.
  const read = await svc.getById(fx.adminJwt, draft.id);
  assert(
    (read.content as Record<string, unknown>).arbitrary === "shape",
    "a legacy content row must still read back unchanged",
  );

  await expectRejection(
    () => svc.publish(fx.adminJwt, draft.id),
    /PATCH `?content`? into conformance/i,
    "publishing a row whose stored content predates the contract",
  );

  // The rejection must describe *structure*, not echo stored values back out.
  // Pre-ADR content is arbitrary JSON written by whoever.
  //
  // The bad value goes in an **enum** field deliberately. Zod's
  // `invalid_enum_value` message is the one that echoes what it received
  // ("Invalid enum value. Expected 'info' | … , received 'x'"); `invalid_literal`
  // names only the *expected* value, so asserting against that field would pass
  // no matter how the error is built and prove nothing.
  const secretish = "s3://internal-bucket/rotate-me";
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    draft.id,
    JSON.stringify({
      alarms: [
        {
          code: "A",
          pointKey: fx.pointKeys[0],
          operator: "gt",
          thresholdValue: 1,
          severity: secretish,
          message: "m",
        },
      ],
    }),
  ]);
  let leaked: string | null = null;
  try {
    await svc.publish(fx.adminJwt, draft.id);
  } catch (err) {
    leaked = err instanceof Error ? err.message : String(err);
  }
  assert(leaked !== null, "invalid stored content must still block publish");
  assert(
    (leaked ?? "").includes("alarms.0.severity"),
    `the error must name the offending path, got: ${leaked}`,
  );
  assert(
    !(leaked ?? "").includes(secretish),
    `the error must not echo the stored value back to the caller, got: ${leaked}`,
  );
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    draft.id,
    JSON.stringify(legacy),
  ]);

  // Repairing it through the API is the documented way forward.
  await svc.update(fx.adminJwt, draft.id, { content: contentReferencing(fx.pointKeys[0]) });
  const published = await svc.publish(fx.adminJwt, draft.id);
  assert(published.status === "published", "a repaired legacy row must publish");

  // Now the fork case: put legacy content on the *published* row, exactly as a
  // deployment that upgraded after publishing would have it, and confirm the
  // fork copies it byte for byte instead of refusing.
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    published.id,
    JSON.stringify(legacy),
  ]);
  const forked = await svc.createDraftFrom(fx.adminJwt, published.id);
  assert(
    (forked.content as Record<string, unknown>).arbitrary === "shape",
    "the draft fork must copy stored content verbatim — re-validating it would strand the template",
  );
  await expectRejection(
    () => svc.publish(fx.adminJwt, forked.id),
    /PATCH `?content`? into conformance/i,
    "publishing the fork before its content is repaired",
  );
}

export { assert };
