import { randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from "@nestjs/common";
import type pg from "pg";

import { assets, createDb } from "@bms/db";
import type { CalcParameterDto } from "@bms/shared";

import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import type { CalcParametersAdminService } from "./calc-parameters.service";

/**
 * `E4.1a` U8 — `CalcParametersAdminService` against a real database with real
 * roles (ADR 0070 decision 2; plan design decisions 7, 11 and 12).
 *
 * **Every row this suite writes lives in a per-run validity band.**
 * `bms.calc_parameters` has no `code` column to prefix, and the stock key
 * `energy_tariff_per_kwh` in the seeded organization is exactly what a second
 * instance of this file would also write — `calc_parameters_no_overlap` would
 * then refuse the other instance's 201 as this one's 409. So every window is
 * an offset inside `BAND_START .. BAND_START + 1 day`, the band start is a
 * per-run day in the far past (a `randomUUID()` in the declaration, the same
 * device `tests/integration-fixture-isolation.test.ts` reads for a code
 * prefix), and `cleanup` deletes by that band and nothing wider. A `count(*)`
 * is likewise read inside the band, never bare: the fleet role sees every
 * suite's committed rows.
 *
 * Reads that prove a row's presence or absence run on the **fleet** pool:
 * `FORCE ROW LEVEL SECURITY` returns zero rows to the owner outside a tenant
 * GUC, so an owner-pool `count(*)` of 0 would prove nothing.
 */

export const TEST_CODE = `E41A-CPADM-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
/** A per-run day between 1900-01-01 and ~1981, so two instances' bands never meet. */
export const BAND_START = new Date(
  Date.UTC(1900, 0, 1) + (parseInt(randomUUID().replace(/-/g, "").slice(0, 6), 16) % 30_000) * 86_400_000,
);
const BAND_END = new Date(BAND_START.getTime() + 86_400_000);
/**
 * Every band bound crosses to Postgres as an ISO string, never as a `Date`:
 * `pg` serialises a `Date` in the process's LOCAL zone with an hh:mm offset,
 * and before 1906 India's local mean time was +05:53:28 — the lost 28 seconds
 * put a row written at `hours(0)` outside its own band, so it was neither
 * counted nor cleaned (measured 2026-09-19 on a run whose band fell in 1901).
 */
const BAND = [BAND_START.toISOString(), BAND_END.toISOString()] as const;
export const KEY = "energy_tariff_per_kwh";

/** The twelve stock keys migration `0074` seeds, in `sort_order` order. */
export const STOCK_KEYS = [
  "energy_tariff_per_kwh",
  "water_tariff_per_kl",
  "effluent_tariff_per_kl",
  "grid_carbon_factor_kgco2_per_kwh",
  "energy_baseline_kwh_per_day",
  "water_baseline_kl_per_day",
  "chemical_baseline_kg_per_day",
  "rated_kw",
  "installed_kwp",
  "contract_demand_kva",
  "tank_capacity_l",
  "tariff_pf_band",
] as const;

export type AdminFixture = {
  readonly ownAssetId: string;
  readonly foreignAssetId: string;
  readonly foreignOrganizationId: string;
};

/** Rows the cases hand to each other; the lifecycle runs them in order. */
export type Ctx = {
  organizationRow?: CalcParameterDto;
  abuttingRow?: CalcParameterDto;
  locationRow?: CalcParameterDto;
  assetRow?: CalcParameterDto;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const hours = (n: number): string => new Date(BAND_START.getTime() + n * 3_600_000).toISOString();

async function expectRejection<T extends Error>(
  run: () => Promise<unknown>,
  ctor: new (...args: never[]) => T,
  match: RegExp,
): Promise<T> {
  try {
    await run();
  } catch (err) {
    assert(err instanceof ctor, `expected ${ctor.name}, got ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err)}`);
    assert(match.test((err as Error).message), `expected ${match} in "${(err as Error).message}"`);
    return err as T;
  }
  throw new Error(`expected ${ctor.name}, but the call succeeded`);
}

/** The band is the marker: only this run's rows carry an `effective_from` inside it. */
export async function cleanup(fleetPool: pg.Pool): Promise<void> {
  await fleetPool.query(
    `DELETE FROM bms.calc_parameters WHERE key = $1 AND effective_from >= $2 AND effective_from < $3`,
    [KEY, ...BAND],
  );
  await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

export async function seedAdminFixture(fleetPool: pg.Pool, fx: Fixtures): Promise<AdminFixture> {
  const { rows: foreign } = await fleetPool.query<{ organization_id: string }>(
    `SELECT organization_id FROM bms.locations WHERE id = $1`,
    [fx.foreignLocationId],
  );
  const foreignOrganizationId = foreign[0]?.organization_id;
  assert(foreignOrganizationId !== undefined, "the foreign location must resolve to its organization");
  const rows = await createDb(fleetPool)
    .insert(assets)
    .values([
      {
        code: `${TEST_CODE}-OWN`,
        name: "Calc parameter admin fixture (own)",
        siteName: "Calc parameter admin fixture site",
        organizationId: fx.organizationId,
        locationId: fx.rtuLocationId,
        domain: "electrical",
        templateId: null,
        active: true,
      },
      {
        code: `${TEST_CODE}-FOREIGN`,
        name: "Calc parameter admin fixture (foreign)",
        siteName: "Calc parameter admin fixture site",
        organizationId: foreignOrganizationId,
        locationId: fx.foreignLocationId,
        domain: "electrical",
        templateId: null,
        active: true,
      },
    ])
    .returning({ id: assets.id, code: assets.code });
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  return {
    ownAssetId: byCode.get(`${TEST_CODE}-OWN`) as string,
    foreignAssetId: byCode.get(`${TEST_CODE}-FOREIGN`) as string,
    foreignOrganizationId,
  };
}

/** Rows of `KEY` at the organization scope inside this run's band, as the fleet role. */
async function countOrganizationRows(fleetPool: pg.Pool, organizationId: string): Promise<number> {
  const { rows } = await fleetPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms.calc_parameters
      WHERE organization_id = $1 AND key = $2 AND location_id IS NULL AND asset_id IS NULL
        AND effective_from >= $3 AND effective_from < $4`,
    [organizationId, KEY, ...BAND],
  );
  return Number(rows[0]?.n ?? "0");
}

