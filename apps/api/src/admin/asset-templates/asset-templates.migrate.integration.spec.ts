import type pg from "pg";

import { assetPoints, assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  templateMigrationPreviewResponseSchema,
  templateMigrationResultResponseSchema,
  templateVersionsListResponseSchema,
} from "@bms/shared";

import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";

/**
 * `F2.6` U6 — template version migration against a real database (ADR 0039).
 *
 * Every expectation is computed with **independent SQL through the pool**,
 * never read back from the service's own return value. A service that reports
 * `assetCount: 3` while pinning one asset must fail here; asserting against its
 * own DTO would let it grade its own work.
 *
 * Half these cases count rows after a deliberate refusal. Partial migration is
 * the worst outcome this feature can produce — half an estate pinned to a new
 * version, some assets missing the points that version added — so "nothing was
 * written" is asserted explicitly and not inferred from the thrown error.
 *
 * ## On decision 5, and why it is not asserted here at all
 *
 * "Nothing recomputes history." The obvious test writes a
 * `telemetry.point_values` row for a migrated asset and compares it across the
 * migration — but that hypertable feeds continuous aggregates, and AGENTS.md
 * §4.4 records that an absorbed raw row cannot be un-absorbed by deleting it,
 * so a `DELETE`-based cleanup is not a cleanup.
 *
 * A **global** `point_values` count either side of the apply was the first
 * attempt and is wrong for a different reason: Vitest runs suites in parallel
 * against one database, so `calc-write` and the telemetry suites move that
 * number under this one. It passed alone and failed in a full run — a flaky
 * assertion, which is worse than none. Scoping the count to the fixture assets
 * makes it `0` before and `0` after, which proves nothing.
 *
 * So decision 5 is guarded where it can be guarded honestly:
 * `tests/adr-0039-resolution-merge.test.ts` asserts in source that this
 * service references neither the telemetry table nor the aggregate refresh.
 */

export const TEST_TEMPLATE_CODE = "F26-MIGRATE-TEST";
export const TEST_ASSET_PREFIX = "F26-MIG-TEST-";
const OTHER_TEMPLATE_CODE = "F26-MIGRATE-OTHER";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Asserts both the exception **class** and the message.
 *
 * The class matters as much as the text and is easy to get silently wrong: a
 * service throwing `BadRequestException` where `ConflictException` was
 * specified passes every message-only assertion, and `U8`'s UI branches on 409
 * versus 400. `HttpException.getStatus()` is checked rather than `instanceof`,
 * because the status is what the client actually sees.
 */
