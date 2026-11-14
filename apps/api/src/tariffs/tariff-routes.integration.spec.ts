import { HttpException } from "@nestjs/common";
import type pg from "pg";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, rememberSubject } from "../testing/seeded-subjects";
import { EnergyBillService } from "./energy-bill.service";
import { BILL_NOT_FOUND, LocationEnergyBillService } from "./location-energy-bill.service";
import { LocationTariffsService } from "./location-tariffs.service";
import { monthFirstDay, monthOf, monthWindow, previousMonth } from "./month-window";
import { TariffLinesService } from "./tariff-lines.service";

/**
 * `F4.365` U5 — the tariff read routes and the location mapping API against a
 * real database (ADR 0134 decisions 3 and 6, plan D5/D6). Services are built
 * directly on the real roles — `bms_auth` for the actor, `bms_tenant` for the
 * writes under `withTenant`, `bms_fleet` for the reads — never through a Nest
 * module. The fixture is two organizations of this run, created on the
 * superuser pool and deleted by the sibling `.test.ts`.
 */
const KOLKATA = "Asia/Kolkata";
export const MSEDCL_LT = "Maharashtra | MSEDCL | LT-I(B) Residential (single phase)";
export const MSEDCL_HT = "Maharashtra | MSEDCL | HT-I(A) HT Industry (11/22/33 kV)";

export interface RoutesFixture {
  run: string;
  organizationA: string;
  organizationB: string;
  site: string;
  child: string;
  sibling: string;
  meterSite: string;
  meterChild: string;
  meterSibling: string;
  meterForeign: string;
  orgAdmin: JwtPayload;
  viewer: JwtPayload;
  locationAdmin: JwtPayload;
  groupViewer: JwtPayload;
  now: Date;
  month: string;
  thisMonth: string;
  window: { start: Date; end: Date };
}

export interface RoutesCtx {
  fx: RoutesFixture;
  superuser: pg.Pool;
  lines: TariffLinesService;
  bills: LocationEnergyBillService;
  mappings: LocationTariffsService;
  /** The SITE mapping the org admin creates in the first case. */
  siteMappingId?: string;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), message: err.message };
    throw err;
  }
  throw new Error("expected a refusal, the call succeeded");
}

const codeOf = (run: string) => `F4365R-${run}`;
const emailOf = (tag: string, run: string) => `f4365r-${tag}-${run}@integration.invalid`;

async function one(pool: pg.Pool, text: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(text, values);
  assert(rows[0] !== undefined, `no row from: ${text}`);
  return rows[0].id;
}

export async function seedRoutesFixture(superuser: pg.Pool, run: string): Promise<RoutesFixture> {
  const code = codeOf(run);
  const org = (suffix: string) =>
    one(superuser, `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id`, [
      `${code}-${suffix}`,
      `F4.365 routes ${suffix}`,
      KOLKATA,
    ]);
  const organizationA = await org("A");
  const organizationB = await org("B");
  const location = (organizationId: string, suffix: string, parentId: string | null) =>
    one(
      superuser,
      `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, parent_id, timezone)
       VALUES ($1, $2, $3, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $4, $5, $6) RETURNING id`,
      [`${code}-${suffix}`, `${code}-${suffix}`.toLowerCase(), `F4.365 ${suffix}`, organizationId, parentId, KOLKATA],
    );
  const asset = (organizationId: string, locationId: string, suffix: string) =>
    one(
      superuser,
      `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, active)
       VALUES ($1, $2, 'F4.365', $3, $4, 'electrical', true) RETURNING id`,
      [`${code}-${suffix}`, `F4.365 ${suffix}`, organizationId, locationId],
    );
  const site = await location(organizationA, "SITE", null);
  const child = await location(organizationA, "CHILD", site);
  const sibling = await location(organizationA, "SIBLING", null);
  const foreignSite = await location(organizationB, "FOREIGN", null);
  const meterSite = await asset(organizationA, site, "M-SITE");
  const otherSite = await asset(organizationA, site, "X-SITE");
  const meterChild = await asset(organizationA, child, "M-CHILD");
  const meterSibling = await asset(organizationA, sibling, "M-SIBLING");
  const meterForeign = await asset(organizationB, foreignSite, "M-FOREIGN");

  const user = async (tag: string, role: JwtPayload["role"]): Promise<JwtPayload> => {
    const email = emailOf(tag, run);
    const id = await one(
      superuser,
      `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
       VALUES ($1, $2, 'not-a-usable-hash', $3, $4) RETURNING id`,
      [organizationA, email, `F4.365 ${tag}`, role],
    );
    rememberSubject(email, id);
    return jwtFor(email, role);
  };
  const orgAdmin = await user("orgadmin", "organization_admin");
  const viewer = await user("viewer", "viewer");
  for (const jwt of [orgAdmin, viewer]) {
    await superuser.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [jwt.sub, organizationA]);
  }
  const locationAdmin = await user("locadmin", "location_admin");
  await superuser.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [locationAdmin.sub, site]);
  // Reads SITE through a group holding X-SITE only, so SITE's billing meter is unreadable to it.
  const groupViewer = await user("groupviewer", "viewer");
  const group = await one(
    superuser,
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, 'F4.365 group') RETURNING id`,
    [organizationA, site, `${code}-G`],
  );
  await superuser.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [group, otherSite]);
  await superuser.query(`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`, [groupViewer.sub, group]);

  const now = new Date();
  const thisMonth = monthOf(now, KOLKATA);
  const month = previousMonth(thisMonth);
  const window = monthWindow(month, KOLKATA);
  const day = (n: number) => new Date(window.start.getTime() + (n - 1) * 86_400_000 + 6 * 3_600_000);
  await superuser.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES ($1, $3, 'kwh_total', 1000, 'kWh'), ($2, $3, 'kwh_total', 1250, 'kWh') ON CONFLICT DO NOTHING`,
    [day(10).toISOString(), day(20).toISOString(), meterSite],
  );
  return {
    run, organizationA, organizationB, site, child, sibling, meterSite, meterChild, meterSibling, meterForeign,
    orgAdmin, viewer, locationAdmin, groupViewer, now, month, thisMonth, window,
  };
}