async function rowExists(fleetPool: pg.Pool, id: string): Promise<boolean> {
  const { rows } = await fleetPool.query(`SELECT 1 FROM bms.calc_parameters WHERE id = $1`, [id]);
  return rows.length === 1;
}

async function auditRows(fleetPool: pg.Pool, action: string, entityIds: string[]): Promise<{ organization_id: string | null; entity_type: string }[]> {
  const { rows } = await fleetPool.query<{ organization_id: string | null; entity_type: string }>(
    `SELECT organization_id, entity_type FROM bms.audit_log WHERE action = $1 AND entity_id = ANY($2::uuid[])`,
    [action, entityIds],
  );
  return rows;
}

// ---- create --------------------------------------------------------------------

export async function assertAdminCreatesAnOrganizationScopedRow(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const before = await countOrganizationRows(fleetPool, fx.organizationId);
  assert(before === 0, `the band must start empty, found ${before}`);
  const row = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    key: KEY,
    value: 8.5,
    effectiveFrom: hours(0),
    effectiveTo: hours(2),
  });
  assert(row.organizationId === fx.organizationId && row.key === KEY, "the DTO echoes org and key");
  assert(row.locationId === null && row.assetId === null, "organization scope has both scope columns null");
  assert(row.locationName === null && row.assetCode === null, "no scope labels at the organization scope");
  assert(row.value === 8.5, `value round-trips, got ${row.value}`);
  assert(row.effectiveFrom === hours(0) && row.effectiveTo === hours(2), "the window round-trips as ISO strings");
  assert(await rowExists(fleetPool, row.id), "the row is present as bms_fleet");
  assert((await countOrganizationRows(fleetPool, fx.organizationId)) === 1, "one organization-scope row in the band");
  ctx.organizationRow = row;
}

/** The owed guard: an overlapping second row is a 409 and writes nothing. */
export async function assertAnOverlappingCreateIs409AndWritesNothing(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const before = await countOrganizationRows(fleetPool, fx.organizationId);
  assert(before === 1, `positive control: the first row must be present, found ${before}`);
  const err = await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        key: KEY,
        value: 9,
        effectiveFrom: hours(1),
        effectiveTo: hours(3),
      }),
    ConflictException,
    /already covers/,
  );
  // The pre-read's sentence names the clashing window — the reason it exists
  // beside the EXCLUDE constraint, whose 23P01 carries no DETAIL under RLS.
  assert(err.message.includes(hours(0)) && err.message.includes(hours(2)), `the 409 names the clashing window: ${err.message}`);
  assert(err.message.includes(KEY), "the 409 names the key");
  assert((await countOrganizationRows(fleetPool, fx.organizationId)) === before, "count(*) is unchanged after the 409");
}