async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
  expectedStatus?: number,
): Promise<void> {
  let message: string | null = null;
  let status: number | null = null;
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    status = typeof getStatus === "function" ? getStatus.call(err) : null;
    // Nest's HttpException carries the useful text in `response`. Prefer its
    // `message` field over JSON.stringify of the whole object: stringifying
    // escapes the embedded quotes, so a regex naming a quoted asset code stops
    // matching for a reason that has nothing to do with the behaviour.
    const response = (err as { response?: unknown } | null)?.response;
    const nested = (response as { message?: unknown } | null)?.message;
    message =
      typeof response === "string"
        ? response
        : typeof nested === "string"
          ? nested
          : response !== undefined && response !== null
            ? JSON.stringify(response)
            : err instanceof Error
              ? err.message
              : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
  if (expectedStatus !== undefined) {
    assert(
      status === expectedStatus,
      `${what}: expected HTTP ${expectedStatus}, got ${String(status)}. The message was ` +
        `right, so this is the wrong exception class with the right words in it.`,
    );
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
       (SELECT id FROM bms.asset_templates WHERE code LIKE $1 OR code LIKE $2)`,
    [`${TEST_TEMPLATE_CODE}%`, `${OTHER_TEMPLATE_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1 OR code LIKE $2`, [
    `${TEST_TEMPLATE_CODE}%`,
    `${OTHER_TEMPLATE_CODE}%`,
  ]);
}

// --- fixture builders -------------------------------------------------------

type PointSpec = {
  pointKey: string;
  kind?: string;
  /** The template's unit *override*; null/absent means "use the catalog unit". */
  unit?: string | null;
  sourceDataKeyPattern?: string | null;
  required?: boolean;
  formula?: string | null;
  calcTrigger?: string | null;
  calcIntervalSeconds?: number | null;
};

async function seedVersion(
  db: BmsDb,
  fx: Fixtures,
  opts: {
    version: number;
    points: PointSpec[];
    status?: string;
    domain?: string;
    code?: string;
  },
): Promise<string> {
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: opts.code ?? TEST_TEMPLATE_CODE,
      version: opts.version,
      name: `Migrate Fixture v${opts.version}`,
      assetType: "test_rig",
      domain: opts.domain ?? "electrical",
      status: opts.status ?? "published",
      publishedAt: (opts.status ?? "published") === "published" ? new Date() : null,
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values(
    opts.points.map((point, index) => ({
      templateId: template.id,
      pointKey: point.pointKey,
      kind: point.kind ?? "measured",
      sourceDataKeyPattern:
        point.sourceDataKeyPattern === undefined
          ? `SITE/{asset_code}/${point.pointKey}`
          : point.sourceDataKeyPattern,
      required: point.required ?? true,
      unit: point.unit ?? null,
      formula: point.formula ?? null,
      formulaDialect: point.formula ? "bms-calc-v1" : null,
      calcTrigger: point.calcTrigger ?? (point.formula ? "streaming" : null),
      calcIntervalSeconds: point.calcIntervalSeconds ?? null,
      sortOrder: index,
    })),
  );

  return template.id;
}

async function seedAsset(
  db: BmsDb,
  fx: Fixtures,
  suffix: string,
  templateId: string | null,
  opts: { locationId?: string; domain?: string } = {},
): Promise<string> {
  const [asset] = await db
    .insert(assets)
    .values({
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: `Migrate Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: opts.locationId ?? fx.otherLocationId,
      domain: opts.domain ?? "electrical",
      templateId,
    })
    .returning({ id: assets.id });
  return asset.id;
}

// --- independent SQL readers ------------------------------------------------

async function pinnedVersion(pool: pg.Pool, assetId: string): Promise<number | null> {
  const { rows } = await pool.query<{ version: number | null }>(
    `SELECT t.version FROM bms.assets a
       LEFT JOIN bms.asset_templates t ON t.id = a.template_id
      WHERE a.id = $1`,
    [assetId],
  );
  return rows[0]?.version ?? null;
}

async function pointRows(
  pool: pg.Pool,
  assetId: string,
): Promise<
  {
    point_key: string;
    source_data_key: string;
    source_kind: string;
    rtu_id: string | null;
    unit: string | null;
  }[]
> {
  const { rows } = await pool.query<{
    point_key: string;
    source_data_key: string;
    source_kind: string;
    rtu_id: string | null;
    unit: string | null;
  }>(
    `SELECT point_key, source_data_key, source_kind, rtu_id, unit FROM bms.asset_points
      WHERE asset_id = $1 ORDER BY point_key`,
    [assetId],
  );
  return rows;
}

