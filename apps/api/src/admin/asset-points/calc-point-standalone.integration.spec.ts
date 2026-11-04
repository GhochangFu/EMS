import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetPoints, assets, createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { CalcPointSetBody } from "@bms/shared";

import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import type { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 (ADR 0109 decisions 1, 3, 4) — the standalone calc-point
 * write rules against a real database.
 *
 * Every refusal is asserted twice: the status and sentence, **and** that no
 * `asset_points` row was written — the estate-wide invariant
 * `asset-point-calc-columns.integration.spec.ts` holds is that a calc column
 * never lands on a row that is not `computed`, and these are the writes that
 * could break it. Every expectation is read with independent SQL.
 *
 * Rule 6's second-organization case cannot be built here (a qualified code
 * resolves only at the owner's location, which has one organization); it is
 * `calc-point-standalone.scope.spec.ts`'s, with fakes.
 */

/** Per-run, so two instances of this file never sweep each other's rows
 * (`tests/integration-fixture-isolation.test.ts`). */
const TEST_ASSET_PREFIX = `F4311-PR2-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

/** A key no catalog holds — rule 1. Never registered. */
const NOT_A_CATALOG_KEY = `F4311_NOT_IN_CATALOG_${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** The fixture point keys, registered by the `.test.ts` wrapper (`asset_points.point_key` → `point_keys`, `0057`). */
export const MEASURED_KEY = "F4311_PR2_MEASURED";
export const CALC_KEY = "F4311_PR2_CALC";
export const CALC_KEY_2 = "F4311_PR2_CALC_2";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejection(run: () => Promise<unknown>): Promise<{ status: number | null; body: unknown; message: string }> {
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    const getResponse = (err as { getResponse?: () => unknown } | null)?.getResponse;
    const body = typeof getResponse === "function" ? getResponse.call(err) : null;
    const nested = (body as { message?: unknown } | null)?.message;
    return {
      status: typeof getStatus === "function" ? getStatus.call(err) : null,
      body,
      message: typeof nested === "string" ? nested : err instanceof Error ? err.message : String(err),
    };
  }
  throw new Error("expected a rejection, but the call succeeded");
}

async function expectRefusal(run: () => Promise<unknown>, status: number, match: RegExp, what: string): Promise<void> {
  const got = await rejection(run);
  assert(got.status === status, `${what}: expected HTTP ${status}, got ${String(got.status)} (${got.message})`);
  assert(match.test(got.message), `${what}: "${got.message}" does not match ${match}`);
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  // By payload as well as by row: a deleted point's audit row outlives it.
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE payload->>'assetId' IN (SELECT id::text FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}

/** A template-less asset with one unmapped (telemetry) row on `MEASURED_KEY`. */
async function seedBare(
  db: BmsDb,
  fx: Fixtures,
  suffix: string,
  opts: { organizationId?: string; locationId?: string } = {},
): Promise<{ id: string; code: string }> {
  const code = `${TEST_ASSET_PREFIX}${suffix}`;
  const organizationId = opts.organizationId ?? fx.organizationId;
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId,
      code,
      name: `Standalone Fixture ${suffix}`,
      siteName: "Fixture Site",
      locationId: opts.locationId ?? fx.otherLocationId,
      domain: "electrical",
      templateId: null,
    })
    .returning({ id: assets.id });
  await db.insert(assetPoints).values({
    organizationId,
    assetId: asset.id,
    pointKey: MEASURED_KEY,
    sourceDataKey: `REAL/${suffix}/M`,
    sourceKind: "unmapped",
    rtuId: null,
    active: true,
  });
  return { id: asset.id, code };
}

