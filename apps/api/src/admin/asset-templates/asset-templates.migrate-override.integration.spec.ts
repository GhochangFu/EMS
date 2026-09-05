import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetPoints, assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { CALC_DIALECT, CALC_DIALECT_V2, templateMigrationPreviewResponseSchema } from "@bms/shared";
import type { AssetPointCalcOverrideFields, TemplateMigrationRefusalDto } from "@bms/shared";

import { validateMergedCalcOverride } from "../asset-points/asset-point-calc-override.schema";
import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";

/**
 * `F2.9` Task 12b — what a migration does to an asset's **own** calc override
 * (ADR 0039 decision 2, "no blind apply"; plan findings 31 and 34).
 *
 * ## A sibling file, not more cases in the migrate suite
 *
 * `asset-templates.migrate.integration.spec.ts` is 908 lines against AGENTS.md
 * §4.5's 1000-line cap, and the plan's finding 19 ruled a sibling rather than a
 * squeeze. The subject is also genuinely different: that suite is about the
 * *versions* — what the delta says and what rows a migration writes — and this
 * one is about the one input the delta cannot see. `computeTemplateVersionDelta`
 * is pure over two arrays of template points; an asset's override is not one of
 * its arguments, and cannot be without making `migration-preview` compute
 * something other than what it displays.
 *
 * ## The defect these cases exist to hold
 *
 * An override states only the columns it sets and inherits the rest. So an
 * asset can carry a **legal** dialect-only `bms-calc-v1` override — the formula
 * comes from the template — and a later version can rewrite that formula into
 * `bms-calc-v2`. Migrate repoints `assets.template_id`, and the merged pair is
 * now a `v2` formula wearing a `v1` label: a pair **no code path had ever
 * validated**, because the delta routes a formula/dialect change into
 * `derivedChanged` and migrate consumed `refusals` alone. The read-time
 * refusals `toActiveDefinition` and `CalcDefinitionsService.reload()` gained in
 * PR 1 bound the damage; they do not stop the migration that causes it.
 *
 * ## Why these are integration cases and not unit ones
 *
 * The claim is "**and `assets.template_id` did not move**". A 400 with the
 * migration applied anyway is the failure this task exists to stop, and no
 * assertion on a response body can see it — the pin is a row. Every expectation
 * below is therefore read back with independent SQL through the pool, never
 * from the service's own return value.
 */

/**
 * Per-run fixture codes, not constants.
 *
 * `cleanup` sweeps `WHERE code LIKE '<prefix>%'`, and two instances of this one
 * file against one database — a re-run started before the first finished, or
 * two CI shards — would otherwise delete each other's committed rows mid-test.
 * `tests/integration-fixture-isolation.test.ts` enforces this, and its
 * exemption list may only get shorter, so a new suite starts compliant.
 *
 * The two ids are drawn independently on purpose: the template code and the
 * asset prefix are separate namespaces, and nothing here joins them by string.
 */