/** The positive control beside the 409: `[)` windows that touch do not overlap. */
export async function assertAnAbuttingCreateIs201(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const row = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    key: KEY,
    value: 9.25,
    effectiveFrom: hours(2),
    effectiveTo: null,
  });
  assert(row.effectiveFrom === hours(2) && row.effectiveTo === null, "the abutting row is open-ended from the neighbour's end");
  assert((await countOrganizationRows(fleetPool, fx.organizationId)) === 2, "two organization-scope rows in the band");
  ctx.abuttingRow = row;
}

export async function assertALocationAdminCannotCreateOrganizationScope(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const before = await countOrganizationRows(fleetPool, fx.organizationId);
  await expectRejection(
    () =>
      svc.create(fx.locationAdminJwt, {
        organizationId: fx.organizationId,
        key: KEY,
        value: 1,
        effectiveFrom: hours(10),
        effectiveTo: hours(11),
      }),
    ForbiddenException,
    /organization scope/i,
  );
  assert((await countOrganizationRows(fleetPool, fx.organizationId)) === before, "nothing was written");
}

export async function assertALocationAdminWritesItsOwnLocationOnly(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const row = await svc.create(fx.locationAdminJwt, {
    organizationId: fx.organizationId,
    key: KEY,
    locationId: fx.rtuLocationId,
    value: 7,
    effectiveFrom: hours(0),
    effectiveTo: hours(2),
  });
  assert(row.locationId === fx.rtuLocationId, "the location scope is stored");
  assert(typeof row.locationName === "string" && row.locationName.length > 0, "the location name is joined");
  assert(await rowExists(fleetPool, row.id), "the location-scope row is present as bms_fleet");
  ctx.locationRow = row;

  await expectRejection(
    () =>
      svc.create(fx.locationAdminJwt, {
        organizationId: fx.organizationId,
        key: KEY,
        locationId: fx.otherLocationId,
        value: 7,
        effectiveFrom: hours(0),
        effectiveTo: hours(2),
      }),
    ForbiddenException,
    /outside your access scope/,
  );
}

export async function assertAnAssetInAnotherOrganizationIs400(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  fixture: AdminFixture,
  ctx: Ctx,
): Promise<void> {
  // As the global admin: `canManageAsset` admits every asset, so the only
  // thing standing between the body and the policy's WITH CHECK is the
  // service's own pre-validation — which is what this proves.
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        key: KEY,
        assetId: fixture.foreignAssetId,
        value: 3,
        effectiveFrom: hours(0),
        effectiveTo: hours(1),
      }),
    BadRequestException,
    /assetId you supplied does not belong to organization/,
  );
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        key: KEY,
        locationId: fx.foreignLocationId,
        value: 3,
        effectiveFrom: hours(0),
        effectiveTo: hours(1),
      }),
    BadRequestException,
    /locationId you supplied does not belong to organization/,
  );
  // Positive control: the own asset is admitted and labelled.
  const row = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    key: KEY,
    assetId: fixture.ownAssetId,
    value: 3,
    effectiveFrom: hours(0),
    effectiveTo: hours(1),
  });
  assert(row.assetId === fixture.ownAssetId && row.assetCode === `${TEST_CODE}-OWN`, "the asset code is joined");
  assert(await rowExists(fleetPool, row.id), "the asset-scope row is present as bms_fleet");
  ctx.assetRow = row;
}

export async function assertCreateWritesAnAuditRowPerRow(fleetPool: pg.Pool, fx: Fixtures, ctx: Ctx): Promise<void> {
  const ids = [ctx.organizationRow?.id, ctx.abuttingRow?.id].filter((id): id is string => typeof id === "string");
  assert(ids.length === 2, "both organization-scope rows must exist");
  const rows = await auditRows(fleetPool, "master.calc_parameter.create", ids);
  assert(rows.length === 2, `expected two create audit rows, found ${rows.length}`);
  assert(rows.every((row) => row.organization_id === fx.organizationId), "each audit row is stamped with the organization");
  assert(rows.every((row) => row.entity_type === "calc_parameter"), "entityType is calc_parameter");
}