const V1_BODY: CalcPointSetBody = {
  formula: `{${MEASURED_KEY}} * 2`,
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

type Row = {
  id: string;
  source_kind: string;
  source_data_key: string;
  rtu_id: string | null;
  unit: string | null;
  formula: string | null;
  formula_dialect: string | null;
  calc_trigger: string | null;
  calc_interval_seconds: number | null;
  max_input_age_seconds: number | null;
};

async function rowFor(pool: pg.Pool, assetId: string, pointKey: string): Promise<Row | undefined> {
  const { rows } = await pool.query<Row>(
    `SELECT id, source_kind, source_data_key, rtu_id, unit, formula, formula_dialect,
            calc_trigger, calc_interval_seconds, max_input_age_seconds
       FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  return rows[0];
}

async function auditActions(pool: pg.Pool, assetId: string): Promise<{ action: string; payload: Record<string, unknown> }[]> {
  const { rows } = await pool.query<{ action: string; payload: Record<string, unknown> }>(
    `SELECT action, payload FROM bms.audit_log WHERE payload->>'assetId' = $1 ORDER BY created_at`,
    [assetId],
  );
  return rows;
}

async function catalogUnit(pool: pg.Pool, code: string): Promise<string | null> {
  const { rows } = await pool.query<{ unit: string | null }>(`SELECT unit FROM bms.point_keys WHERE code = $1`, [code]);
  return rows[0]?.unit ?? null;
}

async function expectNoRow(pool: pg.Pool, assetId: string, pointKey: string, what: string): Promise<void> {
  assert((await rowFor(pool, assetId, pointKey)) === undefined, `${what}: nothing may be written`);
}

// --- set / list / remove -----------------------------------------------------

/** Decisions 1 and 4 — a set creates a computed, rtu-less row carrying all five columns and the catalog unit. */
export async function assertSetCreatesAComputedRow(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "CREATE");
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, V1_BODY);
  const row = await rowFor(pool, asset.id, CALC_KEY);
  assert(row !== undefined, "the set must create the asset_points row");
  assert(row?.source_kind === "computed" && row?.rtu_id === null, `computed and rtu-less, got ${row?.source_kind}/${row?.rtu_id}`);
  assert(row?.source_data_key === `computed:${CALC_KEY}`, `the synthesised key, got ${row?.source_data_key}`);
  assert(
    row?.formula === V1_BODY.formula &&
      row?.formula_dialect === "bms-calc-v1" &&
      row?.calc_trigger === "scheduled" &&
      row?.calc_interval_seconds === 300 &&
      row?.max_input_age_seconds === 600,
    "all five calc columns are stored as sent",
  );
  assert(row?.unit === (await catalogUnit(pool, CALC_KEY)), `the catalog unit is stamped, got ${String(row?.unit)}`);
}

/** The set is audited `calc_point_set`, naming columns and never the formula. */
export async function assertSetIsAudited(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "AUDIT");
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, V1_BODY);
  const audits = await auditActions(pool, asset.id);
  assert(
    audits.map((a) => a.action).join(",") === "master.asset_point.calc_point_set",
    `one calc_point_set row, got ${audits.map((a) => a.action).join(",")}`,
  );
  assert(audits[0]?.payload.created === true, "the first set creates the row");
  assert(!JSON.stringify(audits[0]?.payload).includes(V1_BODY.formula), "the audit payload never carries the formula");
}

/** A second set replaces the row in place. */
export async function assertSetReplacesInPlace(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "REPLACE");
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, V1_BODY);
  const first = await rowFor(pool, asset.id, CALC_KEY);
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, { ...V1_BODY, calcIntervalSeconds: 60 });
  const second = await rowFor(pool, asset.id, CALC_KEY);
  assert(second?.id === first?.id && second?.calc_interval_seconds === 60, "the same row, with the new interval");
}

/** The list serves the row as a standalone item, in standalone mode. */
export async function assertListServesStandaloneItems(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "LIST");
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, V1_BODY);
  const list = await svc.list(fx.adminJwt, asset.id);
  const item = list.items.find((entry) => entry.pointKey === CALC_KEY);
  assert(list.mode === "standalone", `mode standalone, got ${list.mode}`);
  assert(
    item?.kind === "standalone" && item.templatePointId === null && item.effective.formula === V1_BODY.formula,
    "a standalone item: no template point, effective = the stored formula",
  );
  assert(!list.items.some((entry) => entry.pointKey === MEASURED_KEY), "the telemetry row is not a calculated point");
}

/** Decision 4 — DELETE removes the row and audits `calc_point_delete`. */
export async function assertRemoveDeletesTheRow(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "REMOVE");
  await svc.set(fx.adminJwt, asset.id, CALC_KEY, V1_BODY);
  const last = await svc.remove(fx.adminJwt, asset.id, CALC_KEY);
  assert(last.effective.formula === V1_BODY.formula, "the response is the point's last state");
  await expectNoRow(pool, asset.id, CALC_KEY, "after DELETE");
  const actions = (await auditActions(pool, asset.id)).map((a) => a.action);
  assert(actions.includes("master.asset_point.calc_point_delete"), `audited, got ${actions.join(",")}`);
}

/** DELETE never removes a telemetry row. */
export async function assertRemoveRefusesATelemetryRow(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "REMOVE-M");
  await expectRefusal(() => svc.remove(fx.adminJwt, asset.id, MEASURED_KEY), 404, /not a calculated point/, "DELETE of a telemetry row");
  assert((await rowFor(pool, asset.id, MEASURED_KEY))?.source_kind === "unmapped", "the telemetry row stays");
}

/** The access gate: an asset outside the caller's scope. */
export async function assertOutOfScopeAssetIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "SCOPE");
  await expectRefusal(() => svc.set(fx.locationAdminJwt, asset.id, CALC_KEY, V1_BODY), 403, /outside your access scope/, "out of scope");
  await expectNoRow(pool, asset.id, CALC_KEY, "out of scope");
}

// --- the rules, one per case -------------------------------------------------

/** Rule 1 — ruling 3: the key must be a catalog code. */
export async function assertAnUnknownCatalogKeyIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "R1");
  await expectRefusal(() => svc.set(fx.adminJwt, asset.id, NOT_A_CATALOG_KEY, V1_BODY), 400, /catalog/, "rule 1");
  await expectNoRow(pool, asset.id, NOT_A_CATALOG_KEY, "rule 1");
}

/** Rule 2 — a telemetry row's key is never turned into a formula. */
export async function assertAMappingRowIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "R2");
  await expectRefusal(
    () => svc.set(fx.adminJwt, asset.id, MEASURED_KEY, { ...V1_BODY, formula: "1 + 1" }),
    409,
    /telemetry mapping/,
    "rule 2",
  );
  const row = await rowFor(pool, asset.id, MEASURED_KEY);
  assert(row?.source_kind === "unmapped" && row?.formula === null, "the mapping row carries no formula");
}

/**
 * Rule 2 held at the write too: a mapping row that appears after `validate`
 * read the asset (simulated by hiding it from that read) is not taken over —
 * the upsert's `setWhere` skips it and the write answers 409.
 */
export async function assertAMeasuredRowIsNotTurnedIntoAFormula(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "RACE");
  const raced = svc as unknown as { readAssetRows: (id: string) => Promise<{ pointKey: string }[]> };
  const original = raced.readAssetRows.bind(svc);
  raced.readAssetRows = async (id) => (await original(id)).filter((row) => row.pointKey !== MEASURED_KEY);
  try {
    await expectRefusal(
      () => svc.set(fx.adminJwt, asset.id, MEASURED_KEY, { ...V1_BODY, formula: "1 + 1" }),
      409,
      /not a computed point/,
      "the race",
    );
  } finally {
    raced.readAssetRows = original;
  }
  const row = await rowFor(pool, asset.id, MEASURED_KEY);
  assert(row?.source_kind === "unmapped" && row?.formula === null, "the mapping row must not gain a formula");
}

/** Rule 3 — a `v1` formula may read only this asset's telemetry points, and the sentence says "this asset". */
export async function assertTheEngineRulesAreEnforced(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "R3");
  await expectRefusal(
    () => svc.set(fx.adminJwt, asset.id, CALC_KEY, { ...V1_BODY, formula: "{NOT_ON_THIS_ASSET} * 2" }),
    400,
    /point keys this asset declares/,
    "rule 3",
  );
  await expectNoRow(pool, asset.id, CALC_KEY, "rule 3");
}

/** Rule 4 — ADR 0070 decision 4: an unknown `$parameter` key. */
export async function assertAnUnknownParameterIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "R4");
  await expectRefusal(
    () =>
      svc.set(fx.adminJwt, asset.id, CALC_KEY, {
        ...V1_BODY,
        formula: `{${MEASURED_KEY}} * $F4311_NO_SUCH_PARAMETER`,
        formulaDialect: "bms-calc-v3",
      }),
    400,
    /F4311_NO_SUCH_PARAMETER/,
    "rule 4",
  );
  await expectNoRow(pool, asset.id, CALC_KEY, "rule 4");
}

/** Rule 5 — `F2.22` item 9: a qualified code that resolves nowhere. */
export async function assertAnUnresolvedCodeIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "R5");
  await expectRefusal(
    () =>
      svc.set(fx.adminJwt, asset.id, CALC_KEY, {
        ...V1_BODY,
        formula: `{${TEST_ASSET_PREFIX}NOWHERE.${MEASURED_KEY}} * 2`,
        formulaDialect: "bms-calc-v2",
      }),
    400,
    /resolve to no active asset/,
    "rule 5",
  );
  await expectNoRow(pool, asset.id, CALC_KEY, "rule 5");
}

/** Rule 7 — two standalone points on two assets that read each other close a cycle; the second is refused. */
export async function assertACycleIsRefused(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const a = await seedBare(db, fx, "R7-A");
  const b = await seedBare(db, fx, "R7-B");
  const v2 = (code: string): CalcPointSetBody => ({
    ...V1_BODY,
    formula: `{${code}.${CALC_KEY}} + 1`,
    formulaDialect: "bms-calc-v2",
    calcIntervalSeconds: 60,
  });
  await svc.set(fx.adminJwt, a.id, CALC_KEY, v2(b.code));
  await expectRefusal(() => svc.set(fx.adminJwt, b.id, CALC_KEY, v2(a.code)), 400, /dependency cycle/, "rule 7");
  await expectNoRow(pool, b.id, CALC_KEY, "rule 7");
}

/** A template-less asset is dispatched as standalone. */
export async function assertKindOfABareAssetIsStandalone(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const asset = await seedBare(createDb(pool), fx, "KIND");
  const { kind } = await svc.kindOf(fx.adminJwt, asset.id);
  assert(kind === "standalone", `kindOf a template-less asset, got ${kind}`);
}

// --- the batch -----------------------------------------------------------------

/** Two good assets: both rows written, items in request order, one batch audit row each. */
export async function assertABatchWritesEveryAsset(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const a = await seedBare(db, fx, "B-OK-A");
  const b = await seedBare(db, fx, "B-OK-B");
  const result = await svc.setBatch(fx.adminJwt, { assetIds: [b.id, a.id], pointKey: CALC_KEY_2, ...V1_BODY });
  assert(result.items.length === 2, `two items, got ${result.items.length}`);
  assert((await rowFor(pool, a.id, CALC_KEY_2))?.source_kind === "computed", "the first asset's row");
  assert((await rowFor(pool, b.id, CALC_KEY_2))?.source_kind === "computed", "the second asset's row");
  const audit = (await auditActions(pool, a.id))[0];
  assert(
    audit?.action === "master.asset_point.calc_point_batch" && audit.payload.batchSize === 2,
    `a calc_point_batch row carrying batchSize, got ${JSON.stringify(audit)}`,
  );
}

/** All or nothing: the second asset is refused, so neither is written, and the 400 names only the refused one. */
export async function assertABatchWithOneRefusalWritesNothing(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const a = await seedBare(db, fx, "B-NO-A");
  const b = await seedBare(db, fx, "B-NO-B");
  // B's telemetry row on the batch key is rule 2's refusal; A is fine.
  await db.insert(assetPoints).values({
    organizationId: fx.organizationId,
    assetId: b.id,
    pointKey: CALC_KEY_2,
    sourceDataKey: "REAL/B-NO-B/CALC2",
    sourceKind: "unmapped",
    rtuId: null,
    active: true,
  });
  const got = await rejection(() => svc.setBatch(fx.adminJwt, { assetIds: [a.id, b.id], pointKey: CALC_KEY_2, ...V1_BODY }));
  const refused = (got.body as { refused?: { assetId: string; assetCode: string | null }[] } | null)?.refused ?? [];
  assert(got.status === 400, `a 400, got ${String(got.status)}`);
  assert(
    refused.length === 1 && refused[0]?.assetId === b.id && refused[0]?.assetCode === b.code,
    `refused[] names the second asset only, got ${JSON.stringify(refused)}`,
  );
  await expectNoRow(pool, a.id, CALC_KEY_2, "the batch's accepted asset");
}

/** A batch writes one organization: an asset in a second organization is refused, and nothing is written. */
export async function assertABatchAcrossOrganizationsWritesNothing(pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const { rows } = await pool.query<{ organization_id: string }>(`SELECT organization_id FROM bms.locations WHERE id = $1`, [
    fx.foreignLocationId,
  ]);
  const foreignOrg = rows[0]?.organization_id;
  assert(foreignOrg !== undefined && foreignOrg !== fx.organizationId, "the fixtures name a second organization");
  const a = await seedBare(db, fx, "B-ORG-A");
  const b = await seedBare(db, fx, "B-ORG-B", { organizationId: foreignOrg, locationId: fx.foreignLocationId });
  const got = await rejection(() => svc.setBatch(fx.adminJwt, { assetIds: [a.id, b.id], pointKey: CALC_KEY_2, ...V1_BODY }));
  const refused = (got.body as { refused?: { assetId: string; reason: string }[] } | null)?.refused ?? [];
  assert(got.status === 400 && refused.length === 1 && refused[0]?.assetId === b.id, `the foreign asset is refused, got ${JSON.stringify(refused)}`);
  assert(/different one/.test(refused[0]?.reason ?? ""), `the reason names the organization rule, got ${refused[0]?.reason}`);
  await expectNoRow(pool, a.id, CALC_KEY_2, "the cross-organization batch");
}