export const TEST_TEMPLATE_CODE = `F29-MIGOV-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
export const TEST_ASSET_PREFIX = `F29-MIGOV-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}-`;

/**
 * Point keys owned by this suite alone.
 *
 * `bms.asset_points.point_key` and `bms.template_points.point_key` both
 * reference `point_keys(code)` (migrations `0057`/`0058`), and
 * `registerFixturePointKeys` deletes only the codes it actually inserted. Two
 * suites sharing `KW` would therefore be fine until the first one to finish
 * removed it — so this suite invents its own rather than borrowing the migrate
 * suite's, and never deletes a code another suite is standing on.
 */
export const MEASURED_KEY = "F29MO_KW";
export const DERIVED_KEY = "F29MO_AGG";
/** Declared by one target version only — see the "declared comes from the
 * target" assertion in {@link assertAnOverrideStillLegalOnTheTargetVersionMigrates}. */
export const LATER_MEASURED_KEY = "F29MO_KW2";

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

/** What the derived point of one version declares. Defaults are a legal `v2`. */
type DerivedSpec = {
  formula: string;
  formulaDialect?: string;
  calcTrigger?: string;
  calcIntervalSeconds?: number | null;
  maxInputAgeSeconds?: number | null;
  minCoverageRatio?: number | null;
};

/**
 * One published version: one measured point and one derived point.
 *
 * The rows are inserted straight through Drizzle rather than through
 * `AssetTemplatesAdminService`, exactly as the migrate suite seeds its
 * versions. That is deliberate here: the subject is what **migrate** admits
 * about a stored pair, and routing the fixture through the authoring path would
 * make these cases depend on which shapes that path happens to accept today.
 */
async function seedVersion(
  db: BmsDb,
  fx: Fixtures,
  opts: { version: number; derived: DerivedSpec; extraMeasuredKey?: string },
): Promise<string> {
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version: opts.version,
      name: `Migrate Override Fixture v${opts.version}`,
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
      // Identical across every version this suite seeds: a changed pattern is
      // `measured_rekeyed`, which would refuse the migration for a reason that
      // has nothing to do with the override.
      sourceDataKeyPattern: `SITE/{asset_code}/${MEASURED_KEY}`,
      required: true,
      sortOrder: 0,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: DERIVED_KEY,
      kind: "derived",
      sourceDataKeyPattern: null,
      required: true,
      formula: opts.derived.formula,
      formulaDialect: opts.derived.formulaDialect ?? CALC_DIALECT_V2,
      calcTrigger: opts.derived.calcTrigger ?? "scheduled",
      calcIntervalSeconds:
        opts.derived.calcIntervalSeconds === undefined ? 60 : opts.derived.calcIntervalSeconds,
      maxInputAgeSeconds:
        opts.derived.maxInputAgeSeconds === undefined ? 300 : opts.derived.maxInputAgeSeconds,
      minCoverageRatio: opts.derived.minCoverageRatio ?? null,
      sortOrder: 1,
    },
  ]);

  if (opts.extraMeasuredKey !== undefined) {
    await db.insert(templatePoints).values({
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: opts.extraMeasuredKey,
      kind: "measured",
      sourceDataKeyPattern: `SITE/{asset_code}/${opts.extraMeasuredKey}`,
      required: true,
      sortOrder: 2,
    });
  }

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
      name: `Migrate Override Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId,
    })
    .returning({ id: assets.id });
  return asset.id;
}

/**
 * The `asset_points` row `PUT .../calc-points/:key` would have written.
 *
 * `source_kind = 'computed'` with a synthesised `computed:<key>` source key and
 * no `rtu_id` — the combination `asset_points_source_ref_check` accepts for a
 * derived point, and the one `AssetPointCalcOverrideService` creates.
 */
async function seedOverrideRow(
  db: BmsDb,
  fx: Fixtures,
  assetId: string,
  override: AssetPointCalcOverrideFields,
  /**
   * `computed` unless a case says otherwise. `manual` is the one other kind
   * that can carry these columns and a NULL `rtu_id` —
   * `asset_points_source_ref_check` requires an RTU for `measured` — and it
   * stands for the whole "this row is not calc configuration" class that PR 2
   * review fix 6 is about.
   */
  sourceKind: "computed" | "manual" = "computed",
): Promise<void> {
  await db.insert(assetPoints).values({
    assetId,
    organizationId: fx.organizationId,
    pointKey: DERIVED_KEY,
    sourceDataKey: sourceKind === "computed" ? `computed:${DERIVED_KEY}` : "manual",
    sourceKind,
    rtuId: null,
    active: true,
    unit: null,
    ...override,
  });
}

/** The five columns of the derived point, as one version declares them. */
function templateFieldsOf(derived: DerivedSpec): AssetPointCalcOverrideFields {
  return {
    formula: derived.formula,
    formulaDialect: (derived.formulaDialect ??
      CALC_DIALECT_V2) as AssetPointCalcOverrideFields["formulaDialect"],
    calcTrigger: (derived.calcTrigger ?? "scheduled") as AssetPointCalcOverrideFields["calcTrigger"],
    calcIntervalSeconds:
      derived.calcIntervalSeconds === undefined ? 60 : derived.calcIntervalSeconds,
    maxInputAgeSeconds: derived.maxInputAgeSeconds === undefined ? 300 : derived.maxInputAgeSeconds,
  };
}

