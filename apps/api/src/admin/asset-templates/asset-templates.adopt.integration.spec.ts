import { randomUUID } from "node:crypto";

import type pg from "pg";

import {
  assetPoints,
  assetTemplates,
  assets,
  automationRules,
  createDb,
  pointValues,
  templatePoints,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  templateAdoptionPreviewResponseSchema,
  type TemplateAdoptionRefusalDto,
} from "@bms/shared";

import type { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import type { AssetTemplateAdoptionService } from "./asset-templates-adopt.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";
import { seededRuleValues } from "./template-alarm-rules";

/**
 * `F4.312` (ADR 0109 Amendment 1; plan PR 1) — adopting a template-less asset
 * onto a published template version, against a real database.
 *
 * The pure rules are `asset-templates-adopt-plan.spec.ts`'s. Every claim here
 * is a row — the pin, the `unmapped` row with no RTU, the rows that must NOT
 * have changed, the seeded rule, the dashboard, the audit row, the calc
 * definition the engine reads after the pin moves — or, after a refusal, the
 * rows that must not exist. Each is read back with independent SQL through the
 * owner pool, never from the service's own return value.
 *
 * Each assertion names, in its docblock, the mutation of
 * `asset-templates-adopt.service.ts` that reddens it.
 *
 * **Per-run codes.** `cleanup` sweeps by `LIKE '<prefix>%'`, so two runs on
 * one database must not share a prefix (`tests/integration-fixture-isolation.test.ts`).
 */
export const TEST_TEMPLATE_CODE = `F4312-ADOPT-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
export const TEST_ASSET_PREFIX = `F4312-AD-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}-`;

/** Point keys this suite alone registers (`asset_points.point_key` references the catalog). */
export const KW = "F4312_KW";
export const KVA = "F4312_KVA";
export const EFF = "F4312_EFF";
export const EXTRA = "F4312_EXTRA";
export const STRAY = "F4312_STRAY";
export const SUITE_POINT_KEYS = [KW, KVA, EFF, EXTRA, STRAY] as const;

const ALARM_CODE = "ADOPT_HIGH";
const VIEW = "overview";

export type Services = {
  adoption: AssetTemplateAdoptionService;
  definitions: CalcDefinitionsService;
};

/** The base fixtures plus a live rule category and severity, for the version's one alarm. */
export type AdoptFixtures = Fixtures & { categoryCode: string; severityCode: string };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function loadAdoptFixtures(pool: pg.Pool, base: Fixtures): Promise<AdoptFixtures> {
  const { rows: categories } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.rule_categories WHERE active = true ORDER BY sort_order, code LIMIT 1`,
  );
  const { rows: severities } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank, code LIMIT 1`,
  );
  const categoryCode = categories[0]?.code;
  const severityCode = severities[0]?.code;
  if (!categoryCode || !severityCode) {
    throw new Error("F4.312 fixtures missing — need a live rule category and severity. Run 'pnpm db:seed'.");
  }
  return { ...base, categoryCode, severityCode };
}

/** Deletes only this run's rows, children first (dashboards have no cascade onto templates). */
export async function cleanup(pool: pg.Pool): Promise<void> {
  const dashboardScope = `SELECT id FROM bms.dashboards WHERE slug LIKE $1`;
  await pool.query(
    `DELETE FROM bms.dashboard_widget_points WHERE widget_id IN
       (SELECT id FROM bms.dashboard_widgets WHERE dashboard_id IN (${dashboardScope}))`,
    [`${TEST_ASSET_PREFIX.toLowerCase()}%`],
  );
  await pool.query(`DELETE FROM bms.dashboard_widgets WHERE dashboard_id IN (${dashboardScope})`, [
    `${TEST_ASSET_PREFIX.toLowerCase()}%`,
  ]);
  await pool.query(`DELETE FROM bms.dashboards WHERE slug LIKE $1`, [
    `${TEST_ASSET_PREFIX.toLowerCase()}%`,
  ]);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [
    `${TEST_ASSET_PREFIX}%`,
  ]);
  const ids = rows.map((row) => row.id);
  await pool.query(`DELETE FROM bms.automation_rules WHERE asset_id = ANY($1::uuid[])`, [ids]);
  // `asset_id =` — a segmentby filter, so the delete prunes compressed batches (ADR 0024).
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [ids]);
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)`,
    [`${TEST_TEMPLATE_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_CODE}%`]);
}

