import type pg from "pg";

import { assetPoints, assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { assetPointCalcConfigListResponseSchema } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import { AssetPointsAdminService } from "./asset-points.service";

/**
 * `F2.6` U7 — per-asset calc overrides against a real database
 * (ADR 0039 decisions 6, 7 and 8).
 *
 * `asset-point-calc-override.schema.spec.ts` already proves D-1 and the bounds
 * as pure functions. Everything here is a *database* outcome: which
 * `asset_points` row exists afterwards, what `source_kind` and
 * `source_data_key` it carries, that `asset_points_source_ref_check` accepts
 * it, and — the one that keeps `U1`'s estate-wide invariant true — which rows
 * this endpoint refuses to touch.
 *
 * Every expectation is read with independent SQL through the pool.
 */

export const TEST_TEMPLATE_CODE = "F26-OVERRIDE-TEST";
export const TEST_ASSET_PREFIX = "F26-OVR-TEST-";

const DERIVED_KEY = "F26_OVR_DERIVED";
const MEASURED_KEY = "F26_OVR_MEASURED";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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
      `${what}: expected HTTP ${expectedStatus}, got ${String(status)}`,
    );
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT ap.id FROM bms.asset_points ap
          JOIN bms.assets a ON a.id = ap.asset_id
         WHERE a.code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_CODE}%`]);
}

const TEMPLATE_CALC = {
  formula: `{${MEASURED_KEY}} * 2`,
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

async function seed(
  db: BmsDb,
  fx: Fixtures,
  suffix: string,
  opts: { locationId?: string } = {},
): Promise<{ assetId: string; templateId: string }> {
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_TEMPLATE_CODE}-${suffix}`,
      version: 1,
      name: `Override Fixture ${suffix}`,
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    {
      templateId: template.id,
      pointKey: MEASURED_KEY,
      kind: "measured",
      sourceDataKeyPattern: "SITE/{asset_code}/M",
      sortOrder: 0,
    },
    { templateId: template.id, pointKey: DERIVED_KEY, kind: "derived", sortOrder: 1, ...TEMPLATE_CALC },
  ]);

  const [asset] = await db
    .insert(assets)
    .values({
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: `Override Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      // `E7.1b`: `otherLocationId` lives in `organizationId` (same org, per the
      // Fixtures contract), so this keeps `assets.organization_id` consistent
      // with its location. `AssetPointCalcOverrideService` now derives the
      // `withTenant` org from this column; a NULL here would make every
      // `setOverride` in this suite a 400.
      organizationId: fx.organizationId,
      locationId: opts.locationId ?? fx.otherLocationId,
      domain: "electrical",
      templateId: template.id,
    })
    .returning({ id: assets.id });

  return { assetId: asset.id, templateId: template.id };
}

const NOTHING = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

async function rowFor(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
): Promise<
  | {
      id: string;
      source_kind: string;
      source_data_key: string;
      rtu_id: string | null;
      active: boolean;
      formula: string | null;
      calc_trigger: string | null;
      calc_interval_seconds: number | null;
      max_input_age_seconds: number | null;
    }
  | undefined
> {
  const { rows } = await pool.query(
    `SELECT id, source_kind, source_data_key, rtu_id, active, formula, calc_trigger,
            calc_interval_seconds, max_input_age_seconds
       FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  return rows[0];
}

async function auditActions(pool: pg.Pool, assetId: string): Promise<string[]> {
  const { rows } = await pool.query<{ action: string }>(
    `SELECT al.action FROM bms.audit_log al
       JOIN bms.asset_points ap ON ap.id = al.entity_id
      WHERE ap.asset_id = $1 ORDER BY al.created_at`,
    [assetId],
  );
  return rows.map((r) => r.action);
}

// --- cases ------------------------------------------------------------------

/**
 * Decision 7 — setting an override with **no** existing row creates one
 * eagerly, and `asset_points_source_ref_check` accepts it.
 */
export async function assertSetCreatesTheRowEagerly(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "CREATE");

  assert(
    (await rowFor(pool, assetId, DERIVED_KEY)) === undefined,
    "fixture check: instantiation emits no row for a derived point, so there must be none " +
      "yet — otherwise 'creates it eagerly' proves nothing",
  );

  const dto = await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, {
    ...NOTHING,
    calcIntervalSeconds: 45,
  });

  const row = await rowFor(pool, assetId, DERIVED_KEY);
  assert(row !== undefined, "the row must exist after the override");
  assert(row?.source_kind === "computed", `source_kind must be computed, got ${String(row?.source_kind)}`);
  assert(row?.rtu_id === null, "a computed row must carry no rtu_id — asset_points_source_ref_check");
  assert(
    row?.source_data_key === `computed:${DERIVED_KEY}`,
    `source_data_key must be the shared synthesised format, got ${String(row?.source_data_key)}`,
  );
  assert(row?.active === true, "the new row must be active");
  assert(row?.calc_interval_seconds === 45, "the override must be stored");
  assert(row?.formula === null, "the columns this request left null must stay null — they inherit");

  assert(dto.assetPointId === row?.id, "the DTO must report the row it created");
  assert(dto.override.calcIntervalSeconds === 45, "the DTO must report the override");
  assert(
    dto.template.calcIntervalSeconds === 300 && dto.effective.calcIntervalSeconds === 45,
    "the DTO must show template, override and effective as three separate values",
  );
  assert(
    dto.effective.formula === TEMPLATE_CALC.formula,
    "an un-overridden column must resolve to the template's value in `effective`",
  );

  assert(
    (await auditActions(pool, assetId)).join(",") === "master.asset_point.override_set",
    "exactly one audit row, with the master.asset_point.* action the other four in this " +
      "module already use",
  );
}