/** What this suite's versions declare, in the shape the merge rules take. */
const DECLARED = { measured: [MEASURED_KEY], all: [MEASURED_KEY, DERIVED_KEY] };

/**
 * A dialect-only override: the formula stays the template's.
 *
 * Written as all five columns with four NULLs rather than as a partial, because
 * that is what the row holds and what the merge takes — NULL means "inherit",
 * and the whole defect lives in the columns this override does *not* state.
 */
const DIALECT_ONLY_V1: AssetPointCalcOverrideFields = {
  formula: null,
  formulaDialect: CALC_DIALECT,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

/**
 * An override that states **one unrelated column** and nothing about the
 * formula.
 *
 * This is the shape that makes PR 2 review fix 2 visible.
 * `validateMergedCalcOverride` deliberately does not re-parse a stored formula
 * for an override like this — a template formula that no longer validates is
 * `toActiveDefinition`'s counted skip to report, and refusing an unrelated
 * staleness override for it would strand the asset. So gate one cannot see the
 * formula at all here, and whatever the target version's formula does is
 * entirely gate two's to catch.
 */
const AGE_ONLY: AssetPointCalcOverrideFields = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: 120,
};

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

async function overrideRow(
  pool: pg.Pool,
  assetId: string,
): Promise<{ formula: string | null; formula_dialect: string | null } | undefined> {
  const { rows } = await pool.query<{ formula: string | null; formula_dialect: string | null }>(
    `SELECT formula, formula_dialect FROM bms.asset_points
      WHERE asset_id = $1 AND point_key = $2`,
    [assetId, DERIVED_KEY],
  );
  return rows[0];
}

/**
 * Runs a migration that must be refused, and returns the refusals it carried.
 *
 * The class is asserted as well as the text: `migrate` throws
 * `ConflictException`, U8 branches on 409 versus 400, and a service throwing
 * the wrong one with the right words in it passes every message-only check.
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

// --- cases ------------------------------------------------------------------

/**
 * **The case this task exists for.** An override that was legal on the version
 * the asset sits on, and is not on the version it would move to, refuses — and
 * the pin does not move.
 *
 * Two target versions, because the same defect has two shapes:
 *
 * 1. `{DERIVED_KEY} * 2` — the plan's `{SELF} * 2`, finding 34 word for word.
 *    Under the inherited `bms-calc-v1` label a self-reference is an unknown
 *    reference (a `v1` formula may name measured points only), and were it ever
 *    evaluated under `v1` it would compound its own stored value every tick.
 * 2. `sum({MEASURED_KEY} @site)` — the same defect in the shape a template
 *    author can actually save today, since Task 12's save-time cycle detector
 *    refuses (1) on a template. It is `bms-calc-v2`-only grammar, so under a
 *    `v1` label it does not even tokenize.
 *
 * The control is `B`, the same version pair with no override at all: it
 * migrates. Without it a bug that refused *every* migration onto these versions
 * would pass both assertions above.
 */