// --- fixture builders -------------------------------------------------------

/**
 * One version: `KW` and `KVA` measured, `EFF` derived (`{KW} * 2`, every 60 s),
 * one alarm on `KW` and one default dashboard view featuring `KW`. Inserted
 * straight through Drizzle, as the migrate suites seed their versions.
 */
export async function seedVersion(
  db: BmsDb,
  fx: AdoptFixtures,
  opts: { version?: number; status?: string; kwUnit?: string | null } = {},
): Promise<string> {
  const status = opts.status ?? "published";
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_TEMPLATE_CODE,
      version: opts.version ?? 1,
      name: "Adoption Fixture",
      assetType: "test_rig",
      domain: "electrical",
      status,
      publishedAt: status === "published" ? new Date() : null,
      content: {
        contentVersion: 1,
        alarms: [
          {
            code: ALARM_CODE,
            pointKey: KW,
            operator: "gt",
            thresholdValue: 9,
            severity: fx.severityCode,
            message: "Adoption fixture point above the class limit",
            category: fx.categoryCode,
          },
        ],
        dashboards: { [VIEW]: { featured: [KW] } },
      },
    })
    .returning({ id: assetTemplates.id });

  await db.insert(templatePoints).values([
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: KW,
      kind: "measured",
      sourceDataKeyPattern: `SITE/{asset_code}/${KW}`,
      required: true,
      unit: opts.kwUnit ?? null,
      sortOrder: 0,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: KVA,
      kind: "measured",
      sourceDataKeyPattern: `SITE/{asset_code}/${KVA}`,
      required: true,
      sortOrder: 1,
    },
    {
      organizationId: fx.organizationId,
      templateId: template.id,
      pointKey: EFF,
      kind: "derived",
      sourceDataKeyPattern: null,
      required: true,
      formula: `{${KW}} * 2`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: 300,
      sortOrder: 2,
    },
  ]);
  return template.id;
}

/**
 * A template-less asset **with an RTU** (so A3's "no RTU even when the asset
 * has one" is observable), carrying a measured `KW` row, an undeclared measured
 * `EXTRA` row (A2) and a standalone calculated `EFF` (ruling 8) whose formula
 * and interval differ from the version's.
 */