/** Setting an override where the row already exists updates in place. */
export async function assertSetUpdatesAnExistingRowInPlace(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "UPDATE");

  // The row CalcWriteService would have created on a first computed value.
  await db.insert(assetPoints).values({
    assetId,
    pointKey: DERIVED_KEY,
    sourceDataKey: `computed:${DERIVED_KEY}`,
    sourceKind: "computed",
    rtuId: null,
    active: true,
  });
  const before = await rowFor(pool, assetId, DERIVED_KEY);

  await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, { ...NOTHING, maxInputAgeSeconds: 30 });

  const after = await rowFor(pool, assetId, DERIVED_KEY);
  assert(after?.id === before?.id, "the existing row must be updated, not replaced");
  assert(after?.max_input_age_seconds === 30, "the override must be stored");

  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, DERIVED_KEY],
  );
  assert(Number(rows[0].n) === 1, "no second row may be created");
}

/** Clearing nulls all five and **keeps the row**. */
export async function assertClearNullsEveryColumnAndKeepsTheRow(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "CLEAR");

  await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, {
    formula: `{${MEASURED_KEY}} + 1`,
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 30,
  });
  const created = await rowFor(pool, assetId, DERIVED_KEY);

  const dto = await svc.clearOverride(fx.adminJwt, assetId, DERIVED_KEY);

  const after = await rowFor(pool, assetId, DERIVED_KEY);
  assert(
    after !== undefined && after.id === created?.id,
    "clearing must NOT delete the row — CalcWriteService may need it for the next value, " +
      "and 'no override' is five NULLs, which is what the column already means",
  );
  assert(
    after?.formula === null &&
      after?.calc_trigger === null &&
      after?.calc_interval_seconds === null &&
      after?.max_input_age_seconds === null,
    "every column must be back to NULL",
  );
  assert(
    dto.effective.calcIntervalSeconds === 300 && dto.effective.formula === TEMPLATE_CALC.formula,
    "and the point must resolve to the template's values again",
  );
  assert(
    (await auditActions(pool, assetId)).join(",") ===
      "master.asset_point.override_set,master.asset_point.override_clear",
    "one audit row per set and per clear",
  );
}

/**
 * D-1 end to end: the pure spec proves the rule, this proves the route applies
 * it **and writes nothing** when it fires.
 */
export async function assertD1IsEnforcedOnTheWritePath(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "D1");

  await expectRejection(
    () => svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, { ...NOTHING, calcTrigger: "streaming" }),
    /300/,
    "overriding calcTrigger alone against a scheduled template",
    400,
  );
  assert(
    (await rowFor(pool, assetId, DERIVED_KEY)) === undefined,
    "a rejected override must create no row — the eager create must happen after validation",
  );
  assert((await auditActions(pool, assetId)).length === 0, "and write no audit row");
}

