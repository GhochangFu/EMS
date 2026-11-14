import { HttpException } from "@nestjs/common";
import type pg from "pg";

import { createDb } from "@bms/db";
import { createTariffVersionBodySchema } from "@bms/shared";
import type { JwtPayload, TariffSlab } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, rememberSubject } from "../testing/seeded-subjects";
import { monthFirstDay, monthOf } from "./month-window";
import { OrgTariffVersionsService } from "./org-tariff-versions.service";
import { TariffLinesService } from "./tariff-lines.service";

/**
 * `F4.365` U6 — an organization's own tariff versions against a real
 * database (ADR 0134 decision 8, Amendment 1, plan D5/D6). Services are built
 * directly on `bms_auth`, `bms_tenant` and `bms_fleet`; the fixture is two
 * organizations of this run, created and deleted by the sibling `.test.ts`.
 */
const KOLKATA = "Asia/Kolkata";
export const MSEDCL_LT = "Maharashtra | MSEDCL | LT-I(B) Residential (single phase)";
const SLABS: TariffSlab[] = [
  { slabNo: 1, fromUnits: 0, toUnits: 100, energyRate: 5, fixedRate: 0, wheelingRate: 1, notes: null },
  { slabNo: 2, fromUnits: 101, toUnits: null, energyRate: 7, fixedRate: 0, wheelingRate: 1, notes: null },
];