async function auditRows(
  pool: pg.Pool,
  templateId: string,
): Promise<{ action: string; payload: Record<string, unknown> }[]> {
  const { rows } = await pool.query<{ action: string; payload: Record<string, unknown> }>(
    `SELECT action, payload FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [templateId],
  );
  return rows;
}

// --- cases ------------------------------------------------------------------

/** Versions list: newest first, with a correct per-version asset count. */
export async function assertVersionsListIsNewestFirstWithCounts(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS" }],
  });
  await seedAsset(db, fx, "V1A", v1);
  await seedAsset(db, fx, "V1B", v1);
  await seedAsset(db, fx, "V2A", v2);

  // Parsed through the contract, not merely typed against it. `listVersions`
  // casts `status` with `as` and formats `publishedAt` by hand, and a missing
  // or misnamed field would otherwise surface in U8, where `adminFetch`
  // requires a schema — far from the cause.
  const result = templateVersionsListResponseSchema.parse(
    await svc.listVersions(fx.adminJwt, v1),
  );
  const mine = result.items.filter((item) => item.id === v1 || item.id === v2);
  assert(mine.length === 2, `expected both versions, got ${mine.length}`);
  assert(
    mine[0]?.version === 2 && mine[1]?.version === 1,
    `versions must be newest-first, got ${mine.map((m) => m.version).join(", ")}`,
  );
  assert(
    mine[0]?.assetCount === 1 && mine[1]?.assetCount === 2,
    `asset counts must be per version: expected 1 then 2, got ` +
      `${String(mine[0]?.assetCount)} then ${String(mine[1]?.assetCount)}`,
  );
  assert(
    mine[0]?.pointCount === 2 && mine[1]?.pointCount === 1,
    "point counts must be per version too",
  );
  assert(mine[0]?.status === "published", "status must be carried through");
}

/** Preview returns the delta and writes nothing at all. */
export async function assertPreviewWritesNothing(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS" }],
  });
  const assetId = await seedAsset(db, fx, "PREVIEW", v1);

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] }),
  );

  assert(preview.canApply, `a clean addition-only delta must be applicable: ${JSON.stringify(preview.refusals)}`);
  assert(preview.deltas.length === 1, `expected 1 delta, got ${preview.deltas.length}`);
  assert(
    preview.deltas[0]?.measuredAdded.length === 1 &&
      preview.deltas[0]?.measuredAdded[0]?.pointKey === "VOLTS",
    "the delta must report the added measured point",
  );
  assert(preview.assets.length === 1 && preview.assets[0]?.fromVersion === 1, "the asset's source version must be reported");

  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "preview must not move assets.template_id — it is a read",
  );
  assert(
    (await auditRows(pool, v2)).length === 0,
    "preview must write no audit row — nothing happened to audit",
  );
  assert((await pointRows(pool, assetId)).length === 0, "preview must create no asset_points rows");
}

/**
 * Apply moves exactly the selected assets, creates the added points, writes one
 * audit row, and touches no history.
 */
export async function assertApplyMovesOnlySelectedAssets(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    // The added point carries a unit OVERRIDE. Without it this case cannot tell
    // `point.unit ?? catalogUnit ?? null` from `catalogUnit ?? null`, and the
    // second is what an early version of this service did — giving the same
    // point on the same template two different units depending on whether the
    // asset was instantiated or migrated.
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS", unit: "kV-override" }],
  });
  const moved = await seedAsset(db, fx, "MOVED", v1);
  const untouched = await seedAsset(db, fx, "UNTOUCHED", v1);

  const result = templateMigrationResultResponseSchema.parse(
    await svc.migrate(fx.adminJwt, v2, { assetIds: [moved] }),
  );

  assert((await pinnedVersion(pool, moved)) === 2, "the selected asset must be pinned to v2");
  assert(
    (await pinnedVersion(pool, untouched)) === 1,
    "an asset that was not selected must not move — this is the whole of decision 1",
  );

  // Decision 4: the measured addition creates its asset_points row, with
  // source_data_key resolved from the pattern via the asset's own code.
  const rows = await pointRows(pool, moved);
  assert(rows.length === 1, `expected 1 new asset_points row, got ${rows.length}`);
  assert(rows[0]?.point_key === "VOLTS", "the row must be for the added point");
  assert(
    rows[0]?.source_data_key === `SITE/${TEST_ASSET_PREFIX}MOVED/VOLTS`,
    `source_data_key must be resolved from the pattern via asset_code, got ${String(rows[0]?.source_data_key)}`,
  );
  // asset_points_source_ref_check: measured requires an rtu_id, everything else
  // requires none. The fixture asset has no RTU, so `unmapped` is the honest
  // record and the CHECK accepts it.
  assert(
    rows[0]?.source_kind === "unmapped" && rows[0]?.rtu_id === null,
    `source_kind must agree with rtu_id, got ${String(rows[0]?.source_kind)}/${String(rows[0]?.rtu_id)}`,
  );
  assert(
    rows[0]?.unit === "kV-override",
    `the template's unit override must reach the row, got ${String(rows[0]?.unit)}. ` +
      "Decision 4 says these rows are created by the same path instantiation uses, and " +
      "AssetTemplateInstantiationService.planAsset resolves point.unit ?? catalogUnit ?? null.",
  );
  assert(
    (await pointRows(pool, untouched)).length === 0,
    "the unselected asset must gain no points either",
  );

  // Decision 9: exactly one audit row, carrying what an operator needs.
  const audit = await auditRows(pool, v2);
  assert(audit.length === 1, `expected exactly 1 audit row, got ${audit.length}`);
  assert(
    audit[0]?.action === "master.asset_template.migrate",
    `wrong action string: ${String(audit[0]?.action)}`,
  );
  const payload = audit[0]?.payload ?? {};
  assert(payload.code === TEST_TEMPLATE_CODE, "the payload must carry the template code");
  assert(payload.toVersion === 2, "the payload must carry the target version");
  assert(
    Array.isArray(payload.fromVersions) && (payload.fromVersions as number[])[0] === 1,
    "the payload must carry the source version(s)",
  );
  assert(
    Array.isArray(payload.assetIds) && (payload.assetIds as string[])[0] === moved,
    "the payload must carry the affected asset ids",
  );

  assert(result.assetCount === 1 && result.pointsCreated === 1, "the result must report what it did");
}