/** A measured template point is refused; an undeclared key is refused. */
export async function assertOnlyDeclaredDerivedPointsAreOverridable(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "KINDS");

  await expectRejection(
    () => svc.setOverride(fx.adminJwt, assetId, MEASURED_KEY, { ...NOTHING, calcIntervalSeconds: 45 }),
    /measured point/,
    "overriding a measured template point",
    409,
  );
  await expectRejection(
    () => svc.setOverride(fx.adminJwt, assetId, "NOT_DECLARED", { ...NOTHING, calcIntervalSeconds: 45 }),
    /does not declare/,
    "overriding a point the pinned version does not declare",
    404,
  );
  assert(
    (await rowFor(pool, assetId, MEASURED_KEY)) === undefined,
    "neither refusal may leave a row behind",
  );
}

/**
 * **The invariant `U1` asserts of the whole estate.**
 *
 * `asset-point-calc-columns.integration.spec.ts` asserts that no
 * `source_kind <> 'computed'` row anywhere carries a calc override. Nothing but
 * this endpoint could break that, so this is what keeps it true: an existing
 * mapping row for the same `(asset_id, point_key)` is refused rather than
 * decorated with calc configuration.
 */
export async function assertAnExistingMappingRowIsNeverOverridden(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "MAPPED");

  // A mapping row for the DERIVED key — the collision case. It can arise from a
  // hand-created point, or from a template that used to declare this key as
  // measured.
  await db.insert(assetPoints).values({
    assetId,
    pointKey: DERIVED_KEY,
    sourceDataKey: "REAL/TAG/FROM/RTU",
    sourceKind: "unmapped",
    rtuId: null,
    active: true,
  });

  await expectRejection(
    () => svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, { ...NOTHING, calcIntervalSeconds: 45 }),
    /telemetry mapping|source_kind/,
    "overriding a point whose asset_points row belongs to a mapping",
    409,
  );

  const row = await rowFor(pool, assetId, DERIVED_KEY);
  assert(row?.source_kind === "unmapped", "the mapping row must be untouched");
  assert(
    row?.calc_interval_seconds === null,
    "and must carry no calc override — this is exactly what U1 asserts of the whole estate",
  );
  assert(row?.source_data_key === "REAL/TAG/FROM/RTU", "its source key must be untouched too");
}

/** An asset outside the caller's writable scope is refused. */
export async function assertOutOfScopeAssetIsRefused(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "SCOPE", { locationId: fx.otherLocationId });

  await expectRejection(
    () => svc.setOverride(fx.locationAdminJwt, assetId, DERIVED_KEY, { ...NOTHING, calcIntervalSeconds: 45 }),
    /Asset is outside your access scope/,
    "overriding an asset outside the caller's scope",
    403,
  );
  assert((await rowFor(pool, assetId, DERIVED_KEY)) === undefined, "nothing may be written");
}

/** The read returns template / override / effective triples, with a null row id. */
export async function assertReadReportsTheTriple(
  pool: pg.Pool,
  svc: AssetPointCalcOverrideService,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "READ");

  // Parsed through the contract U2 declared, not merely typed against it.
  const before = assetPointCalcConfigListResponseSchema.parse(
    await svc.listCalcPoints(fx.adminJwt, assetId),
  );
  assert(before.items.length === 1, `only the derived point is listed, got ${before.items.length}`);
  const item = before.items[0];
  assert(item?.pointKey === DERIVED_KEY, "the measured point must not appear — it has no calc config");
  assert(item?.assetPointId === null, "assetPointId is null while no row exists");
  assert(item?.override.calcIntervalSeconds === null, "nothing is overridden yet");
  assert(
    item?.effective.calcIntervalSeconds === 300 && item?.template.calcIntervalSeconds === 300,
    "effective equals template when nothing is overridden",
  );

  await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, { ...NOTHING, calcIntervalSeconds: 45 });

  const after = assetPointCalcConfigListResponseSchema.parse(
    await svc.listCalcPoints(fx.adminJwt, assetId),
  );
  const updated = after.items[0];
  assert(updated?.assetPointId !== null, "assetPointId is set once the row exists");
  assert(
    updated?.template.calcIntervalSeconds === 300 &&
      updated?.override.calcIntervalSeconds === 45 &&
      updated?.effective.calcIntervalSeconds === 45,
    "the three values must stay distinguishable — the UI shows all three",
  );
  assert(
    updated?.effective.maxInputAgeSeconds === 600,
    "and an un-overridden column must still show the template's value as effective",
  );
}