/** Deletes everything this run committed, keyed by its codes and emails so a half-built fixture is cleaned too. */
export async function dropRoutesFixture(superuser: pg.Pool, run: string): Promise<void> {
  const code = codeOf(run);
  const orgs = (await superuser.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code LIKE $1`, [`${code}-%`])).rows.map((r) => r.id);
  const users = "(SELECT id FROM bms.users WHERE email LIKE $1)";
  const userArg = [emailOf("%", run)];
  await superuser.query(`DELETE FROM bms.user_asset_group_access WHERE user_id IN ${users}`, userArg);
  await superuser.query(`DELETE FROM bms.user_location_access WHERE user_id IN ${users}`, userArg);
  await superuser.query(`DELETE FROM bms.user_organization_access WHERE user_id IN ${users}`, userArg);
  if (orgs.length > 0) {
    await superuser.query(`DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    // Ids resolved first: a constant filter on the SEGMENTBY column prunes compressed batches (ADR 0024).
    const assetIds = (await superuser.query<{ id: string }>(`SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs])).rows.map(
      (r) => r.id,
    );
    await superuser.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [assetIds]);
    await superuser.query(`DELETE FROM bms.location_tariffs WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(`DELETE FROM bms.org_tariff_categories WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(
      `DELETE FROM bms.asset_group_members WHERE asset_group_id IN (SELECT id FROM bms.asset_groups WHERE organization_id = ANY($1::uuid[]))`,
      [orgs],
    );
    await superuser.query(`DELETE FROM bms.asset_groups WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await superuser.query(`DELETE FROM bms.users WHERE email LIKE $1`, userArg);
  if (orgs.length > 0) {
    await superuser.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
  }
}

export function buildServices(pools: { fleet: pg.Pool; auth: pg.Pool; tenant: pg.Pool }) {
  const fleetDb = createDb(pools.fleet);
  const tenantDb = createDb(pools.tenant);
  const access = new AccessControlService(createDb(pools.auth), fleetDb);
  const audit = new MasterDataAuditService(tenantDb, fleetDb);
  return {
    access,
    audit,
    lines: new TariffLinesService(pools.fleet, access),
    bills: new LocationEnergyBillService(pools.fleet, access, new EnergyBillService(pools.fleet)),
    mappings: new LocationTariffsService(tenantDb, fleetDb, pools.fleet, access, audit),
  };
}

/** The org admin maps SITE; the write leaves exactly one audit row with the organization stamped. */
export async function assertAMappingWriteIsAuditedOnce(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const created = await ctx.mappings.create(fx.orgAdmin, fx.site, {
    tariffKey: MSEDCL_LT,
    billingMeterAssetId: fx.meterSite,
    sanctionedLoad: 3,
    sanctionedLoadUnit: "kw",
    effectiveFrom: monthFirstDay(previousMonth(fx.month)),
  });
  ctx.siteMappingId = created.id;
  assert(created.organizationId === fx.organizationA && created.tariffName !== null, JSON.stringify(created));
  const { rows } = await ctx.superuser.query<{ organization_id: string }>(
    `SELECT organization_id FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.location_tariff.create'`,
    [created.id],
  );
  assert(rows.length === 1 && rows[0]!.organization_id === fx.organizationA, `audit rows: ${JSON.stringify(rows)}`);
  const list = await ctx.mappings.list(fx.orgAdmin, fx.site);
  assert(list.items.length === 1 && list.items[0]!.billingMeterName === "F4.365 M-SITE", JSON.stringify(list));
}

/** An overlapping mapping is a 409 naming the clash, and writes nothing. */
export async function assertAnOverlapIs409(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const r = await refusal(
    ctx.mappings.create(fx.orgAdmin, fx.site, {
      tariffKey: MSEDCL_LT,
      billingMeterAssetId: fx.meterSite,
      sanctionedLoad: 3,
      sanctionedLoadUnit: "kw",
      effectiveFrom: monthFirstDay(fx.thisMonth),
    }),
  );
  assert(r.status === 409 && r.message.includes("already mapped from"), JSON.stringify(r));
  const { rows } = await ctx.superuser.query(`SELECT 1 FROM bms.location_tariffs WHERE location_id = $1`, [fx.site]);
  assert(rows.length === 1, `rows after the refused overlap: ${rows.length}`);
}

/** A location_admin writes its own subtree and is 403 on a sibling. */
export async function assertALocationAdminWritesItsSubtreeOnly(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const body = { tariffKey: MSEDCL_LT, sanctionedLoad: 3, sanctionedLoadUnit: "kw" as const, effectiveFrom: monthFirstDay(fx.month) };
  const own = await ctx.mappings.create(fx.locationAdmin, fx.child, { ...body, billingMeterAssetId: fx.meterChild });
  assert(own.locationId === fx.child, JSON.stringify(own));
  const r = await refusal(ctx.mappings.create(fx.locationAdmin, fx.sibling, { ...body, billingMeterAssetId: fx.meterSibling }));
  assert(r.status === 403, `sibling write: ${JSON.stringify(r)}`);
  const viewer = await refusal(ctx.mappings.list(fx.viewer, fx.site));
  assert(viewer.status === 403, `a viewer listing mappings: ${JSON.stringify(viewer)}`);
}

/** A meter of another organization, and one outside the location's subtree, are the same 400. */
export async function assertAForeignMeterIs400(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const body = { tariffKey: MSEDCL_LT, sanctionedLoad: 3, sanctionedLoadUnit: "kw" as const, effectiveFrom: monthFirstDay(fx.month) };
  const foreign = await refusal(ctx.mappings.create(fx.orgAdmin, fx.sibling, { ...body, billingMeterAssetId: fx.meterForeign }));
  const outside = await refusal(ctx.mappings.create(fx.orgAdmin, fx.sibling, { ...body, billingMeterAssetId: fx.meterSite }));
  assert(foreign.status === 400 && outside.status === 400 && foreign.message === outside.message, JSON.stringify({ foreign, outside }));
  const unknownKey = await refusal(
    ctx.mappings.create(fx.orgAdmin, fx.sibling, { ...body, tariffKey: "Nowhere | none", billingMeterAssetId: fx.meterSibling }),
  );
  assert(unknownKey.status === 400, JSON.stringify(unknownKey));
  // HT-I(A) charges per kVA of sanctioned load, so a load in kW is refused.
  const wrongUnit = await refusal(
    ctx.mappings.create(fx.orgAdmin, fx.sibling, { ...body, tariffKey: MSEDCL_HT, billingMeterAssetId: fx.meterSibling }),
  );
  assert(wrongUnit.status === 400 && wrongUnit.message.includes("kva"), JSON.stringify(wrongUnit));
}

/** A viewer reads the catalog and a readable location's bill; `state=` narrows. */
export async function assertAViewerReadsCategoriesAndTheBill(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const all = await ctx.lines.listCategories(fx.viewer, {});
  assert(all.items.length >= 316, `categories: ${all.items.length}`);
  const maharashtra = await ctx.lines.listCategories(fx.viewer, { state: "Maharashtra" });
  assert(
    maharashtra.items.length > 0 && maharashtra.items.length < all.items.length && maharashtra.items.every((i) => i.state === "Maharashtra"),
    `state=Maharashtra gave ${maharashtra.items.length}`,
  );
  const bill = await ctx.bills.bill(fx.viewer, fx.site, fx.month, fx.now);
  assert(bill.reason === null && bill.bill !== null && bill.bill.total === 2546 && bill.complete, JSON.stringify(bill));
  assert(bill.tariff?.key === MSEDCL_LT && bill.mapping?.id === ctx.siteMappingId && bill.currency === "INR", JSON.stringify(bill.tariff));
  const current = await ctx.bills.bill(fx.viewer, fx.site, undefined, fx.now);
  assert(current.month === fx.thisMonth && !current.complete, JSON.stringify(current));
  const unmapped = await ctx.bills.bill(fx.orgAdmin, fx.sibling, fx.month, fx.now);
  assert(unmapped.reason === "no_mapping" && unmapped.bill === null, JSON.stringify(unmapped));
  const future = await refusal(ctx.bills.bill(fx.viewer, fx.site, "2999-01", fx.now));
  const ancient = await refusal(ctx.bills.bill(fx.viewer, fx.site, "2001-01", fx.now));
  assert(future.status === 400 && ancient.status === 400, JSON.stringify({ future, ancient }));
}

/** An unreadable location and an unreadable billing meter are the same 404. */
export async function assertUnreadableLocationAndMeterAreOne404(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const meter = await refusal(ctx.bills.bill(fx.groupViewer, fx.site, fx.month, fx.now));
  const location = await refusal(ctx.bills.bill(fx.groupViewer, fx.sibling, fx.month, fx.now));
  assert(meter.status === 404 && location.status === 404, JSON.stringify({ meter, location }));
  assert(meter.message === BILL_NOT_FOUND && location.message === BILL_NOT_FOUND, "one sentence for both");
}

/** A key containing `/` round-trips through the versions read (ADR 0134 Amendment 1). */
export async function assertASlashKeyRoundTrips(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const { rows } = await ctx.superuser.query<{ key: string }>(`SELECT key FROM bms.tariff_categories WHERE key LIKE '%/%' ORDER BY key LIMIT 1`);
  const key = rows[0]?.key;
  assert(key !== undefined, "the catalog has a key with a slash");
  const versions = await ctx.lines.listVersions(fx.viewer, { key });
  assert(versions.key === key && versions.versions.length >= 1 && versions.versions.every((v) => v.key === key && !v.editable), JSON.stringify(versions));
  const other = await refusal(ctx.lines.listVersions(fx.viewer, { key, organizationId: fx.organizationB }));
  assert(other.status === 403, `another organization's rows: ${JSON.stringify(other)}`);
}

/** PATCH ends the mapping and DELETE removes it, each audited; the line is immutable. */
export async function assertUpdateAndDeleteAreAudited(ctx: RoutesCtx): Promise<void> {
  const { fx } = ctx;
  const id = ctx.siteMappingId;
  assert(id !== undefined, "the first case created the SITE mapping");
  const updated = await ctx.mappings.update(fx.orgAdmin, fx.site, id, { effectiveTo: monthFirstDay(fx.thisMonth), sanctionedLoad: 4 });
  assert(updated.effectiveTo === monthFirstDay(fx.thisMonth) && updated.sanctionedLoad === 4, JSON.stringify(updated));
  const wrongLocation = await refusal(ctx.mappings.update(fx.orgAdmin, fx.sibling, id, { sanctionedLoad: 5 }));
  assert(wrongLocation.status === 404, JSON.stringify(wrongLocation));
  await ctx.mappings.remove(fx.orgAdmin, fx.site, id);
  const { rows } = await ctx.superuser.query<{ action: string }>(
    `SELECT action FROM bms.audit_log WHERE entity_id = $1 ORDER BY action`,
    [id],
  );
  assert(
    rows.map((r) => r.action).join(",") === "master.location_tariff.create,master.location_tariff.delete,master.location_tariff.update",
    JSON.stringify(rows),
  );
  // The delete's audit payload is the row as the delete's own transaction read it: the update above shows.
  const deleted = await ctx.superuser.query<{ payload: { id: string; sanctionedLoad: number; effectiveTo: string | null } }>(
    `SELECT payload FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.location_tariff.delete'`,
    [id],
  );
  const payload = deleted.rows[0]?.payload;
  assert(
    payload?.id === id && payload.sanctionedLoad === 4 && payload.effectiveTo === monthFirstDay(fx.thisMonth),
    `the delete's audit payload: ${JSON.stringify(payload)}`,
  );
  const gone = await refusal(ctx.mappings.remove(fx.orgAdmin, fx.site, id));
  assert(gone.status === 404, JSON.stringify(gone));
}