export async function seedAsset(
  db: BmsDb,
  fx: AdoptFixtures,
  suffix: string,
  opts: { templateId?: string | null; domain?: string; locationId?: string; kwUnit?: string | null } = {},
): Promise<string> {
  const onRtu = (opts.locationId ?? fx.rtuLocationId) === fx.rtuLocationId;
  const code = `${TEST_ASSET_PREFIX}${suffix}`;
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code,
      name: `Adoption Fixture Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: opts.locationId ?? fx.rtuLocationId,
      rtuId: onRtu ? fx.rtuId : null,
      domain: opts.domain ?? "electrical",
      templateId: opts.templateId ?? null,
    })
    .returning({ id: assets.id });
  const wired = (pointKey: string, unit: string | null) => ({
    assetId: asset.id,
    organizationId: fx.organizationId,
    pointKey,
    sourceDataKey: `${code}/${pointKey}/RTU`,
    // `asset_points_source_ref_check`: measured names an RTU; `manual` names none.
    sourceKind: onRtu ? "measured" : "manual",
    rtuId: onRtu ? fx.rtuId : null,
    unit,
    active: true,
  });
  await db.insert(assetPoints).values([
    wired(KW, opts.kwUnit ?? null),
    wired(EXTRA, null),
    {
      assetId: asset.id,
      organizationId: fx.organizationId,
      pointKey: EFF,
      sourceDataKey: `computed:${EFF}`,
      sourceKind: "computed",
      rtuId: null,
      unit: null,
      active: true,
      formula: `{${KVA}} + 1`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 120,
      maxInputAgeSeconds: 600,
    },
  ]);
  return asset.id;
}

/** A standalone calculated point on a key the version does not declare (A4). */
export async function seedStrayCalcPoint(db: BmsDb, fx: AdoptFixtures, assetId: string): Promise<void> {
  await db.insert(assetPoints).values({
    assetId,
    organizationId: fx.organizationId,
    pointKey: STRAY,
    sourceDataKey: `computed:${STRAY}`,
    sourceKind: "computed",
    rtuId: null,
    active: true,
    formula: `{${KW}} + 2`,
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
  });
}

/** One point_values sample of the standalone `EFF`, the history ruling 8 says continues. */
export async function seedHistory(db: BmsDb, assetId: string): Promise<void> {
  await db.insert(pointValues).values({ time: new Date(Date.now() - 60_000), assetId, pointKey: EFF, value: 4 });
}

/** The rule the version's alarm would seed on this asset, written first — the code is then taken. */
export async function takeTheSeededRuleCode(
  db: BmsDb,
  fx: AdoptFixtures,
  templateId: string,
  assetId: string,
  suffix: string,
): Promise<void> {
  await db.insert(automationRules).values(
    seededRuleValues({
      alarm: {
        code: ALARM_CODE,
        pointKey: KW,
        operator: "gt",
        thresholdValue: 1,
        severity: fx.severityCode,
        message: "Taken by hand",
        category: fx.categoryCode,
      },
      assetId,
      assetCode: `${TEST_ASSET_PREFIX}${suffix}`,
      organizationId: fx.organizationId,
      template: { id: templateId, version: 1 },
      unit: null,
      now: new Date(),
    }),
  );
}

// --- independent SQL readers ------------------------------------------------

type PointRow = {
  id: string;
  point_key: string;
  source_data_key: string;
  source_kind: string;
  rtu_id: string | null;
  unit: string | null;
};

export async function pointRows(pool: pg.Pool, assetId: string): Promise<PointRow[]> {
  const { rows } = await pool.query<PointRow>(
    `SELECT id, point_key, source_data_key, source_kind, rtu_id, unit FROM bms.asset_points
      WHERE asset_id = $1 ORDER BY point_key`,
    [assetId],
  );
  return rows;
}

export async function pinOf(pool: pg.Pool, assetId: string): Promise<string | null> {
  const { rows } = await pool.query<{ template_id: string | null }>(
    `SELECT template_id FROM bms.assets WHERE id = $1`,
    [assetId],
  );
  return rows[0]?.template_id ?? null;
}

async function countOf(pool: pg.Pool, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const seededRuleCount = (pool: pg.Pool, assetId: string, templateId: string): Promise<number> =>
  countOf(
    pool,
    `SELECT COUNT(*)::text AS n FROM bms.automation_rules
      WHERE asset_id = $1 AND source = 'template_alarm' AND source_template_id = $2`,
    [assetId, templateId],
  );

const dashboardCount = (pool: pg.Pool, assetId: string): Promise<number> =>
  countOf(pool, `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE asset_id = $1`, [assetId]);

const adoptAuditCount = (pool: pg.Pool, templateId: string): Promise<number> =>
  countOf(
    pool,
    `SELECT COUNT(*)::text AS n FROM bms.audit_log
      WHERE entity_id = $1 AND action = 'master.asset_template.adopt'`,
    [templateId],
  );

/** What a refused call must have left: no pin, the three seeded rows only, no rule, no dashboard, no audit. */
export async function assertNothingWritten(
  pool: pg.Pool,
  assetId: string,
  templateId: string,
  what: string,
): Promise<void> {
  const state = {
    pin: await pinOf(pool, assetId),
    rows: (await pointRows(pool, assetId)).map((row) => row.point_key).filter((key) => key !== STRAY),
    rules: await seededRuleCount(pool, assetId, templateId),
    dashboards: await dashboardCount(pool, assetId),
    audit: await adoptAuditCount(pool, templateId),
  };
  assert(
    JSON.stringify(state) ===
      JSON.stringify({ pin: null, rows: [EFF, EXTRA, KW], rules: 0, dashboards: 0, audit: 0 }),
    `${what}: a refused adoption must write nothing, found ${JSON.stringify(state)}`,
  );
}

/**
 * Runs a call that must be refused with a 409 refusal body; returns the refusals.
 * The class is graded as well as the body: a 400 with the right words is wrong.
 */
export async function expectRefusal(
  run: () => Promise<unknown>,
  what: string,
): Promise<TemplateAdoptionRefusalDto[]> {
  let status: number | null = null;
  let refusals: TemplateAdoptionRefusalDto[] | null = null;
  let message = "";
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    status = typeof getStatus === "function" ? getStatus.call(err) : null;
    const response = (err as { response?: { refusals?: unknown; message?: unknown } } | null)?.response;
    refusals = Array.isArray(response?.refusals) ? (response.refusals as TemplateAdoptionRefusalDto[]) : null;
    message = typeof response?.message === "string" ? response.message : String(err);
  }
  assert(status === 409, `${what}: expected HTTP 409, got ${String(status)} — "${message}"`);
  assert(refusals !== null, `${what}: the 409 carried no refusals array — "${message}"`);
  return refusals ?? [];
}

/** Runs a call that must fail with `status` and a message matching `match`. */
export async function expectStatus(
  run: () => Promise<unknown>,
  status: number,
  match: RegExp,
  what: string,
): Promise<void> {
  let got: number | null = null;
  let message = "";
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    got = typeof getStatus === "function" ? getStatus.call(err) : null;
    message = err instanceof Error ? err.message : String(err);
  }
  assert(got === status && match.test(message), `${what}: expected ${status} ${match}, got ${String(got)} "${message}"`);
}

// --- the clean adoption: one scenario, one claim per assertion ----------------

export type Scenario = {
  templateId: string;
  assetId: string;
  /** The `asset_points` rows before adoption. */
  before: PointRow[];
  /** The preview's canApply, taken before the apply. */
  previewCanApply: boolean;
};

/** Seeds the scenario, previews, then adopts — once, for every claim below. */
export async function adoptTheScenario(pool: pg.Pool, svc: Services, fx: AdoptFixtures): Promise<Scenario> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "CLEAN");
  await seedHistory(db, assetId);
  const before = await pointRows(pool, assetId);
  const preview = templateAdoptionPreviewResponseSchema.parse(
    await svc.adoption.preview(fx.adminJwt, templateId, { assetIds: [assetId] }),
  );
  await svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] });
  return { templateId, assetId, before, previewCanApply: preview.canApply };
}

/** Mutation: `canApply` computed from anything but `refusalCount === 0`, or a spurious refusal. */
export function assertThePreviewCouldApply(s: Scenario): void {
  assert(s.previewCanApply, "a clean adoption's preview must report canApply: true");
}

/** Mutation: the pin `UPDATE` removed, or set to another id. */
export async function assertThePinIsSet(pool: pg.Pool, s: Scenario): Promise<void> {
  const pin = await pinOf(pool, s.assetId);
  assert(pin === s.templateId, `assets.template_id must be the version, got ${String(pin)}`);
}

/** Mutation: the added row inherits the asset's RTU as `measured` (migrate's rule, not A3's). */
export async function assertTheMissingPointIsUnmappedWithNoRtu(pool: pg.Pool, s: Scenario, code: string): Promise<void> {
  const row = (await pointRows(pool, s.assetId)).find((r) => r.point_key === KVA);
  const got = row && { kind: row.source_kind, rtu: row.rtu_id, key: row.source_data_key };
  assert(
    JSON.stringify(got) === JSON.stringify({ kind: "unmapped", rtu: null, key: `SITE/${code}/${KVA}` }),
    `the missing measured point must be an unmapped row with rtu_id NULL, got ${JSON.stringify(got)}`,
  );
}

const rowOf = (rows: PointRow[], key: string): PointRow | undefined => rows.find((r) => r.point_key === key);

/** Mutation: adoption rewrites a kept row (its source key, kind, RTU or unit) or re-creates it. */
export async function assertTheMeasuredRowIsUnchanged(pool: pg.Pool, s: Scenario): Promise<void> {
  const after = rowOf(await pointRows(pool, s.assetId), KW);
  assert(
    JSON.stringify(after) === JSON.stringify(rowOf(s.before, KW)),
    `the measured row must be untouched, before ${JSON.stringify(rowOf(s.before, KW))}, after ${JSON.stringify(after)}`,
  );
}

/** Mutation: rows the version does not declare are deleted (A2 says kept). */
export async function assertTheUndeclaredRowIsKept(pool: pg.Pool, s: Scenario): Promise<void> {
  const after = rowOf(await pointRows(pool, s.assetId), EXTRA);
  assert(
    JSON.stringify(after) === JSON.stringify(rowOf(s.before, EXTRA)),
    `the undeclared row must be untouched, got ${JSON.stringify(after)}`,
  );
}

/**
 * Ruling 8, as the engine reads it: exactly one definition for `(asset, EFF)`,
 * carrying the TEMPLATE point id (the template read, not the standalone one)
 * and the ROW's formula and interval (the override wins). Mutation: the pin not
 * moved (the standalone read keeps it, with the row's id); the computed row
 * rewritten to the template's formula; or the row deleted (the template's
 * formula and 60 s).
 */
export async function assertTheEngineReadsTheRowAsTheOverride(
  pool: pg.Pool,
  svc: Services,
  s: Scenario,
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.template_points WHERE template_id = $1 AND point_key = $2`,
    [s.templateId, EFF],
  );
  const definitions = (await svc.definitions.getAllDefinitionsFresh())
    .filter((d) => d.assetId === s.assetId && d.pointKey === EFF)
    .map((d) => ({ id: d.templatePointId, refs: d.refs, interval: d.intervalSeconds }));
  const expected = [{ id: rows[0]?.id, refs: [KVA], interval: 120 }];
  assert(
    JSON.stringify(definitions) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(definitions)}`,
  );
}

/** Mutation: the standalone point's history deleted on conversion. */
export async function assertTheHistoryIsKept(pool: pg.Pool, s: Scenario): Promise<void> {
  const n = await countOf(
    pool,
    `SELECT COUNT(*)::text AS n FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2`,
    [s.assetId, EFF],
  );
  assert(n === 1, `the converted point's history must stay, found ${n} samples`);
}