/** Decision 3 — a measured removal refuses, names the point, and writes nothing. */
export async function assertMeasuredRemovalRefusesAndWritesNothing(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    version: 1,
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS" }],
  });
  const v2 = await seedVersion(db, fx, { version: 2, points: [{ pointKey: "KW" }] });
  const a = await seedAsset(db, fx, "RM-A", v1);
  const b = await seedAsset(db, fx, "RM-B", v1);

  const preview = await svc.previewMigration(fx.adminJwt, v2, { assetIds: [a, b] });
  assert(!preview.canApply, "a measured removal must not be applicable");
  assert(
    preview.refusals.some((r) => r.reason === "measured_removed" && r.pointKey === "VOLTS"),
    `the refusal must name the point key, got ${JSON.stringify(preview.refusals)}`,
  );
  assert(
    preview.refusals.some((r) => r.assetCount === 2),
    "the refusal must say how many assets carry the point — it is the size of the problem",
  );

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [a, b] }),
    /VOLTS/,
    "apply on a measured removal",
    409,
  );
  assert((await pinnedVersion(pool, a)) === 1, "asset A must not have moved");
  assert((await pinnedVersion(pool, b)) === 1, "asset B must not have moved");
  assert((await auditRows(pool, v2)).length === 0, "a refused migration writes no audit row");
}

/** Decision 3 — a measured re-key refuses, naming both patterns. */
export async function assertMeasuredReKeyRefuses(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    version: 1,
    points: [{ pointKey: "KW", sourceDataKeyPattern: "OLD/{asset_code}/KW" }],
  });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW", sourceDataKeyPattern: "NEW/{asset_code}/KW" }],
  });
  const assetId = await seedAsset(db, fx, "REKEY", v1);

  const preview = await svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] });
  assert(!preview.canApply, "a re-key must not be applicable");
  const refusal = preview.refusals.find((r) => r.reason === "measured_rekeyed");
  assert(refusal !== undefined, `expected a measured_rekeyed refusal, got ${JSON.stringify(preview.refusals)}`);
  assert(
    refusal?.message.includes("OLD/{asset_code}/KW") === true &&
      refusal?.message.includes("NEW/{asset_code}/KW") === true,
    "the refusal must name both patterns",
  );

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
    /KW/,
    "apply on a measured re-key",
    409,
  );
  assert((await pinnedVersion(pool, assetId)) === 1, "nothing must have moved");
}