export async function assertAnOverrideMadeIllegalByTheTargetVersionRefusesAndPinsNothing(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const sourceDerived: DerivedSpec = { formula: `{${MEASURED_KEY}} * 2` };
  const v1 = await seedVersion(db, fx, { version: 1, derived: sourceDerived });
  const selfRef = await seedVersion(db, fx, {
    version: 2,
    derived: { formula: `{${DERIVED_KEY}} * 2` },
  });
  const aggregate = await seedVersion(db, fx, {
    version: 3,
    derived: { formula: `sum({${MEASURED_KEY}} @site)` },
  });

  const overridden = await seedAsset(db, fx, "OVR", v1);
  const control = await seedAsset(db, fx, "CTL", v1);
  await seedOverrideRow(db, fx, overridden, DIALECT_ONLY_V1);

  // The fixture's own gate. If the override is not legal where it sits, the
  // refusals below would be about a broken row rather than about the migration,
  // and this suite would prove nothing. Checked with the same function the
  // write path uses, which is what "it would have been accepted" means.
  const priorProblems = validateMergedCalcOverride(
    DIALECT_ONLY_V1,
    templateFieldsOf(sourceDerived),
    DECLARED,
  );
  assert(
    priorProblems.length === 0,
    `fixture defect: the dialect-only override is not legal on version 1 either ` +
      `(${priorProblems.join(" ")}). These cases must start from an override the write ` +
      `path would have accepted, or they say nothing about migration.`,
  );

  // Decision 2 is about the operator seeing this before pressing the button,
  // not only about `migrate` throwing once they do.
  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, selfRef, { assetIds: [overridden] }),
  );
  assert(
    preview.canApply === false,
    "migration-preview must report canApply: false — an operator who is shown a green " +
      "preview and a 409 on apply has been told the server changed its mind",
  );
  assert(
    preview.refusals.some((r) => r.reason === "calc_override_invalid_on_target"),
    `the preview must carry the override refusal, got ` +
      `[${preview.refusals.map((r) => r.reason).join(", ")}]`,
  );

  const selfRefRefusals = await expectRefusal(
    () => svc.migrate(fx.adminJwt, selfRef, { assetIds: [overridden] }),
    "a v1-labelled self-reference",
  );
  const refusal = selfRefRefusals.find((r) => r.reason === "calc_override_invalid_on_target");
  assert(
    refusal !== undefined,
    `expected a calc_override_invalid_on_target refusal, got ` +
      `[${selfRefRefusals.map((r) => r.reason).join(", ")}]. A formula/dialect change reaches ` +
      `derivedChanged and never refusals, so a migrate that consults the delta alone applies ` +
      `this one blind (ADR 0039 decision 2).`,
  );
  assert(
    refusal?.pointKey === DERIVED_KEY,
    `the refusal must name the point, got ${String(refusal?.pointKey)}`,
  );
  assert(
    refusal?.message.includes(`${TEST_ASSET_PREFIX}OVR`) === true,
    `the refusal must name the asset — an estate-wide "an override is invalid" is not ` +
      `actionable. Got "${refusal?.message}"`,
  );

  assert(
    (await pinnedVersion(pool, overridden)) === 1,
    "the refused asset must still be pinned to version 1. A 409 with the pin already moved " +
      "is the failure this whole case exists to stop, and no assertion on the response body " +
      "can see it.",
  );

  await expectRefusal(
    () => svc.migrate(fx.adminJwt, aggregate, { assetIds: [overridden] }),
    "a v1-labelled bms-calc-v2 aggregate",
  );
  assert(
    (await pinnedVersion(pool, overridden)) === 1,
    "the aggregate target must not move the pin either — this is the reachable shape of the " +
      "same defect, and it is the one a template author can save today",
  );

  // The control. Same versions, same points, no override row.
  await svc.migrate(fx.adminJwt, selfRef, { assetIds: [control] });
  assert(
    (await pinnedVersion(pool, control)) === 2,
    "an asset with no override of its own must still migrate onto the same target version. " +
      "Without this the two refusals above would also pass on a service that refused every " +
      "migration onto these versions for some unrelated reason.",
  );
}

/**
 * **Anti-vacuity, and the case the mutation reddens.** The same dialect-only
 * override, against a target version whose formula is legal under the merged
 * dialect, migrates.
 *
 * A gate that refuses everything is not a gate. Inverting the condition that
 * decides a merged pair is invalid must fail here — and only here, since case 1
 * would still see a refusal for the wrong reason.
 *
 * **It also pins which version the merge resolves against.** The target's
 * formula names a measured point the target version alone declares, so this
 * migration is legal only if the known-reference set comes from the version the
 * asset is moving *to*. Resolving against the source instead — the easy
 * mistake, since the source is what the asset is pinned to while the check runs
 * — refuses this as an unknown reference, and every other case here would stay
 * green.
 */