// ---- update --------------------------------------------------------------------

export async function assertUpdateIntoTheNeighbourIs409(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const target = ctx.organizationRow;
  assert(target !== undefined, "the organization row must exist");
  await expectRejection(
    () => svc.update(fx.adminJwt, target.id, { effectiveTo: hours(3) }),
    ConflictException,
    /already covers/,
  );
  const { rows } = await fleetPool.query<{ effective_to: Date }>(
    `SELECT effective_to FROM bms.calc_parameters WHERE id = $1`,
    [target.id],
  );
  assert(rows[0]?.effective_to.toISOString() === hours(2), "the stored window is unchanged after the 409");

  // Positive control: shrinking the window, and changing the value, is admitted
  // and audited; the immutable columns keep their values.
  const updated = await svc.update(fx.adminJwt, target.id, { value: 8.75, effectiveTo: hours(1.5) });
  assert(updated.value === 8.75 && updated.effectiveTo === hours(1.5), "the update round-trips");
  assert(updated.key === KEY && updated.organizationId === fx.organizationId && updated.locationId === null, "key, organization and scope are unchanged");
  const audits = await auditRows(fleetPool, "master.calc_parameter.update", [target.id]);
  assert(audits.length === 1 && audits[0]?.organization_id === fx.organizationId, "one update audit row, organization stamped");
  ctx.organizationRow = updated;
}

export async function assertALocationAdminCannotUpdateAnOrganizationRow(
  svc: CalcParametersAdminService,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const target = ctx.organizationRow;
  assert(target !== undefined, "the organization row must exist");
  await expectRejection(
    () => svc.update(fx.locationAdminJwt, target.id, { value: 1 }),
    ForbiddenException,
    /organization scope/i,
  );
  const missing = "00000000-0000-4000-8000-00000000dead";
  await expectRejection(() => svc.update(fx.adminJwt, missing, { value: 1 }), NotFoundException, /not found/i);
}

// ---- remove --------------------------------------------------------------------

export async function assertRemoveDeletesAndAudits(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  ctx: Ctx,
): Promise<void> {
  const target = ctx.abuttingRow;
  assert(target !== undefined, "the abutting row must exist");
  assert(await rowExists(fleetPool, target.id), "positive control: the row is present before remove");
  await svc.remove(fx.adminJwt, target.id);
  assert(!(await rowExists(fleetPool, target.id)), "the row is gone as bms_fleet");
  const audits = await auditRows(fleetPool, "master.calc_parameter.delete", [target.id]);
  assert(audits.length === 1 && audits[0]?.organization_id === fx.organizationId, "one delete audit row, organization stamped");
  await expectRejection(() => svc.remove(fx.adminJwt, target.id), NotFoundException, /not found/i);
  ctx.abuttingRow = undefined;
}

// ---- read ----------------------------------------------------------------------

export async function assertListIsGatedByReadableOrganizations(
  svc: CalcParametersAdminService,
  fx: Fixtures,
  fixture: AdminFixture,
  ctx: Ctx,
): Promise<void> {
  await expectRejection(
    () => svc.list(fx.locationAdminJwt, { organizationId: fixture.foreignOrganizationId }),
    ForbiddenException,
    /outside your access scope/,
  );
  // A location_admin may read its organization's rows, including the
  // organization-scope one it may not write (design decision 11).
  const { items } = await svc.list(fx.locationAdminJwt, { organizationId: fx.organizationId, key: KEY });
  const ids = new Set(items.map((item) => item.id));
  assert(ctx.organizationRow !== undefined && ids.has(ctx.organizationRow.id), "the organization row is listed");
  assert(ctx.locationRow !== undefined && ids.has(ctx.locationRow.id), "the location row is listed");
  assert(ctx.assetRow !== undefined && ids.has(ctx.assetRow.id), "the asset row is listed");
  assert(items.every((item) => item.organizationId === fx.organizationId && item.key === KEY), "the filters hold");
  // Ordered by key, then effective_from. This case runs BEFORE `remove` so the
  // abutting row (`hours(2)`) is still present: with it the sequence is
  // [0, 0, 0, 2] and a dropped or reversed ORDER BY fails; without it every
  // row shares one effective_from and any order passes. The `key` axis of
  // the order is not gated — the list is filtered to one key.
  const abutting = ctx.abuttingRow;
  assert(abutting !== undefined && ids.has(abutting.id), "the abutting row is listed");
  const froms = items.map((item) => item.effectiveFrom);
  assert(froms.every((from, i) => i === 0 || (froms[i - 1] as string) <= from), "rows are ordered by effective_from within a key");
  assert(items[items.length - 1]?.id === abutting.id, "the abutting row, the latest effective_from, is last");

  const locationRow = ctx.locationRow;
  assert(locationRow !== undefined, "the location row must exist");
  const one = await svc.getById(fx.locationAdminJwt, locationRow.id);
  assert(one.id === locationRow.id && one.locationName === locationRow.locationName, "getById returns the labelled row");
}