/**
 * Q-A — a **required** measured addition whose pattern needs a token beyond
 * `{asset_code}` refuses the whole migration, before the transaction opens.
 *
 * The mirror case matters as much: an **optional** one is skipped and reported,
 * and the migration proceeds.
 */
export async function assertUnresolvablePatternRefusesRequiredAndSkipsOptional(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
  runCleanup: (pool: pg.Pool) => Promise<void>,
): Promise<void> {
  const db = createDb(pool);

  // required
  {
    const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
    const v2 = await seedVersion(db, fx, {
      version: 2,
      points: [
        { pointKey: "KW" },
        { pointKey: "PANEL_A", sourceDataKeyPattern: "{panel}/{asset_code}/A", required: true },
      ],
    });
    const assetId = await seedAsset(db, fx, "QA-REQ", v1);

    const preview = await svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] });
    assert(!preview.canApply, "an unresolvable required addition must not be applicable");
    const refusal = preview.refusals.find((r) => r.reason === "unresolvable_source_data_key");
    assert(refusal !== undefined, `expected an unresolvable_source_data_key refusal, got ${JSON.stringify(preview.refusals)}`);
    assert(refusal?.pointKey === "PANEL_A", "the refusal must name the point");
    assert(
      refusal?.message.includes(`${TEST_ASSET_PREFIX}QA-REQ`) === true,
      "the refusal must name the asset — which asset failed is the actionable part",
    );
    assert(
      refusal?.message.includes("{panel}") === true,
      `the refusal must name the unresolved token, got: ${String(refusal?.message)}`,
    );

    await expectRejection(
      () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
      /PANEL_A/,
      "apply with an unresolvable required addition",
      409,
    );
    assert((await pinnedVersion(pool, assetId)) === 1, "nothing must have moved");
    assert((await pointRows(pool, assetId)).length === 0, "no partial rows may exist");
  }

  await runCleanup(pool);

  // optional
  {
    const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
    const v2 = await seedVersion(db, fx, {
      version: 2,
      points: [
        { pointKey: "KW" },
        { pointKey: "PANEL_B", sourceDataKeyPattern: "{panel}/{asset_code}/B", required: false },
      ],
    });
    const assetId = await seedAsset(db, fx, "QA-OPT", v1);

    const result = await svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] });
    assert((await pinnedVersion(pool, assetId)) === 2, "an optional unresolvable point must not block");
    assert(
      result.skippedPoints.length === 1 && result.skippedPoints[0]?.pointKey === "PANEL_B",
      "the skipped point must be reported — '2 points in, 1 row out' is otherwise a bug",
    );
    assert((await pointRows(pool, assetId)).length === 0, "the skipped point creates no row");
  }
}

/** Q-B — a target version with a different `domain` refuses, naming both codes. */
export async function assertDomainChangeRefuses(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }], domain: "electrical" });
  const v2 = await seedVersion(db, fx, { version: 2, points: [{ pointKey: "KW" }], domain: "hvac" });
  const assetId = await seedAsset(db, fx, "DOMAIN", v1);

  const preview = await svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] });
  assert(!preview.canApply, "a domain change must not be applicable");
  const refusal = preview.refusals.find((r) => r.reason === "domain_changed");
  assert(refusal !== undefined, `expected a domain_changed refusal, got ${JSON.stringify(preview.refusals)}`);
  assert(refusal?.pointKey === null, "a domain change is about the version, not a point");
  assert(
    refusal?.message.includes("electrical") === true && refusal?.message.includes("hvac") === true,
    "the refusal must name both domain codes",
  );

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
    /hvac/,
    "apply across a domain change",
    409,
  );
  assert((await pinnedVersion(pool, assetId)) === 1, "nothing must have moved");
}