export async function assertAnOverrideStillLegalOnTheTargetVersionMigrates(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const v1 = await seedVersion(db, fx, { version: 1, derived: { formula: `{${MEASURED_KEY}} * 2` } });
  // Still `bms-calc-v2` on the template, and still legal `bms-calc-v1` once the
  // asset's dialect override is merged over it — a `v1` formula is a `v2` one
  // by decision 4's superset property, and this direction is what makes the
  // whole feature usable rather than a wall.
  const v2 = await seedVersion(db, fx, {
    version: 2,
    derived: { formula: `{${LATER_MEASURED_KEY}} * 3` },
    extraMeasuredKey: LATER_MEASURED_KEY,
  });

  const asset = await seedAsset(db, fx, "OK", v1);
  await seedOverrideRow(db, fx, asset, DIALECT_ONLY_V1);

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [asset] }),
  );
  assert(
    preview.canApply === true,
    `a legal merged pair must preview as applicable, got refusals ` +
      `[${preview.refusals.map((r) => `${r.reason}: ${r.message}`).join(" | ")}]. If the ` +
      `refusal names "${LATER_MEASURED_KEY}" as an unknown reference, the merge is being ` +
      `validated against the version the asset is leaving rather than the one it is moving to.`,
  );

  await svc.migrate(fx.adminJwt, v2, { assetIds: [asset] });
  assert(
    (await pinnedVersion(pool, asset)) === 2,
    "an override that is still legal on the target version must not block the migration",
  );

  const row = await overrideRow(pool, asset);
  assert(
    row?.formula_dialect === CALC_DIALECT && row?.formula === null,
    `the override row must survive the migration untouched — a dialect-only override, still ` +
      `inheriting its formula. Got formula ${String(row?.formula)}, dialect ` +
      `${String(row?.formula_dialect)}. Migration moves the pin; it is not a rewrite of the ` +
      `asset's own configuration.`,
  );
}

/**
 * Finding 31 — a version bump that changes **only** `min_coverage_ratio` is
 * reported by `migration-preview`, not silently applied.
 *
 * The ratio is a `template_points` column with no `asset_points` counterpart
 * (ADR 0055 decision 11 refuses a per-asset override of it), so the delta's
 * five-field comparison could not see it and the preview said "no changes"
 * about a migration that changes when the formula computes at all: `null` means
 * every declared member of the aggregate must be fresh, so `0.8 -> null` can
 * move a computing formula to fail-closed with nobody told.
 *
 * No override is involved, deliberately. This half of the defect hits every
 * asset on the version, overridden or not.
 */
export async function assertARatioOnlyChangeIsReportedByPreview(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const formula = `sum({${MEASURED_KEY}} @site)`;
  const v1 = await seedVersion(db, fx, {
    version: 1,
    derived: { formula, minCoverageRatio: 0.8 },
  });
  const v2 = await seedVersion(db, fx, {
    version: 2,
    derived: { formula, minCoverageRatio: null },
  });
  const asset = await seedAsset(db, fx, "RATIO", v1);

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, v2, { assetIds: [asset] }),
  );
  const delta = preview.deltas.find((d) => d.fromVersion === 1 && d.toVersion === 2);
  assert(delta !== undefined, "the preview must carry a delta for the version pair");

  const changed = delta?.derivedChanged.find((c) => c.pointKey === DERIVED_KEY);
  assert(
    changed !== undefined,
    `migration-preview reported no change at all. Every other field of this point is ` +
      `identical between the two versions, so an empty derivedChanged is the operator being ` +
      `told "nothing changes" about a migration that switches the aggregate to fail-closed ` +
      `on the next sweep (finding 31).`,
  );
  assert(
    changed?.changedFields.includes("minCoverageRatio") === true,
    `the change must name the ratio, got [${String(changed?.changedFields)}]`,
  );
  assert(
    changed?.fromMinCoverageRatio === 0.8 && changed?.toMinCoverageRatio === null,
    `both sides must reach the operator: expected 0.8 -> null, got ` +
      `${String(changed?.fromMinCoverageRatio)} -> ${String(changed?.toMinCoverageRatio)}. ` +
      `They are reported beside from/to rather than inside them, because from/to are the ` +
      `five columns an asset may override and decision 11 refuses a per-asset ratio.`,
  );
  assert(
    preview.canApply === true && preview.refusals.length === 0,
    "a ratio change is reported, never refused — decision 3 refuses measured changes only",
  );

  assert(
    (await pinnedVersion(pool, asset)) === 1,
    "a preview writes nothing: the asset must still be pinned to version 1",
  );
}

