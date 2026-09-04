import { randomUUID } from "node:crypto";

import type pg from "pg";

import { CALC_DIALECT } from "@bms/shared";
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
 * they create carries `TEST_CODE` — which is unique per run — and is deleted
 * afterwards. A crashed run cannot poison the next one, because the next run
 * writes under a different code; what it leaves behind is swept by age instead
 * (`sweepStaleRuns`). The shared local database is the developer's own, and may
 * have a second instance of this very file running on it.
 */

/**
 * The family every run of this suite writes under. Never used as a code on its
 * own, and never the target of a `DELETE` a running suite issues — see
 * {@link TEST_CODE}.
 */
export const TEST_CODE_FAMILY = "F21-LIFECYCLE-TEST";

/**
 * All rows *this run* creates carry this code, and only this code is deleted.
 *
 * **The suffix is the fix for a real flake, not decoration.** Until 2026-08-24
 * this was the constant `"F21-LIFECYCLE-TEST"`, and `cleanup` deleted
 * `LIKE 'F21-LIFECYCLE-TEST%'` in `beforeAll` *and* `afterAll`. Two instances of
 * this file against one database therefore destroyed each other's committed
 * rows, and the failures blamed the assertions rather than the collision:
 *
 * - `ConflictException: … already has an open draft` — the other run's draft;
 * - `expected 2 points, got 0` — the other run's `cleanup` landing between
 *   `create`'s two reads (`fetchRow` and `withPoints` are separate statements —
 *   both on `fleetDb` since E7.1b — so a cascade delete in the gap reads as
 *   "row found, no points" rather than as "not found");
 * - `a second draft for the same code: expected a rejection, but the call
 *   succeeded` — the partial unique index had nothing left to collide with;
 * - and, downstream of any of those, `TypeError: Cannot read properties of
 *   undefined (reading 'id')` from the stages that consume an earlier stage's
 *   output.
 *
 * Reproduced deterministically by running this file twice at once, which is not
 * exotic: two worktrees share one compose Postgres, `pnpm test:watch` in one
 * terminal overlaps `pnpm test` in another, and a hung worker from a previous
 * run outlives the run that spawned it.
 *
 * A per-run code is the same remedy `apps/api/src/testing/integration-fixtures.ts`
 * records for `bms.assets`, stated for a *committed* fixture rather than a
 * transaction-local one: the only property that closes the race is not sharing
 * the row. Ordering or retrying would narrow the window and leave it open.
 */