/** Mutation: the seeded-rule insert removed, or run once per alarm per asset twice. */
export async function assertOneSeededRule(pool: pg.Pool, s: Scenario): Promise<void> {
  const n = await seededRuleCount(pool, s.assetId, s.templateId);
  assert(n === 1, `the version's one alarm must seed one rule, found ${n}`);
}

/** Mutation: `instantiateForAssets` not called. */
export async function assertOneDashboard(pool: pg.Pool, s: Scenario): Promise<void> {
  const n = await dashboardCount(pool, s.assetId);
  assert(n === 1, `the version's one view must write one dashboard, found ${n}`);
}

/** Mutation: the audit write removed, or written per asset per row. */
export async function assertOneAuditRow(pool: pg.Pool, s: Scenario): Promise<void> {
  const n = await adoptAuditCount(pool, s.templateId);
  assert(n === 1, `one adoption must write one master.asset_template.adopt row, found ${n}`);
}

// --- refusals ----------------------------------------------------------------

/** A4. Mutation: the planner keeps an undeclared computed row. */
export async function assertAnUndeclaredStandalonePointRefusesAndWritesNothing(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "A4");
  await seedStrayCalcPoint(db, fx, assetId);
  const refusals = await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    "A4",
  );
  assert(
    refusals.some((r) => r.reason === "standalone_calc_not_declared" && r.pointKey === STRAY),
    `expected standalone_calc_not_declared on ${STRAY}, got ${JSON.stringify(refusals)}`,
  );
  await assertNothingWritten(pool, assetId, templateId, "A4");
}