/**
 * **PR 2 review fix 2 — migrate re-validates BOTH of the override endpoint's
 * gates, not one of them.**
 *
 * `PUT /admin/assets/:id/calc-points/:key` runs `validateMergedCalcOverride`
 * **and** `CalcDependencyService.checkCandidate`. Migrate ran only the first, so
 * the docblocks claiming "migrate cannot admit a pair the write path would
 * refuse" were false as written. Task 13 made `v2` evaluate, which turned that
 * into a live failure: the asset is repointed, the merged pair is on a cycle,
 * and the formula stops computing permanently — counted and fail closed, but
 * stopped, and nobody was told at the moment of the decision.
 *
 * **The override here states `max_input_age_seconds` and nothing else**, which
 * is what makes this case only about gate two. Gate one deliberately does not
 * re-parse a stored formula for an override that names neither the formula nor
 * the dialect, so it looks at this pair and finds nothing wrong — asserted
 * below, with the same function the write path uses, before any migration runs.
 * A refusal that could have come from either gate would prove nothing about the
 * one being added.
 *
 * The cycle is the one `buildCalcGraph`'s own docblock names: `sum({SELF}
 * @site)`. `@site` resolves to the active assets at the owner's location that
 * declare the key, the owner declares it through the version it is pinned to,
 * so the owner is in its own member set and the node reads itself.
 *
 * The control asset carries the same override onto a version whose formula is
 * an aggregate over the **measured** key: same shape, same dialect, no cycle.
 * Without it a bug that refused every `v2` aggregate target would pass every
 * assertion above.
 */
export async function assertAnOverrideThatWouldCycleOnTheTargetVersionRefusesAndPinsNothing(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const sourceDerived: DerivedSpec = { formula: `{${MEASURED_KEY}} * 2` };
  const cycleDerived: DerivedSpec = { formula: `sum({${DERIVED_KEY}} @site)` };
  const acyclicDerived: DerivedSpec = { formula: `sum({${MEASURED_KEY}} @site)` };

  const v1 = await seedVersion(db, fx, { version: 1, derived: sourceDerived });
  const cyclic = await seedVersion(db, fx, { version: 2, derived: cycleDerived });
  const acyclic = await seedVersion(db, fx, { version: 3, derived: acyclicDerived });

  const onCycle = await seedAsset(db, fx, "CYC", v1);
  const control = await seedAsset(db, fx, "CYCOK", v1);
  await seedOverrideRow(db, fx, onCycle, AGE_ONLY);
  await seedOverrideRow(db, fx, control, AGE_ONLY);

  // The fixture's own gate, twice over. The override must be legal where it
  // sits, and — the part this case turns on — still legal under gate ONE on the
  // target version. If gate one refused it, the 409 below would be Task 12b's
  // refusal wearing this case's name.
  for (const [label, derived] of [
    ["version 1", sourceDerived],
    ["the cyclic target", cycleDerived],
  ] as const) {
    const problems = validateMergedCalcOverride(AGE_ONLY, templateFieldsOf(derived), DECLARED);
    assert(
      problems.length === 0,
      `fixture defect: validateMergedCalcOverride already refuses this override on ${label} ` +
        `(${problems.join(" ")}). This case must be refused by the cycle detector alone, or it ` +
        `does not test the gate it was written for.`,
    );
  }

  const preview = templateMigrationPreviewResponseSchema.parse(
    await svc.previewMigration(fx.adminJwt, cyclic, { assetIds: [onCycle] }),
  );
  assert(
    preview.canApply === false,
    "migration-preview must report canApply: false — ADR 0039 decision 2 is about the operator " +
      "seeing this before pressing the button, not only about migrate throwing once they do",
  );

  const refusals = await expectRefusal(
    () => svc.migrate(fx.adminJwt, cyclic, { assetIds: [onCycle] }),
    "an override merged onto a self-referencing site aggregate",
  );
  const refusal = refusals.find((r) => r.reason === "calc_override_invalid_on_target");
  assert(
    refusal !== undefined,
    `expected a calc_override_invalid_on_target refusal, got ` +
      `[${refusals.map((r) => r.reason).join(", ")}]. The formula change reaches derivedChanged ` +
      `and never refusals, and gate one does not re-parse a formula this override does not ` +
      `state — so only the cycle detector can refuse this pair.`,
  );
  assert(
    refusal?.message.includes("dependency cycle") === true,
    `the refusal must say which gate refused it, got "${String(refusal?.message)}"`,
  );
  assert(
    refusal?.message.includes(DERIVED_KEY) === true,
    `the refusal must name the point on the cycle, got "${String(refusal?.message)}"`,
  );

  // Read back with independent SQL. A 409 with the pin moved anyway is the
  // failure this suite exists to stop, and no response body can see it.
  assert(
    (await pinnedVersion(pool, onCycle)) === 1,
    "the refused asset must still be pinned to version 1 — nothing is written when a plan is " +
      "refused, and every fallible decision is made before the transaction opens",
  );

  await svc.migrate(fx.adminJwt, acyclic, { assetIds: [control] });
  assert(
    (await pinnedVersion(pool, control)) === 3,
    "anti-vacuity: the same override migrates onto a version whose aggregate closes no cycle, " +
      "so the refusal above is about the cycle and not about overrides, or aggregates, or v2",
  );
}

