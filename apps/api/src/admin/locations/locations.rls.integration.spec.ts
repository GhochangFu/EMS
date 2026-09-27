import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";

import { assets, createDb, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { LocationsAdminService } from "./locations.service";

/**
 * `F4.16` Task 8 — the write-path coverage `locations.service.ts` had none of.
 *
 * Every other RLS-adjacent service on this branch either has its own
 * integration suite exercising it against real, non-owner roles, or — for the
 * three `asset-templates` suites — was rewired onto real roles by this same
 * task. `LocationsAdminService` had neither: zero test files of any kind. A
 * `withTenant(` wrapper silently deleted from `create`/`update`/`deactivate`/
 * `reactivate` would ship undetected, exactly the class of regression Task 6.6
 * found and fixed for ~20 other services.
 *
 * **`assertRefusesOutOfScopeOrganization` does not prove RLS, and does not
 * claim to** — code-reviewer found the original version of this file claimed
 * it under an RLS-framed rationale while `canManageOrganization`'s app-level
 * check throws before `withTenant` is ever reached, so the assertion is
 * invariant under `withTenant` being deleted outright (mutation-tested: it
 * still passes with the wrapper gone). It is a legitimate, worth-keeping
 * authorization test — just not an RLS one. `assertPolicyRefusesMismatchedOrg`
 * below is what actually exercises the `WITH CHECK` clause.
 */
type SvcWithFixtures = {
  svc: LocationsAdminService;
  tenantPool: pg.Pool;
  ownerPool: pg.Pool;
  organizationId: string;
};

export async function assertWriteLifecycleSurvivesRealRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<string> {
  const { svc, ownerPool, organizationId } = ctx;
  const created = await svc.create(jwt, {
    organizationId,
    code: `F4.16-RLS-${Date.now()}`,
    slug: `f4-16-rls-${Date.now()}`,
    name: "F4.16 RLS write-path check",
    type: "rsmoc",
    latitude: 0,
    longitude: 0,
  });
  // Registered HERE, not from the caller on the return value: every assertion
  // below can throw, and a throw skips the caller's own bookkeeping entirely.
  // Two such rows are what turned `db:seed` red on 2026-08-27 (PHEWB locations:
  // expected 6, got 7) — the row was committed, the suite failed, and nothing
  // in the process knew the id any more. `afterAll` now does.
  register(created.id);
  expect(created.organizationId).toBe(organizationId);
  expect(created.active).toBe(true);

  // Written on the tenant connection under a real SET LOCAL — if withTenant
  // were silently missing, this insert would fail here with a row-level
  // security policy violation rather than merely being unscoped.
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string }>(
      "SELECT organization_id FROM bms.locations WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(ownerRow?.organization_id).toBe(organizationId);

  const fetched = await svc.getById(jwt, created.id);
  expect(fetched.name).toBe("F4.16 RLS write-path check");

  const updated = await svc.update(jwt, created.id, { name: "F4.16 RLS write-path renamed" });
  expect(updated.name).toBe("F4.16 RLS write-path renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}

/**
 * App-layer authorization, not RLS — `canManageOrganization` refuses before
 * `withTenant` is ever called. Kept because it is a real guarantee the
 * service must have; renamed and re-scoped so it no longer overclaims what it
 * proves.
 */
export async function assertRefusesOutOfScopeOrganization(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool, organizationId } = ctx;
  const { rows } = await ownerPool.query<{ id: string }>(
    "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
    [organizationId],
  );
  if (!rows[0]) {
    throw new Error("F4.16: need a second organization to prove cross-org refusal.");
  }
  await expect(
    svc.create(jwt, {
      organizationId: rows[0].id,
      code: `F4.16-RLS-DENY-${Date.now()}`,
      slug: `f4-16-rls-deny-${Date.now()}`,
      name: "must never be created",
      type: "rsmoc",
      latitude: 0,
      longitude: 0,
    }),
  ).rejects.toThrow(/access scope/i);
}

/**
 * The deactivate guard counts active RTUs and assets to refuse deactivating a
 * location that still has either. `E7.1b` moved those two counts inside
 * `withTenant(existing.organizationId, …)`: on the bare tenant pool with no
 * `SET LOCAL`, the 0047 FORCE policy on `assets`/`rtus` returns 0, the guard
 * never fires, and a location with live assets is deactivated anyway. The
 * existing lifecycle test deactivates an *empty* location, so it passes with the
 * guard blind; this seeds an active asset and proves the guard sees it.
 */
export async function assertDeactivateGuardSeesActiveAssetsUnderRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, tenantPool, ownerPool, organizationId } = ctx;

  const { rows: domRows } = await ownerPool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
  );
  if (!domRows[0]) {
    throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
  }
  const domain = domRows[0].code;

  const suffix = Date.now();
  const location = await svc.create(jwt, {
    organizationId,
    code: `E71B-LOC-GUARD-${suffix}`,
    slug: `e71b-loc-guard-${suffix}`,
    name: "E7.1b deactivate-guard location",
    type: "rsmoc",
    latitude: 0,
    longitude: 0,
  });

  const tenantDb = createDb(tenantPool);
  let assetId = "";
  try {
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: `E71B-AS-GUARD-${suffix}`,
          name: "E7.1b deactivate-guard asset",
          siteName: "E7.1b Site",
          locationId: location.id,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      assetId = asset.id;
    });

    await expect(
      svc.deactivate(jwt, location.id),
      "a location with an active asset must not deactivate — the guard counts inside the org GUC",
    ).rejects.toThrow(/active RTUs or assets/i);
  } finally {
    if (assetId) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = $1", [assetId]);
    }
    await ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [location.id]);
  }
}