/** A8. Mutation: the unit check removed, or the refusal not honoured by `adopt`. */
export async function assertAUnitMismatchRefusesAndWritesNothing(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx, { kwUnit: "kW" });
  const assetId = await seedAsset(db, fx, "A8", { kwUnit: "W" });
  const refusals = await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    "A8",
  );
  assert(
    refusals.some((r) => r.reason === "unit_mismatch" && r.pointKey === KW),
    `expected unit_mismatch on ${KW}, got ${JSON.stringify(refusals)}`,
  );
  await assertNothingWritten(pool, assetId, templateId, "A8");
}

/** All or nothing. Mutation: a refused asset dropped from the batch and the rest adopted. */
export async function assertAPinnedAssetBlocksTheWholeBatch(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const other = await seedVersion(db, fx, { version: 2 });
  const free = await seedAsset(db, fx, "FREE");
  const pinned = await seedAsset(db, fx, "PINNED", { templateId: other });
  await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [free, pinned] }),
    "a pinned asset in the batch",
  );
  await assertNothingWritten(pool, free, templateId, "the template-less asset of a refused batch");
}

/** A1. Mutation: the domain comparison removed from the planner. */
export async function assertADomainMismatchRefuses(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "WATER", { domain: "water" });
  const refusals = await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    "a domain mismatch",
  );
  // Exactly one: a domain-refused asset gets no point-by-point plan (and no gate runs on it).
  assert(
    refusals.map((r) => r.reason).join() === "domain_mismatch",
    `expected exactly domain_mismatch, got ${JSON.stringify(refusals)}`,
  );
}