/**
 * An override formula may reference measured points only — the same rule
 * `assetTemplatePointsBodySchema` applies to a template author.
 *
 * This endpoint is a second author for the same engine, so a rule enforced in
 * one path and not the other is not a style difference. A self-reference is the
 * sharpest case: `CalcSchedulerService` stamps a fresh wall-clock bucket every
 * tick, so `ON CONFLICT DO NOTHING` never dedupes the series and the value
 * compounds each interval until it is non-finite. `{SELF} * 2` needs no unusual
 * configuration to run away — the 10-second floor against the 300-second
 * default input age keeps the previous value "fresh" on every sweep.
 *
 * It also breaks the invariant `CalcDefinitionsService.getInputKeys()` rests on
 * (ADR 0037 decision 11): a derived point is never a formula input.
 */
export async function assertFormulaCannotReferenceADerivedPoint(
  pool: pg.Pool,
  fx: Fixtures,
  svc: AssetPointCalcOverrideService,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "09");

  await expectRejection(
    () =>
      svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, {
        ...NOTHING,
        formula: `{${DERIVED_KEY}} * 2`,
        formulaDialect: "bms-calc-v1",
      }),
    // Matched on the rule, not on the offending ref: `formatCalcError`
    // deliberately never echoes a fragment of the input back.
    /unknown point/,
    "an override formula that references the derived point itself",
    400,
  );

  assert(
    (await rowFor(pool, assetId, DERIVED_KEY)) === undefined,
    "and nothing may be written — a refused override must not leave the eager row behind",
  );

  // Anti-vacuity: the same call with a measured reference must succeed, so the
  // rejection above is the ref rule and not a broken fixture.
  await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, {
    ...NOTHING,
    formula: `{${MEASURED_KEY}} * 3`,
    formulaDialect: "bms-calc-v1",
  });
  const row = await rowFor(pool, assetId, DERIVED_KEY);
  assert(
    row?.formula === `{${MEASURED_KEY}} * 3`,
    `a measured reference must still be accepted, got ${String(row?.formula)}`,
  );
}

/**
 * The row this endpoint creates cannot be re-keyed from the mapping surface.
 *
 * `AssetPointsAdminService.list` does not filter `source_kind`, so a `computed`
 * row is visible and PATCH-able beside real mappings. Changing its `point_key`
 * does one of two silent things: the calc resolution join stops matching and
 * the override goes inert while still stored, or the key lands on another
 * derived point and the old formula override starts applying to a different
 * measurement. Neither throws. Both compute a wrong number and keep going.
 */
export async function assertComputedRowCannotBeReKeyed(
  pool: pg.Pool,
  fx: Fixtures,
  svc: AssetPointCalcOverrideService,
): Promise<void> {
  const db = createDb(pool);
  const { assetId } = await seed(db, fx, "10");
  const mappingSvc = new AssetPointsAdminService(
    db,
    db,
    new AccessControlService(db, db),
    new MasterDataAuditService(db, db),
  );

  await svc.setOverride(fx.adminJwt, assetId, DERIVED_KEY, {
    ...NOTHING,
    calcIntervalSeconds: 45,
  });
  const created = await rowFor(pool, assetId, DERIVED_KEY);
  assert(created !== undefined, "the override row must exist — this test is otherwise vacuous");

  await expectRejection(
    () => mappingSvc.update(fx.adminJwt, created?.id ?? "", { pointKey: MEASURED_KEY }),
    /computed/,
    "re-keying a computed row from the mapping surface",
    409,
  );

  const after = await rowFor(pool, assetId, DERIVED_KEY);
  assert(
    after?.calc_interval_seconds === 45,
    `the row must be untouched, got ${JSON.stringify(after)}`,
  );

  // Anti-vacuity: the refusal is keyed on the point key *changing*, not on the
  // row being computed. An update that leaves the key alone must get past this
  // guard and fail further down instead — here on the catalog lookup, because a
  // template's derived key is not an organisation catalog point key.
  await expectRejection(
    () => mappingSvc.update(fx.adminJwt, created?.id ?? "", { sensorCode: "F26-SENSOR" }),
    /catalog/,
    "an update that does not change the point key",
    400,
  );
}