/** A draft or archived target refuses; a different code or org refuses differently. */
export async function assertTargetVersionIsValidated(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const draft = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }],
    status: "draft",
  });
  const otherCode = await seedVersion(db, fx, {
    version: 1,
    points: [{ pointKey: "KW" }],
    code: OTHER_TEMPLATE_CODE,
  });
  const assetId = await seedAsset(db, fx, "VALIDATE", v1);

  await expectRejection(
    () => svc.previewMigration(fx.adminJwt, draft, { assetIds: [assetId] }),
    /published/,
    "migrating onto a draft",
    409,
  );
  await expectRejection(
    () => svc.previewMigration(fx.adminJwt, otherCode, { assetIds: [assetId] }),
    /SAME template code|different piece of equipment/,
    "migrating onto a different template code",
    400,
  );
  assert((await pinnedVersion(pool, assetId)) === 1, "nothing must have moved");
}

/** An asset outside the caller's writable scope refuses, and writes nothing. */
export async function assertOutOfScopeAssetIsRefused(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS" }],
  });
  // In the location admin's own location — inside scope.
  const inScope = await seedAsset(db, fx, "SCOPE-IN", v1, { locationId: fx.rtuLocationId });
  // In another location of the same org — outside a location-scoped grant.
  const outOfScope = await seedAsset(db, fx, "SCOPE-OUT", v1, { locationId: fx.otherLocationId });

  // Deliberately specific. "access scope" alone also matches the
  // canManageOrganization refusal that runs FIRST, so a loose regex would pass
  // without ever reaching the per-asset check this case exists to prove.
  await expectRejection(
    () => svc.migrate(fx.locationAdminJwt, v2, { assetIds: [inScope, outOfScope] }),
    new RegExp(`Asset "${TEST_ASSET_PREFIX}SCOPE-OUT" is outside your access scope`),
    "migrating an asset outside the caller's scope",
    403,
  );
  assert(
    (await pinnedVersion(pool, inScope)) === 1,
    "the in-scope asset must not move either — the batch is refused as a whole",
  );
  assert((await pinnedVersion(pool, outOfScope)) === 1, "the out-of-scope asset must not move");
  assert((await auditRows(pool, v2)).length === 0, "nothing was written, so nothing was audited");
}

/** Derived-only changes migrate freely — the asymmetry decision 3 depends on. */
export async function assertDerivedChangesMigrateFreely(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    version: 1,
    points: [
      { pointKey: "KW" },
      { pointKey: "KWH", kind: "derived", sourceDataKeyPattern: null, formula: "{KW} * 2" },
    ],
  });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [
      { pointKey: "KW" },
      { pointKey: "KWH", kind: "derived", sourceDataKeyPattern: null, formula: "{KW} * 3" },
      { pointKey: "PF", kind: "derived", sourceDataKeyPattern: null, formula: "{KW} / 100" },
    ],
  });
  const assetId = await seedAsset(db, fx, "DERIVED", v1);

  const result = await svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] });
  assert((await pinnedVersion(pool, assetId)) === 2, "a derived-only delta must migrate");
  assert(
    result.pointsCreated === 0,
    "a derived addition creates no asset_points row — instantiation emits none either, and " +
      "the calc engine or an override creates it later",
  );
  assert((await pointRows(pool, assetId)).length === 0, "and no row exists");
}