/**
 * The actual `WITH CHECK` proof: a `SET LOCAL app.current_organization`
 * correctly naming organization A, writing a row that claims organization B.
 * `LocationsAdminService` never constructs this shape itself (the id it
 * passes to `withTenant` and the row's own `organizationId` always come from
 * the same source), so no code path through the service can trigger it — this
 * is the database policy's own defence for the case application logic never
 * produces, exercised directly against the real `bms_tenant` role.
 */
export async function assertPolicyRefusesMismatchedOrg(
  tenantDb: BmsDb,
  organizationId: string,
  otherOrganizationId: string,
): Promise<void> {
  await expect(
    withTenant(tenantDb, organizationId, (tx) =>
      tx.insert(locations).values({
        organizationId: otherOrganizationId,
        code: `F4.16-RLS-CHECK-${Date.now()}`,
        slug: `f4-16-rls-check-${Date.now()}`,
        name: "must never be written — WITH CHECK should refuse it",
        type: "rsmoc",
        latitude: 0,
        longitude: 0,
        active: true,
      }),
    ),
  ).rejects.toThrow(/row-level security/i);
}

/**
 * `F4.157` (ADR 0077) — the admin write paths refuse a code that is not a live
 * `bms.location_types` row with a 400 naming the codes, and the Type select's
 * read is gated like `list`.
 *
 * Every fixture code here is in the `F4157-LT-` family, which the test file's
 * stale sweep reaps; each case registers its row on creation and deletes it
 * in a `finally`. Each row is created as `pump_station`, and the caller is
 * `phe-admin`, so it lands in PHEWB. Since `92cdf14c`,
 * `tests/f4.157-location-types-schema.integration.test.ts` I5 reads only the
 * PHE seed's own rows (`meta ? 'phe'`), which these are not, so I5 does not
 * constrain the type these rows carry.
 */