export interface VersionsCtx {
  run: string;
  superuser: pg.Pool;
  svc: OrgTariffVersionsService;
  lines: TariffLinesService;
  organizationA: string;
  organizationB: string;
  orgAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  foreignAdmin: JwtPayload;
  thisMonth: string;
  nextMonth: string;
  /** Ids the cases hand on. */
  revisionId?: string;
  currentId?: string;
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

const codeOf = (run: string) => `F4365V-${run}`;
const emailOf = (tag: string, run: string) => `f4365v-${tag}-${run}@integration.invalid`;

async function one(pool: pg.Pool, text: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(text, values);
  assert(rows[0] !== undefined, `no row from: ${text}`);
  return rows[0].id;
}

const nextMonthOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export async function seedVersionsFixture(
  pools: { superuser: pg.Pool; fleet: pg.Pool; auth: pg.Pool; tenant: pg.Pool },
  run: string,
): Promise<VersionsCtx> {
  const { superuser } = pools;
  const code = codeOf(run);
  const org = (suffix: string) =>
    one(superuser, `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id`, [
      `${code}-${suffix}`,
      `F4.365 versions ${suffix}`,
      KOLKATA,
    ]);
  const organizationA = await org("A");
  const organizationB = await org("B");
  const site = await one(
    superuser,
    `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, timezone)
     VALUES ($1, $2, 'F4.365 versions site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $3, $4) RETURNING id`,
    [`${code}-SITE`, `${code}-site`.toLowerCase(), organizationA, KOLKATA],
  );
  const user = async (tag: string, organizationId: string, role: JwtPayload["role"]): Promise<JwtPayload> => {
    const email = emailOf(tag, run);
    const id = await one(
      superuser,
      `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
       VALUES ($1, $2, 'not-a-usable-hash', $3, $4) RETURNING id`,
      [organizationId, email, `F4.365 ${tag}`, role],
    );
    rememberSubject(email, id);
    return jwtFor(email, role);
  };
  const orgAdmin = await user("orgadmin", organizationA, "organization_admin");
  const foreignAdmin = await user("foreign", organizationB, "organization_admin");
  await superuser.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2), ($3, $4)`, [
    orgAdmin.sub,
    organizationA,
    foreignAdmin.sub,
    organizationB,
  ]);
  const locationAdmin = await user("locadmin", organizationA, "location_admin");
  await superuser.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [locationAdmin.sub, site]);

  const fleetDb = createDb(pools.fleet);
  const tenantDb = createDb(pools.tenant);
  const access = new AccessControlService(createDb(pools.auth), fleetDb);
  const thisMonth = monthOf(new Date(), KOLKATA);
  return {
    run,
    superuser,
    svc: new OrgTariffVersionsService(tenantDb, fleetDb, pools.fleet, access, new MasterDataAuditService(tenantDb, fleetDb)),
    lines: new TariffLinesService(pools.fleet, access),
    organizationA,
    organizationB,
    orgAdmin,
    locationAdmin,
    foreignAdmin,
    thisMonth,
    nextMonth: nextMonthOf(thisMonth),
  };
}

export async function dropVersionsFixture(superuser: pg.Pool, run: string): Promise<void> {
  const orgs = (await superuser.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code LIKE $1`, [`${codeOf(run)}-%`])).rows.map(
    (r) => r.id,
  );
  const users = "(SELECT id FROM bms.users WHERE email LIKE $1)";
  const userArg = [emailOf("%", run)];
  await superuser.query(`DELETE FROM bms.user_location_access WHERE user_id IN ${users}`, userArg);
  await superuser.query(`DELETE FROM bms.user_organization_access WHERE user_id IN ${users}`, userArg);
  if (orgs.length > 0) {
    await superuser.query(`DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(`DELETE FROM bms.org_tariff_categories WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await superuser.query(`DELETE FROM bms.users WHERE email LIKE $1`, userArg);
  if (orgs.length > 0) {
    await superuser.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await superuser.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
  }
}

async function auditRows(ctx: VersionsCtx, id: string): Promise<{ action: string; reason: string | null; organization_id: string }[]> {
  const { rows } = await ctx.superuser.query<{ action: string; reason: string | null; organization_id: string }>(
    `SELECT action, reason, organization_id FROM bms.audit_log WHERE entity_id = $1 AND entity_type = 'org_tariff_version' ORDER BY created_at, action`,
    [id],
  );
  return rows;
}

/** An organization_admin creates a revision (columns copied from the catalog) and a custom line; each audited with its reason. */
export async function assertAnOrganizationAdminCreatesRevisionAndCustom(ctx: VersionsCtx): Promise<void> {
  const revision = await ctx.svc.create(ctx.orgAdmin, {
    kind: "revision",
    organizationId: ctx.organizationA,
    key: MSEDCL_LT,
    effectiveFrom: monthFirstDay(ctx.nextMonth),
    reason: "MERC mid-year revision",
    slabs: SLABS,
  });
  ctx.revisionId = revision.id;
  const catalog = (await ctx.superuser.query<{ name: string; state: string }>(
    `SELECT name, state FROM bms.tariff_categories WHERE key = $1 ORDER BY effective_from DESC LIMIT 1`,
    [MSEDCL_LT],
  )).rows[0];
  assert(
    revision.source === "organization" && revision.editable && revision.name === catalog?.name && revision.state === catalog?.state && revision.slabs.length === 2,
    JSON.stringify(revision),
  );
  const custom = await ctx.svc.create(ctx.orgAdmin, {
    kind: "custom",
    organizationId: ctx.organizationA,
    key: "custom:F4365 captive plant",
    effectiveFrom: monthFirstDay(ctx.nextMonth),
    reason: "open-access captive supply",
    slabs: SLABS,
    areaId: "X",
    state: "Maharashtra",
    discoms: "Captive",
    ownership: "Private",
    code: "CAP-1",
    name: "Captive plant",
    segment: "Industrial",
    supply: "HT",
    energyUnit: "kwh",
    fixedBasis: "none",
    dataStatus: "official",
    tariffOrder: null,
    sourceUrl: null,
    notes: null,
  });
  assert(custom.key === "custom:F4365 captive plant" && custom.name === "Captive plant", JSON.stringify(custom));
  for (const [id, reason] of [
    [revision.id, "MERC mid-year revision"],
    [custom.id, "open-access captive supply"],
  ] as const) {
    const rows = await auditRows(ctx, id);
    assert(
      rows.length === 1 && rows[0]!.action === "master.tariff_version.create" && rows[0]!.reason === reason && rows[0]!.organization_id === ctx.organizationA,
      JSON.stringify(rows),
    );
  }
  const duplicate = await refusal(
    ctx.svc.create(ctx.orgAdmin, {
      kind: "revision",
      organizationId: ctx.organizationA,
      key: MSEDCL_LT,
      effectiveFrom: monthFirstDay(ctx.nextMonth),
      reason: "a second one",
      slabs: SLABS,
    }),
  );
  assert(duplicate.status === 409, JSON.stringify(duplicate));
}

/** A location_admin is 403 — the reason the gate is `isOrganizationLevelAdmin`, never `canManageOrganization`. */
export async function assertALocationAdminIs403(ctx: VersionsCtx): Promise<void> {
  const r = await refusal(
    ctx.svc.create(ctx.locationAdmin, {
      kind: "revision",
      organizationId: ctx.organizationA,
      key: MSEDCL_LT,
      effectiveFrom: monthFirstDay(nextMonthOf(ctx.nextMonth)),
      reason: "location admin attempt",
      slabs: SLABS,
    }),
  );
  assert(r.status === 403, JSON.stringify(r));
}

/** Organization B cannot read, patch or delete A's version: 404 on writes, 403 naming A, absent from its own read. */
export async function assertAnotherOrganizationSeesNothing(ctx: VersionsCtx): Promise<void> {
  const id = ctx.revisionId;
  assert(id !== undefined, "the first case created the revision");
  const patch = await refusal(ctx.svc.update(ctx.foreignAdmin, id, { reason: "foreign edit", slabs: SLABS }));
  const remove = await refusal(ctx.svc.remove(ctx.foreignAdmin, id, "foreign delete"));
  assert(patch.status === 404 && remove.status === 404, JSON.stringify({ patch, remove }));
  const named = await refusal(ctx.lines.listVersions(ctx.foreignAdmin, { key: MSEDCL_LT, organizationId: ctx.organizationA }));
  assert(named.status === 403, JSON.stringify(named));
  const own = await ctx.lines.listVersions(ctx.foreignAdmin, { key: MSEDCL_LT });
  assert(own.versions.every((v) => v.id !== id && v.organizationId !== ctx.organizationA), JSON.stringify(own.versions));
  const mine = await ctx.lines.listVersions(ctx.orgAdmin, { key: MSEDCL_LT });
  assert(mine.versions.some((v) => v.id === id && v.editable), "A reads its own revision, editable");
}

/** A version in force (dated this month — backdating is allowed) is 409 on PATCH and DELETE; a next-month one is edited and deleted. */
export async function assertAVersionInForceIsLocked(ctx: VersionsCtx): Promise<void> {
  const current = await ctx.svc.create(ctx.orgAdmin, {
    kind: "revision",
    organizationId: ctx.organizationA,
    key: MSEDCL_LT,
    effectiveFrom: monthFirstDay(ctx.thisMonth),
    reason: "backdated to this month",
    slabs: SLABS,
  });
  ctx.currentId = current.id;
  assert(!current.editable, "a version in force is not editable");
  const patch = await refusal(ctx.svc.update(ctx.orgAdmin, current.id, { reason: "edit in force", slabs: SLABS }));
  const remove = await refusal(ctx.svc.remove(ctx.orgAdmin, current.id, "delete in force"));
  assert(patch.status === 409 && remove.status === 409, JSON.stringify({ patch, remove }));

  const id = ctx.revisionId;
  assert(id !== undefined, "the first case created the revision");
  const edited = await ctx.svc.update(ctx.orgAdmin, id, {
    reason: "corrected slab 2",
    slabs: [SLABS[0]!, { ...SLABS[1]!, energyRate: 8 }],
  });
  assert(edited.slabs[1]?.energyRate === 8, JSON.stringify(edited.slabs));
  await ctx.svc.remove(ctx.orgAdmin, id, "withdrawn by the regulator");
  const rows = await auditRows(ctx, id);
  assert(
    rows.map((r) => `${r.action}:${r.reason}`).join("|") ===
      "master.tariff_version.create:MERC mid-year revision|master.tariff_version.update:corrected slab 2|master.tariff_version.delete:withdrawn by the regulator",
    JSON.stringify(rows),
  );
}

/** `.strict()` on the revision arm: a `state` sent on a revision is a 400, never dropped. */
export function assertARevisionRefusesDescriptiveColumns(ctx: VersionsCtx): void {
  const parsed = createTariffVersionBodySchema.safeParse({
    kind: "revision",
    organizationId: ctx.organizationA,
    key: MSEDCL_LT,
    effectiveFrom: monthFirstDay(ctx.nextMonth),
    reason: "with a state",
    slabs: SLABS,
    state: "Gujarat",
  });
  assert(!parsed.success, "a revision body with state must fail the schema");
}