export async function assertKeysListsTheTwelveStockKeysInOrder(svc: CalcParametersAdminService, fx: Fixtures): Promise<void> {
  const { items } = await svc.listKeys(fx.locationAdminJwt);
  const codes = items.map((item) => item.code);
  // Containment and relative order, not list equality: another suite commits
  // its own active per-run keys, and `listKeys` returns every active row.
  const positions = STOCK_KEYS.map((code) => codes.indexOf(code));
  assert(positions.every((p) => p >= 0), `every stock key is listed; missing ${STOCK_KEYS.filter((_, i) => positions[i] === -1).join(", ")}`);
  assert(positions.every((p, i) => i === 0 || (positions[i - 1] as number) < p), "the stock keys are in sort_order order");
  const tariff = items.find((item) => item.code === KEY);
  assert(tariff?.unit === "/kWh" && tariff.active === true && typeof tariff.sortOrder === "number", "unit, active and sortOrder are carried");
}

// ---- review fixes (PR 2 security Low 1 / Low 2, migration Medium 2) --------------

/**
 * A key outside the active vocabulary is a 400 with a sentence, ahead of
 * `calc_parameters_key_fkey` (which would have surfaced as a 500). The
 * positive control is every create above: a stock key passes the same check.
 */
export async function assertAnUnknownKeyIs400(svc: CalcParametersAdminService, fx: Fixtures): Promise<void> {
  await expectRejection(
    () =>
      svc.create(fx.adminJwt, {
        organizationId: fx.organizationId,
        key: "not_a_vocabulary_key",
        value: 1,
        effectiveFrom: BAND[0],
      }),
    BadRequestException,
    /not in the active calc parameter vocabulary/,
  );
}

/**
 * A row in an organization the caller cannot read answers 404 on `getById`,
 * `update` and `remove` — never 403, which would confirm the id as real
 * (the `assertScopeParentsBelong` principle on the read side). The row is
 * written as the fleet role under the foreign organization, inside this run's
 * band so `cleanup` sweeps it. The positive control is the readable-but-not-
 * writable case beside it: an organization row in the caller's OWN
 * organization is still a 403 for a `location_admin`.
 */
export async function assertAForeignOrganizationRowIs404NotForbidden(
  svc: CalcParametersAdminService,
  fleetPool: pg.Pool,
  fx: Fixtures,
  fixture: AdminFixture,
  ctx: Ctx,
): Promise<void> {
  const { rows } = await fleetPool.query<{ id: string }>(
    `INSERT INTO bms.calc_parameters (organization_id, key, value, effective_from, effective_to)
     VALUES ($1, $2, 42, $3, $4) RETURNING id`,
    [fixture.foreignOrganizationId, KEY, BAND[0], BAND[1]],
  );
  const foreignId = rows[0]?.id as string;
  try {
    await expectRejection(() => svc.getById(fx.locationAdminJwt, foreignId), NotFoundException, /not found/i);
    await expectRejection(() => svc.update(fx.locationAdminJwt, foreignId, { value: 1 }), NotFoundException, /not found/i);
    await expectRejection(() => svc.remove(fx.locationAdminJwt, foreignId), NotFoundException, /not found/i);
    assert(await rowExists(fleetPool, foreignId), "the foreign row is untouched");
    const own = ctx.organizationRow;
    assert(own !== undefined, "the organization row must exist");
    await expectRejection(() => svc.update(fx.locationAdminJwt, own.id, { value: 1 }), ForbiddenException, /organization scope/i);
  } finally {
    await fleetPool.query(`DELETE FROM bms.calc_parameters WHERE id = $1`, [foreignId]);
  }
}