export const TEST_CODE = `${TEST_CODE_FAMILY}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

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
 * Deletes only **this run's** rows. `template_points` cascade on the FK.
 *
 * Prefix match, not equality: nine cases author under `${TEST_CODE}-…`
 * (`-BADKEY`, `-EMPTY`, `-FORBIDDEN`, `-CONTENT`, `-BADSKILL`, `-ORPHANCREATE`,
 * `-LEGACY`, plus `-XREF` and `-RATIO` in the `F2.9` calc-v2 sibling, which
 * reuses this function), and a case that throws between creating one and
 * deleting it would otherwise leave a row behind.
 *
 * The prefix is `TEST_CODE`, never `TEST_CODE_FAMILY`. Widening it back to the
 * family is the 2026-08-24 flake — this statement runs in `afterAll` while
 * another instance of the same file may be mid-run, and a family-wide `DELETE`
 * takes that run's rows with it. See {@link TEST_CODE}.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

/**
 * Removes rows left by *older* runs of this suite, so a developer database does
 * not accumulate one dead family member per crashed run.
 *
 * Bounded by age, which is the *only* thing that keeps it safe: a concurrent
 * instance's rows are minutes old at most (a full `pnpm test:coverage` is ~2.5
 * minutes here), so an hour-old row cannot belong to a run still in flight.
 * Without the bound this is the cross-instance `DELETE` that {@link TEST_CODE}
 * exists to remove, in its worst form — family-wide, in `beforeAll`, at any age.
 * `tests/integration-fixture-isolation.test.ts` mutation-tests that exact edit.
 *
 * This run's own code needs no exclusion. The statement runs in `beforeAll`
 * before this run has written anything, and the age bound excludes rows that are
 * seconds old either way.
 *
 * Non-fatal, unlike {@link cleanup}: with per-run codes a stale row can no
 * longer collide with anything this run writes, so failing `beforeAll` over
 * one — for instance because an old fixture template is pinned by an
 * `bms.assets` row and the FK refuses — would turn hygiene into a red suite.
 * It says so on stderr instead.
 */
export async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.asset_templates
        WHERE code LIKE $1 AND created_at < now() - interval '1 hour'`,
      [`${TEST_CODE_FAMILY}%`],
    );
  } catch (err) {
    process.stderr.write(
      `[F2.1] could not sweep stale ${TEST_CODE_FAMILY} rows: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows will stay.\n",
    );
  }
}

/**
 * Resolves an organization with at least two active point keys.
 *
 * **Ordered by `created_at`, and that is the whole point (`F4.53`).** Ordering
 * by `code` is not enough: `asset-points.service.rls.integration.test.ts:56`
 * mints an active `E71B_AP_<uuid>_CAT` key for its own run and deletes it at
 * line 256, and that code sorts early. This suite then adopted a foreign,
 * transient key and validated a template against it *after* its owner had
 * cleaned up — `Not in this organization's active point-key catalog`, on a
 * template that was correct. It reddened CI on `main` at `7543253`. (That is
 * the message as it read then; `F3.42` shortened it to `Not in the active
 * point-key catalog`, there being no organization catalog since `0057`.)
 *
 * `F4.67` is the same mechanism on `bms.assets` and its fix was the same idea;
 * it was ordering by `code` there too, which is why closing it did not stop
 * this. The invariant is **oldest wins**: a seeded row predates every suite, so
 * preferring `created_at` can only ever resolve a row no suite deletes. `code`
 * stays as the tiebreaker because the seed writes a whole catalog in one
 * statement, so timestamps tie inside an organization and `created_at` alone
 * would not be deterministic.
 */
export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  // `F3.39`: the catalog is fleet-wide, so the two codes no longer come from a
  // GROUP BY on `organization_id`. The `created_at, code` ordering above is
  // unchanged and still load-bearing for exactly the reason stated — it is what
  // keeps a foreign transient key from being adopted. The organization is now
  // picked separately, oldest first, on the same "a seeded row predates every
  // suite" reasoning.
  const { rows } = await pool.query<{ organization_id: string; codes: string[] }>(
    `WITH catalog AS (
       SELECT (ARRAY_AGG(code ORDER BY created_at, code))[1:2] AS codes,
              COUNT(*) AS n
         FROM bms.point_keys WHERE active = true
     )
     SELECT o.id AS organization_id, c.codes
       FROM bms.organizations o
       CROSS JOIN catalog c
      WHERE c.n >= 2
      ORDER BY o.created_at, o.id
      LIMIT 1`,
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
      {
        pointKey: fx.pointKeys[0],
        kind: "derived",
        formula: `{${fx.pointKeys[1]}}`,
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: 120,
        maxInputAgeSeconds: 600,
        required: false,
        sortOrder: 0,
      },
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
  assert(
    created.points[0].calcTrigger === "scheduled" &&
      created.points[0].calcIntervalSeconds === 120 &&
      created.points[0].maxInputAgeSeconds === 600,
    "ADR 0037: calcTrigger/calcIntervalSeconds/maxInputAgeSeconds must survive the create round trip",
  );
  return created;
}

/**
 * ADR 0037 decision 4's calc fields must survive not just create, but a
 * PATCH that re-sends the whole points array — `templatePointsBodySchema`
 * sends the points array whole on every update (task 4's own comment on
 * `adminTemplatePointDtoSchema` names this), so if the GET→PATCH round trip
 * ever drops a field, the next author save silently erases it.
 */
export async function assertCalcFieldsSurviveUpdateRoundTrip(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  created: AdminAssetTemplateDto,
): Promise<void> {
  // `F2.9` Task 6 widened the write body to `calcDialectSchema`, so the read
  // DTO's dialect is assignable to it and the *cast* Task 5 needed here is
  // gone. Its **assertion** is not, and stays as its own line: this case's
  // whole claim is that a GET -> PATCH round trip does not silently erase a
  // calc field, and it echoes back whatever dialect it reads. A `v2` point in
  // this fixture would still pass while proving something else entirely.
  assert(
    created.points.every(
      (point) => point.formulaDialect === null || point.formulaDialect === CALC_DIALECT,
    ),
    "this fixture creates bms-calc-v1 points only; a v2 point here means the fixture " +
      "changed and this round trip stopped proving what it claims",
  );

  const patched = await svc.update(fx.adminJwt, created.id, {
    points: created.points.map((point) => ({
      pointKey: point.pointKey,
      label: point.label ?? undefined,
      unit: point.unit ?? undefined,
      kind: point.kind,
      sourceDataKeyPattern: point.sourceDataKeyPattern ?? undefined,
      formula: point.formula ?? undefined,
      formulaDialect: point.formulaDialect ?? undefined,
      calcTrigger: point.calcTrigger ?? undefined,
      calcIntervalSeconds: point.calcIntervalSeconds ?? undefined,
      maxInputAgeSeconds: point.maxInputAgeSeconds ?? undefined,
      required: point.required,
      sortOrder: point.sortOrder,
    })),
  });
  const derived = patched.points.find((point) => point.kind === "derived");
  assert(derived !== undefined, "the derived point must survive a PATCH that re-sends it");
  assert(
    derived?.calcTrigger === "scheduled" &&
      derived.calcIntervalSeconds === 120 &&
      derived.maxInputAgeSeconds === 600,
    "the calc fields read back from GET must round-trip unchanged through a PATCH " +
      "that echoes them — this is the erasure bug a missing DTO field would cause",
  );
}

/**
 * The partial unique index is the whole guarantee behind the version-bump rule.
 * Without it two "edit" clicks produce two rival drafts at the same version and
 * the caller learns about it only when the other unique index happens to fire.
 */
export async function assertOnlyOneDraftPerCode(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  openDraft: AdminAssetTemplateDto,
): Promise<void> {
  // The rival create can only be *refused* if the first draft is there to
  // collide with. Without this the case reads as its own failure — "expected a
  // rejection, but the call succeeded" — when the real fault is upstream, which
  // is one of the four signatures the 2026-08-24 flake produced.
  assert(
    openDraft.code === TEST_CODE && openDraft.status === "draft",
    `this case needs the open v${openDraft.version} draft from the first stage, got ` +
      `"${openDraft.code}" at status "${openDraft.status}" — read that stage's failure`,
  );

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
  // createDraftFrom passes raw PointRow[] (from a plain SELECT) into
  // replacePoints, a different shape than the create/update TemplatePointBody[]
  // path — an easy place for a field-by-field mapper to silently drop a
  // column with no compile error and no other failing test.
  assert(
    draft.points.every((point, i) => point.formula === published.points[i].formula),
    "createDraftFrom must copy formula — replacePoints takes raw PointRows on this path",
  );
  assert(
    draft.points.every((point, i) => point.formulaDialect === published.points[i].formulaDialect),
    "createDraftFrom must copy formulaDialect too",
  );
  assert(
    published.points.some((point) => point.kind === "derived" && point.formula !== null),
    "fixture sanity: this assertion is meaningless unless a derived point with a formula exists",
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

/**
 * `E7.1b` / ADR 0043 §5 — every `template_points` row carries its parent
 * template's `organization_id`, and the point set survives a delete-then-insert
 * replace and a version fork with that stamp intact.
 *
 * **This is the one assertion the stamping cannot pass without.** The column is
 * nullable today and `0047` does not exist yet, so a suite that only checked
 * "create succeeded" or "N rows exist" would pass whether or not the insert
 * stamps org — vacuous, the §4.6 shape `code-reviewer` flags. So it reads the
 * literal `organization_id` back through the pool and asserts it *equals* the
 * template's org: NULL today, the org after the fix.
 *
 * It also asserts the returned DTO's `points.length` at each step, not just the
 * row count. `withPoints` moved to `fleetDb` for `0047`; that read backs every
 * mutation's response and is the one whose post-`0047` failure has no error
 * surface — a create that returns `points: []` with a 200. Only the DTO length
 * catches it.
 *
 * Runs on `bms_tenant`/`bms_fleet` (the `.test.ts` constructs the service that
 * way), so the writes actually pass through the pools `withTenant` binds.
 */
export async function assertTemplatePointsCarryOrganization(
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const code = `${TEST_CODE}-TENANT`;

  async function storedPointOrgs(templateId: string): Promise<(string | null)[]> {
    const { rows } = await pool.query<{ organization_id: string | null }>(
      `SELECT organization_id FROM bms.template_points WHERE template_id = $1`,
      [templateId],
    );
    return rows.map((row) => row.organization_id);
  }

  // create: two points, both stamped with the template's org.
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code,
    name: "Tenant stamping",
    assetType: "test_rig",
    domain: "water",
    points: [
      { pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 },
      { pointKey: fx.pointKeys[1], kind: "measured", required: true, sortOrder: 1 },
    ],
  });
  assert(created.points.length === 2, `create must return 2 points, got ${created.points.length}`);
  const afterCreate = await storedPointOrgs(created.id);
  assert(
    afterCreate.length === 2 && afterCreate.every((org) => org === fx.organizationId),
    `every template_points row must carry the template's org (${fx.organizationId}); ` +
      `got ${JSON.stringify(afterCreate)} — the create insert is not stamping organization_id`,
  );

  // update to one point: the delete-then-insert replace leaves exactly one row,
  // still stamped. Proves the round trip and the update path's stamping at once.
  const patched = await svc.update(fx.adminJwt, created.id, {
    points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
  });
  assert(patched.points.length === 1, `update must return 1 point, got ${patched.points.length}`);
  const afterUpdate = await storedPointOrgs(created.id);
  assert(
    afterUpdate.length === 1 && afterUpdate[0] === fx.organizationId,
    `replacePoints must leave exactly one row stamped with the org; got ${JSON.stringify(afterUpdate)}`,
  );

  // fork a published version: createDraftFrom reads the source points on fleetDb
  // and re-stamps them onto the new draft's org.
  await svc.publish(fx.adminJwt, created.id);
  const forked = await svc.createDraftFrom(fx.adminJwt, created.id);
  assert(forked.points.length === 1, `the fork must copy 1 point, got ${forked.points.length}`);
  const afterFork = await storedPointOrgs(forked.id);
  assert(
    afterFork.length === 1 && afterFork[0] === fx.organizationId,
    `forked template_points must carry the org too; got ${JSON.stringify(afterFork)}`,
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

/**
 * ADR 0034 (`E2.1`): `philosophy.skill` is a code into `bms.alarm_skills` now,
 * not free text — `alarmSkillCodeSchema` checks shape only (a non-empty
 * string, max 64 chars), so an unknown-but-well-shaped code passes Zod and
 * must be caught by `assertTemplateAlarmVocabularies` on create, the same way
 * an unknown `category`/`severity` already is.
 */
export async function assertUnknownSkillRejectedOnCreate(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        code: `${TEST_CODE}-BADSKILL`,
        name: "Unknown skill on create",
        assetType: "test_rig",
        domain: "water",
        content: templateContentSchema.parse({
          alarms: [
            {
              code: "A",
              pointKey: fx.pointKeys[0],
              operator: "gt",
              thresholdValue: 1,
              severity: "warning",
              message: "m",
              philosophy: { skill: "e21_test_not_a_real_skill" },
            },
          ],
        }),
        points: [{ pointKey: fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
      }),
    /alarms\.0\.philosophy\.skill/,
    "creating a template whose philosophy.skill names no live bms.alarm_skills row",
  );
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
  // **This block's original rationale died with ADR 0032 and had to be
  // rebuilt.** It read: "the bad value goes in an *enum* field deliberately —
  // Zod's `invalid_enum_value` message is the one that echoes what it received".
  // Both halves stopped being true at once. `severity` is no longer an enum, so
  // `parseStoredContent` no longer produces an echoing Zod message for it, and
  // the assertion below would have guarded a path that has no echo left by
  // construction — invariant under the change it guards, the §4.4 pattern.
  //
  // What replaced the enum is a pair of hand-written vocabulary checks in
  // `assertTemplateAlarmCategories`, and **both are probed here**, separately.
  // `category` is the one that matters most: the security review found that
  // `publish` began calling that method in the same commit that introduced the
  // severity check, so the echoing `assertRuleCategory` path became newly
  // reachable over stored content while only `severity` was being tested.
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
  async function publishError(): Promise<string> {
    try {
      await svc.publish(fx.adminJwt, draft.id);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    throw new Error("invalid stored content must still block publish");
  }

  const leakedSeverity = await publishError();
  assert(
    leakedSeverity.includes("alarms.0.severity"),
    `the error must name the offending path, got: ${leakedSeverity}`,
  );
  assert(
    !leakedSeverity.includes(secretish),
    `the error must not echo the stored value back to the caller, got: ${leakedSeverity}`,
  );

  // Now the same probe on `category`, the branch that routes through
  // `assertRuleCategory` unless it is written out. `severity` is restored to a
  // live code so the category check is the one that fires.
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    draft.id,
    JSON.stringify({
      alarms: [
        {
          code: "A",
          pointKey: fx.pointKeys[0],
          operator: "gt",
          thresholdValue: 1,
          severity: "warning",
          category: secretish,
          message: "m",
        },
      ],
    }),
  ]);
  const leakedCategory = await publishError();
  assert(
    leakedCategory.includes("alarms.0.category"),
    `the error must name the offending path, got: ${leakedCategory}`,
  );
  assert(
    !leakedCategory.includes(secretish),
    `a stored category must not be echoed back either, got: ${leakedCategory}`,
  );

  // Now the same probe on `philosophy.skill` (ADR 0034, `E2.1`), the third
  // branch `assertTemplateAlarmVocabularies` writes out non-echoing. `severity`
  // and `category` are restored to live values so the skill check is the one
  // that fires.
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    draft.id,
    JSON.stringify({
      alarms: [
        {
          code: "A",
          pointKey: fx.pointKeys[0],
          operator: "gt",
          thresholdValue: 1,
          severity: "warning",
          category: "operations",
          message: "m",
          philosophy: { skill: secretish },
        },
      ],
    }),
  ]);
  const leakedSkill = await publishError();
  assert(
    leakedSkill.includes("alarms.0.philosophy.skill"),
    `the error must name the offending path, got: ${leakedSkill}`,
  );
  assert(
    !leakedSkill.includes(secretish),
    `a stored skill code must not be echoed back either, got: ${leakedSkill}`,
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