/**
 * **PR 2 review fix 6 — the re-validation reads `source_kind`, not an accident.**
 *
 * `buildPlan` iterates every `asset_points` row of every migrating asset, and
 * used to tell a calc override from a telemetry mapping by the five calc
 * columns all being NULL. `CalcDefinitionsService.reload()` explicitly refuses
 * to lean on that accident and filters `source_kind = 'computed'` instead,
 * "because the accident is one write away" — nothing stops a `manual` row from
 * carrying a `formula_dialect`, and the moment one does, migration refuses an
 * asset over a row that is not calc configuration at all.
 *
 * The two assets differ in exactly one column. The `manual` one migrates; the
 * `computed` one is refused — which is the anti-vacuity half, and proves the
 * fields really would have been read as an override.
 *
 * `manual` rather than `measured` only because `asset_points_source_ref_check`
 * requires an RTU for `measured`; the rule under test is "not `computed`".
 */
export async function assertANonComputedRowIsNotReadAsACalcOverride(
  pool: pg.Pool,
  svc: AssetTemplateMigrationService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const targetDerived: DerivedSpec = { formula: `sum({${MEASURED_KEY}} @site)` };
  const v1 = await seedVersion(db, fx, {
    version: 1,
    derived: { formula: `{${MEASURED_KEY}} * 2` },
  });
  const target = await seedVersion(db, fx, { version: 2, derived: targetDerived });

  const mapped = await seedAsset(db, fx, "MANUAL", v1);
  const overridden = await seedAsset(db, fx, "COMPUTED", v1);
  await seedOverrideRow(db, fx, mapped, DIALECT_ONLY_V1, "manual");
  await seedOverrideRow(db, fx, overridden, DIALECT_ONLY_V1);

  // The fixture's gate, and the reason this case is not vacuous: read as an
  // override, these exact fields ARE refused on the target version.
  const problems = validateMergedCalcOverride(
    DIALECT_ONLY_V1,
    templateFieldsOf(targetDerived),
    DECLARED,
  );
  assert(
    problems.length > 0,
    "fixture defect: these fields are legal on the target version, so \"the manual row " +
      "migrated\" would say nothing about whether it was read as an override",
  );

  await svc.migrate(fx.adminJwt, target, { assetIds: [mapped] });
  assert(
    (await pinnedVersion(pool, mapped)) === 2,
    "a source_kind 'manual' row is telemetry wiring, not calc configuration: its columns must " +
      "not be merged over the target version's derived point, and the migration must apply",
  );

  const refusals = await expectRefusal(
    () => svc.migrate(fx.adminJwt, target, { assetIds: [overridden] }),
    "the same fields on a computed row",
  );
  assert(
    refusals.some((r) => r.reason === "calc_override_invalid_on_target"),
    `anti-vacuity: the identical fields on a source_kind 'computed' row must still refuse, got ` +
      `[${refusals.map((r) => r.reason).join(", ")}]`,
  );
  assert(
    (await pinnedVersion(pool, overridden)) === 1,
    "the refused asset must still be pinned to version 1",
  );
}