function f4157Code(tag: string): string {
  return `F4157-LT-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createF4157Location(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  code: string,
  type: string,
  register: (id: string) => void,
) {
  const created = await ctx.svc.create(jwt, {
    organizationId: ctx.organizationId,
    code,
    slug: code.toLowerCase(),
    name: "F4.157 location type check",
    type,
    latitude: 0,
    longitude: 0,
  });
  register(created.id);
  return created;
}

async function countByCode(ctx: SvcWithFixtures, code: string): Promise<number> {
  const { rows } = await ctx.ownerPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.locations WHERE code = $1",
    [code],
  );
  return rows[0]?.n ?? -1;
}

/** L1 — `create` with an unknown type is a 400, not the foreign key's 500. */
export async function assertCreateRefusesAnUnknownTypeWithA400(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  let refused: unknown = null;
  try {
    await createF4157Location(ctx, jwt, f4157Code("NOPE"), "nope", register);
  } catch (err) {
    refused = err;
  }
  expect(
    refused,
    "an unknown location type must be refused with a BadRequestException",
  ).toBeInstanceOf(BadRequestException);
}

/**
 * L1 absence — the refused create wrote no row. Read by `code` with the query
 * L1's positive control proves can find a created row.
 */
export async function assertARefusedCreateWritesNoRow(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  const code = f4157Code("ABSENT");
  await createF4157Location(ctx, jwt, code, "nope", register).catch(() => undefined);
  expect(await countByCode(ctx, code), "a refused create must leave no location row").toBe(0);
}

/** L1 positive control — a live type creates the row the absence query can see. */
export async function assertCreateAcceptsALiveType(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  const code = f4157Code("LIVE");
  const created = await createF4157Location(ctx, jwt, code, "pump_station", register);
  try {
    expect(await countByCode(ctx, code), "the absence query must see a created row").toBe(1);
  } finally {
    await ctx.ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [created.id]);
  }
}

/** L2 — `update` naming an unknown type is a 400. */
export async function assertUpdateRefusesAnUnknownTypeWithA400(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  const created = await createF4157Location(ctx, jwt, f4157Code("UPD"), "pump_station", register);
  try {
    let refused: unknown = null;
    try {
      await ctx.svc.update(jwt, created.id, { type: "nope" });
    } catch (err) {
      refused = err;
    }
    expect(
      refused,
      "an unknown location type must be refused with a BadRequestException",
    ).toBeInstanceOf(BadRequestException);
  } finally {
    await ctx.ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [created.id]);
  }
}

/** L2 — the refused update leaves the row's type as it was. */
export async function assertARefusedUpdateLeavesTheTypeUnchanged(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  const created = await createF4157Location(ctx, jwt, f4157Code("KEEP"), "pump_station", register);
  try {
    await ctx.svc.update(jwt, created.id, { type: "nope" }).catch(() => undefined);
    const { rows } = await ctx.ownerPool.query<{ type: string }>(
      "SELECT type FROM bms.locations WHERE id = $1",
      [created.id],
    );
    expect(rows[0]?.type, "a refused update must leave the stored type unchanged").toBe("pump_station");
  } finally {
    await ctx.ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [created.id]);
  }
}

/** L3 — `listLocationTypes` refuses a caller who is not a master-data user with a 403. */
export async function assertListLocationTypesRefusesANonMasterDataUser(
  svc: LocationsAdminService,
  nonMasterDataJwt: JwtPayload,
): Promise<void> {
  let refused: unknown = null;
  try {
    await svc.listLocationTypes(nonMasterDataJwt);
  } catch (err) {
    refused = err;
  }
  expect(
    refused,
    "a non-master-data user must be refused with a ForbiddenException",
  ).toBeInstanceOf(ForbiddenException);
}

/**
 * L5 — `list` returns `typeLabel: "RSMOC"` for a fixture location of type
 * `rsmoc` (F4.162, ADR 0077 Amendment 1, plan D3). `mapRow`'s LEFT JOIN
 * carries the seeded label rather than the bare code. Mutation: replace
 * `typeLabel: row.typeLabel ?? loc.type` with `typeLabel: loc.type` in
 * `LocationsAdminService.mapRow`.
 */
export async function assertListCarriesTheRsmocTypeLabel(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  register: (id: string) => void,
): Promise<void> {
  const created = await createF4157Location(ctx, jwt, f4157Code("RSMOC-LABEL"), "rsmoc", register);
  try {
    const { items } = await ctx.svc.list(jwt, ctx.organizationId);
    const listed = items.find((item) => item.id === created.id);
    expect(listed?.typeLabel, "list must carry the joined label for a live rsmoc row").toBe("RSMOC");
  } finally {
    // Deleted here, not deferred to `afterAll` — an active PHEWB row left
    // window-long is what turned `access-control-rls.integration.test.ts`'s
    // global-admin active-location count 17 instead of 16 for the lifecycle
    // fixture above; this fixture is the same shape, so it gets the same fix.
    await ctx.ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [created.id]);
  }
}

/**
 * L4 — `listLocationTypes` returns `{ items }`, the four seeded types in
 * order among them. Also L3's positive control: a master-data user is served.
 *
 * Filtered to the seeded four: ADR 0077's extension path is one INSERT, and a
 * fifth type must not redden a gate about the first four. An empty `items`
 * still fails, because the filtered list is then empty too.
 */
export async function assertListLocationTypesReturnsTheFour(
  svc: LocationsAdminService,
  jwt: JwtPayload,
): Promise<void> {
  const seeded = ["smoc_campus", "rsmoc", "csmoc", "pump_station"];
  const { items } = await svc.listLocationTypes(jwt);
  expect(items.map((row) => row.code).filter((code) => seeded.includes(code))).toEqual(seeded);
}