/** Re-submitting a completed migration is a no-op, not a second audit row. */
export async function assertReMigrationIsANoOp(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, points: [{ pointKey: "KW" }] });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }, { pointKey: "VOLTS" }],
  });
  const assetId = await seedAsset(db, fx, "REPEAT", v1);

  await svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] });
  const afterFirst = await pointRows(pool, assetId);
  assert(afterFirst.length === 1, "the first migration creates the added point");

  const second = await svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] });
  assert(second.assetCount === 0, "an asset already on the target version is not migrated again");
  assert(
    (await pointRows(pool, assetId)).length === 1,
    "and no duplicate asset_points row is created. Note what this does NOT cover: the " +
      "asset is filtered out by `toMigrate` before any insert runs, so the unique " +
      "constraint is never exercised here. The collision path is " +
      "`assertExistingRowRefusesAMeasuredAddition`.",
  );
  assert(
    (await auditRows(pool, v2)).length === 1,
    "a no-op migration must not write a second audit row claiming a migration occurred",
  );
}

/**
 * A measured addition onto a point key the asset already has a row for is
 * refused by name, before the transaction.
 *
 * Three unrelated paths create an `asset_points` row and none knows about the
 * others: a hand-made mapping, `CalcWriteService` on a derived point's first
 * computed value, and the ADR 0039 decision 7 override endpoint. So a version
 * that turns a derived point into a measured one — "we fitted a real meter" —
 * collides with a row the operator does not think of as a mapping at all.
 *
 * Without the check in `buildPlan` this is a raw 23505 inside the transaction:
 * nothing is written, but the operator gets a driver error naming no point and
 * no asset, from a service whose contract is that every fallible decision is
 * made first.
 */
export async function assertExistingRowRefusesAMeasuredAddition(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, {
    version: 1,
    points: [
      { pointKey: "KW" },
      { pointKey: "KWH", kind: "derived", sourceDataKeyPattern: null, formula: "{KW} * 2" },
    ],
  });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    points: [{ pointKey: "KW" }, { pointKey: "KWH" }],
  });
  const assetId = await seedAsset(db, fx, "COLLIDE", v1);

  // Exactly what the override endpoint leaves behind, and what `CalcWriteService`
  // writes on the point's first computed value.
  await db.insert(assetPoints).values({
    assetId,
    pointKey: "KWH",
    sourceDataKey: "computed:KWH",
    sourceKind: "computed",
    rtuId: null,
    active: true,
    calcIntervalSeconds: 45,
  });

  const preview = await svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] });
  const refusal = preview.refusals.find((r) => r.reason === "point_key_already_mapped");
  assert(
    refusal !== undefined,
    `expected a point_key_already_mapped refusal, got ${JSON.stringify(preview.refusals)}`,
  );
  assert(refusal?.pointKey === "KWH", `the refusal must name the point, got ${String(refusal?.pointKey)}`);
  assert(
    refusal?.message.includes("COLLIDE") === true,
    `and the asset, got: ${String(refusal?.message)}`,
  );
  assert(
    refusal?.message.includes("computed") === true,
    "and must say what the existing row is, so the operator knows an override is in the way",
  );
  assert(preview.canApply === false, "a refusal must make the server's verdict false");

  await expectRejection(
    () => svc.migrate(fx.adminJwt, v2, { assetIds: [assetId] }),
    /point_key_already_mapped|already has an asset_points row/,
    "applying a migration whose measured addition collides with an existing row",
    409,
  );
  assert(
    (await pinnedVersion(pool, assetId)) === 1,
    "and the asset must stay on its old pin — nothing was written",
  );
  const rows = await pointRows(pool, assetId);
  assert(
    rows.length === 1 && rows[0]?.source_kind === "computed",
    `the existing row must be untouched, got ${JSON.stringify(rows)}`,
  );
}

/** A hand-created asset has no pin to migrate from, and says so. */
export async function assertUnpinnedAssetIsRejected(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v2 = await seedVersion(db, fx, { version: 2, points: [{ pointKey: "KW" }] });
  const assetId = await seedAsset(db, fx, "HANDMADE", null);

  await expectRejection(
    () => svc.previewMigration(fx.adminJwt, v2, { assetIds: [assetId] }),
    /created by hand|nothing to migrate from/,
    "migrating a hand-created asset",
    400,
  );
}