/** Owner ruling 1. Mutation: `adopt` trusts a cached or echoed plan instead of rebuilding it. */
export async function assertApplyRecomputesAfterACleanPreview(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "RECOMPUTE");
  const preview = await svc.adoption.preview(fx.adminJwt, templateId, { assetIds: [assetId] });
  assert(preview.canApply, "fixture defect: the preview must be clean before the state changes");
  await seedStrayCalcPoint(db, fx, assetId);
  await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    "an adoption whose plan changed after a clean preview",
  );
  await assertNothingWritten(pool, assetId, templateId, "recompute");
}

/** A10. Mutation: the writable-scope count refusal removed. */
export async function assertAnAssetOutsideTheCallersScopeIs403(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const outside = await seedAsset(db, fx, "OUTSIDE", { locationId: fx.otherLocationId });
  await expectStatus(
    () => svc.adoption.adopt(fx.locationAdminJwt, templateId, { assetIds: [outside] }),
    403,
    /1 asset in this batch is outside your access scope/,
    "an asset outside the location admin's scope",
  );
}

/** A1. Mutation: the `status !== "published"` check removed. */
export async function assertAnUnpublishedVersionIs409(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const draft = await seedVersion(db, fx, { status: "draft" });
  const assetId = await seedAsset(db, fx, "DRAFT");
  await expectStatus(
    () => svc.adoption.preview(fx.adminJwt, draft, { assetIds: [assetId] }),
    409,
    /published/,
    "adopting onto a draft",
  );
}

/** Mutation: `refuseTakenRuleCodes` not called, so the apply reaches the insert. */
export async function assertARuleCodeTakenAfterThePreviewRefusesAndWritesNothing(
  pool: pg.Pool,
  svc: Services,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "RULE");
  const preview = await svc.adoption.preview(fx.adminJwt, templateId, { assetIds: [assetId] });
  assert(preview.canApply, "fixture defect: the preview must be clean before the code is taken");
  await takeTheSeededRuleCode(db, fx, templateId, assetId, "RULE");
  const refusals = await expectRefusal(
    () => svc.adoption.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    "a rule code taken between preview and apply",
  );
  const state = {
    reasons: refusals.map((r) => r.reason),
    pin: await pinOf(pool, assetId),
    added: (await pointRows(pool, assetId)).some((row) => row.point_key === KVA),
  };
  assert(
    JSON.stringify(state) === JSON.stringify({ reasons: ["rule_code_taken"], pin: null, added: false }),
    `expected a rule_code_taken refusal and nothing written, got ${JSON.stringify(state)}`,
  );
}

/**
 * The write-time net: a rule code taken after the plan was read (the plan's
 * rule-code check bypassed) hits `automation_rules_org_code_idx` inside the
 * transaction, and the WHOLE transaction rolls back — pin and `unmapped` rows
 * included — as a 409. Mutation: the rule insert moved outside the transaction,
 * or the `translateAssetCodeCollision` catch removed (a raw 23505 is a 500).
 */
export async function assertARuleCodeCollisionAtTheInsertRollsBackTheTransaction(
  pool: pg.Pool,
  racing: AssetTemplateAdoptionService,
  fx: AdoptFixtures,
): Promise<void> {
  const db = createDb(pool);
  const templateId = await seedVersion(db, fx);
  const assetId = await seedAsset(db, fx, "RACE");
  await takeTheSeededRuleCode(db, fx, templateId, assetId, "RACE");
  await expectStatus(
    () => racing.adopt(fx.adminJwt, templateId, { assetIds: [assetId] }),
    409,
    /rule code .* was taken/,
    "a rule code collision at the insert",
  );
  const state = {
    pin: await pinOf(pool, assetId),
    added: (await pointRows(pool, assetId)).some((row) => row.point_key === KVA),
    audit: await adoptAuditCount(pool, templateId),
  };
  assert(
    JSON.stringify(state) === JSON.stringify({ pin: null, added: false, audit: 0 }),
    `the whole transaction must roll back, found ${JSON.stringify(state)}`,
  );
}
