/**
 * `removeFixtures` lives in this `.spec` beside the prefix it sweeps, rather
 * than in the `.test` where ADR 0014 puts the database lifecycle:
 * `tests/integration-fixture-isolation.test.ts` reads the per-run prefix out of
 * the declaration in the same file as the `DELETE`.
 */
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { LocationTypesVocabularyAdminService } from "./location-types.service";
import { lazyJwtFor } from "../../testing/seeded-subjects";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan U2 I1–I16) — the global-admin write
 * path for `bms.location_types`, against a real database.
 *
 * Assertions live here and the database lifecycle in the sibling `.test`
 * (ADR 0014). One claim per exported function; each is named after the plan
 * case whose mutation must redden it.
 *
 * **The four seeded codes are never written, deactivated or deleted.** A
 * retired seeded type leaves every organization's Type dropdown for as long as
 * it stays retired. Every write below targets a fixture code; the seeded codes
 * are only read (I9) or named in a call the gate refuses before any write
 * (I10–I14 use a fixture code, so not even that).
 */

export type Ctx = {
  svc: LocationTypesVocabularyAdminService;
  /** `VocabulariesService` on the tenant pool — the dropdown's read. */
  vocabularies: VocabulariesService;
  /** Superuser: fixture `bms.locations` rows (FORCE RLS), the audit read, the sweep. */
  superPool: pg.Pool;
};

/**
 * Seeded logins (`pnpm db:seed`, `AUTH_MODE=local`). `sub` decides the
 * `bms.users` row (`F3.78`, ADR 0089 decision 4: local auth resolves
 * `id = sub`): each JWT carries its seeded row's real id, read by
 * `primeSeededSubjects` in the wrapper's `beforeAll`. `lazyJwtFor` defers that
 * lookup to first use, because these payloads are built at import time.
 */
export const globalAdminJwt: JwtPayload = lazyJwtFor("admin@bms.local", "admin");

/**
 * A `location_admin`: `requireMasterDataUser` ADMITS them, so only
 * `isGlobalAdmin` stops them — the gate under test. A `viewer` would be refused
 * one step earlier and prove nothing about it.
 */
export const locationAdminJwt: JwtPayload = lazyJwtFor("wc-admin@bms.local", "location_admin");

/** An `organization_admin` — the role the step-6 non-global check runs as. */
export const organizationAdminJwt: JwtPayload = lazyJwtFor("phe-admin@bms.local", "organization_admin");

/**
 * An `asset_group_admin` (seeded `wc-hvac-admin`). `requireMasterDataUser`
 * refuses this role before `isGlobalAdmin` is asked, so I18 names that gate
 * by its message.
 */
export const assetGroupAdminJwt: JwtPayload = lazyJwtFor("wc-hvac-admin@bms.local", "asset_group_admin");

/** The seeded codes, in `sort_order` order (migration `0085`: 10, 20, 30, 40). */
export const SEEDED_CODES = ["smoc_campus", "rsmoc", "csmoc", "pump_station"] as const;

/** The family every fixture of this suite belongs to; swept only age-bounded. */
const FIXTURE_FAMILY = "f4162_";

/**
 * PER RUN, so two concurrent instances of this file never delete each other's
 * rows (`tests/integration-fixture-isolation.test.ts`). Eight lower-case hex
 * characters, so the prefix is inside the ruled class `^[a-z][a-z0-9_]*$` and
 * 15 of `code varchar(32)`'s characters — a suffix may be at most 17.
 */
const RUN_PREFIX = `${FIXTURE_FAMILY}${randomUUID().slice(0, 8)}_`;

/** A fixture type code (and a fixture location's code and slug). */
export const fixtureCode = (suffix: string): string => {
  const code = `${RUN_PREFIX}${suffix}`;
  if (code.length > 32) {
    throw new Error(`fixture code ${code} exceeds varchar(32)`);
  }
  return code;
};

/**
 * The family prefix with LIKE's `_` wildcard escaped, for the age-bounded
 * sweeps: unescaped, `f4162_%` would also match `f41620…` or `f4162x…`.
 *
 * The run-scoped sweeps pass `${RUN_PREFIX}%` UNESCAPED, and on purpose:
 * `tests/integration-fixture-isolation.test.ts` accepts a non-age-bounded
 * `code LIKE` sweep only in that literal form, with a `randomUUID()`
 * declaration behind the name. There `_` matches any one character, and a
 * foreign row would still need this run's eight random hex digits.
 */
const FAMILY_LIKE = `${FIXTURE_FAMILY.replace(/_/g, "\\_")}%`;

/**
 * Removes this run's rows, then the family's orphans older than an hour.
 *
 * **FK order:** audit rows, then locations, then types — `locations.type`
 * references `location_types.code` with no `ON DELETE`, so a type row cannot
 * go while a fixture location holds it. On the superuser pool: `bms.locations`
 * is FORCE-policied and `bms_owner` sees none of its rows.
 *
 * A leftover type row is visible fleet-wide in every Type dropdown, and a
 * leftover location under ESKOM breaks the next `compose up` re-seed check —
 * which is why this runs in `beforeAll` as well as `afterAll`.
 */
export async function removeFixtures(superPool: pg.Pool): Promise<void> {
  await superPool.query(
    `DELETE FROM bms.audit_log WHERE entity_type = 'location_type' AND payload->>'code' LIKE $1`,
    [`${RUN_PREFIX}%`],
  );
  await superPool.query(
    `DELETE FROM bms.audit_log
      WHERE entity_type = 'location_type'
        AND payload->>'code' LIKE $1
        AND created_at < now() - interval '1 hour'`,
    [FAMILY_LIKE],
  );
  await superPool.query(`DELETE FROM bms.locations WHERE slug LIKE $1`, [`${RUN_PREFIX}%`]);
  await superPool.query(
    `DELETE FROM bms.locations WHERE slug LIKE $1 AND created_at < now() - interval '1 hour'`,
    [FAMILY_LIKE],
  );
  await superPool.query(`DELETE FROM bms.location_types WHERE code LIKE $1`, [`${RUN_PREFIX}%`]);
  await superPool.query(
    `DELETE FROM bms.location_types WHERE code LIKE $1 AND created_at < now() - interval '1 hour'`,
    [FAMILY_LIKE],
  );
}

/** The admin list's row for `code`, or `undefined`. */
async function listed(ctx: Ctx, code: string) {
  const { items } = await ctx.svc.list(globalAdminJwt);
  return items.find((item) => item.code === code);
}

/** I1 — a create with no `sortOrder` is active, takes the column default 0, and counts 0. */
export async function assertI1CreateReturnsTheDefaults(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i1");
  const created = await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I1" });
  expect(created).toMatchObject({
    code,
    label: "F4.162 I1",
    active: true,
    sortOrder: 0,
    locationCount: 0,
  });
}

/** I2 — the same code twice is a 409, not a 500. */
export async function assertI2ADuplicateCodeIsAConflict(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i2");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I2" });
  await expect(ctx.svc.create(globalAdminJwt, { code, label: "again" })).rejects.toBeInstanceOf(
    ConflictException,
  );
}

/** I3 — a PATCH naming `label` and `sortOrder` writes both. */
export async function assertI3UpdateWritesLabelAndSortOrder(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i3");
  await ctx.svc.create(globalAdminJwt, { code, label: "Before", sortOrder: 3 });
  await ctx.svc.update(globalAdminJwt, code, { label: "After", sortOrder: 7 });
  expect(await listed(ctx, code)).toMatchObject({ label: "After", sortOrder: 7 });
}

/** I4 — an empty PATCH is a 400 (on an existing code, so the 404 cannot answer first). */
export async function assertI4AnEmptyPatchIsRefused(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i4");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I4" });
  await expect(ctx.svc.update(globalAdminJwt, code, {})).rejects.toBeInstanceOf(
    BadRequestException,
  );
}

/** I5 — a deactivated type stays in the admin list with `active: false`. */
export async function assertI5DeactivateKeepsTheRowInTheAdminList(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i5");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I5" });
  await ctx.svc.deactivate(globalAdminJwt, code);
  expect(await listed(ctx, code)).toMatchObject({ code, active: false });
}

/** I6 — the dropdown read (tenant pool, `active = true`) drops a deactivated type. */
export async function assertI6DeactivateRemovesTheTypeFromTheDropdown(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i6");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I6" });
  // Present first, or the absence below would pass for a row that never landed.
  expect((await ctx.vocabularies.listLocationTypes()).map((t) => t.code)).toContain(code);
  await ctx.svc.deactivate(globalAdminJwt, code);
  expect((await ctx.vocabularies.listLocationTypes()).map((t) => t.code)).not.toContain(code);
}

/** I7 — reactivate restores `active: true`. */
export async function assertI7ReactivateRestoresTheType(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i7");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I7" });
  await ctx.svc.deactivate(globalAdminJwt, code);
  const restored = await ctx.svc.reactivate(globalAdminJwt, code);
  expect(restored.active).toBe(true);
}

/**
 * I8a — a type no location uses counts 0. With `count(*)` over the LEFT JOIN
 * the NULL-extended row counts as 1, and only this case sees it.
 */
export async function assertI8aAnUnusedTypeCountsZero(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i8a");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I8a" });
  expect((await listed(ctx, code))?.locationCount).toBe(0);
}

/**
 * I8b — owner ruling OQ4: the count includes every `bms.locations` row of the
 * type, inactive ones included. The fixture location is `active = false`, so
 * a join that counted only active locations reddens this case.
 *
 * Inactive for a second reason: `apps/api/src/auth/access-control-rls.integration.test.ts`
 * counts ESKOM's ACTIVE locations, and an active fixture here raced that count
 * (17 vs 16) whenever the two files ran together.
 *
 * Inserted under ESKOM on the superuser pool (FORCE RLS) and deleted at once
 * in `finally`: a fixture location left under ESKOM for the file's duration is
 * visible to every concurrent suite that reads the organization's sites.
 */
export async function assertI8bOneLocationCountsOne(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i8b");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I8b" });

  const org = await ctx.superPool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
  );
  expect(org.rows, "the seed has no ESKOM organization").toHaveLength(1);

  try {
    await ctx.superPool.query(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
       VALUES ($1, $2, $2, 'F4.162 I8b fixture', $2, 0, 0, false)`,
      [org.rows[0]!.id, code],
    );
    expect((await listed(ctx, code))?.locationCount).toBe(1);
  } finally {
    await ctx.superPool.query(`DELETE FROM bms.locations WHERE slug = $1`, [code]);
  }
}

/**
 * I9 — the seeded four appear in `sort_order` order. Alphabetical order
 * (`csmoc`, `pump_station`, `rsmoc`, `smoc_campus`) differs from `sort_order`,
 * so `orderBy(code)` reddens it.
 *
 * The seeded rows' counts are deliberately not compared with a second read:
 * other suites insert and delete `rsmoc` fixture locations on the same
 * database, so two reads of a shared count race (the `F4.71` flake class).
 * I8a/I8b prove the count on a type only this suite uses.
 */
export async function assertI9TheSeededFourInSortOrder(ctx: Ctx): Promise<void> {
  const { items } = await ctx.svc.list(globalAdminJwt);
  const seeded = items.filter((item) =>
    (SEEDED_CODES as readonly string[]).includes(item.code),
  );
  expect(seeded.map((item) => item.code)).toEqual([...SEEDED_CODES]);
}

/**
 * I10–I14 — a `location_admin` is refused every verb. The target is a fixture
 * code that does not exist, so a 403 (not a 404) also shows the gate runs
 * before the existence check — and no seeded code is ever named.
 */
export async function assertI10LocationAdminIsRefusedList(ctx: Ctx): Promise<void> {
  await expect(ctx.svc.list(locationAdminJwt)).rejects.toBeInstanceOf(ForbiddenException);
}

export async function assertI11LocationAdminIsRefusedCreate(ctx: Ctx): Promise<void> {
  await expect(
    ctx.svc.create(locationAdminJwt, { code: fixtureCode("i11"), label: "never" }),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

export async function assertI12LocationAdminIsRefusedUpdate(ctx: Ctx): Promise<void> {
  await expect(
    ctx.svc.update(locationAdminJwt, fixtureCode("i12"), { label: "never" }),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

export async function assertI13LocationAdminIsRefusedDeactivate(ctx: Ctx): Promise<void> {
  await expect(
    ctx.svc.deactivate(locationAdminJwt, fixtureCode("i13")),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

export async function assertI14LocationAdminIsRefusedReactivate(ctx: Ctx): Promise<void> {
  await expect(
    ctx.svc.reactivate(locationAdminJwt, fixtureCode("i14")),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

/**
 * I15 — the create audit row: the action, the entity type, no entity id, no
 * organization, the code in the payload, and a resolved actor. Read by THIS
 * code on the superuser pool, never "the newest row".
 */
export async function assertI15CreateWritesAnOrgLessAuditRow(ctx: Ctx): Promise<void> {
  const code = fixtureCode("i15");
  await ctx.svc.create(globalAdminJwt, { code, label: "F4.162 I15" });

  const { rows } = await ctx.superPool.query<{
    action: string;
    entity_type: string;
    entity_id: string | null;
    organization_id: string | null;
    actor_id: string | null;
    code: string | null;
  }>(
    `SELECT action, entity_type, entity_id, organization_id, actor_id, payload->>'code' AS code
       FROM bms.audit_log
      WHERE entity_type = 'location_type'
        AND action = 'master.location_type.create'
        AND payload->>'code' = $1`,
    [code],
  );
  expect(rows, "no master.location_type.create audit row for the fixture").toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "master.location_type.create",
    entity_type: "location_type",
    entity_id: null,
    organization_id: null,
    code,
  });
  expect(rows[0]!.actor_id, "the audit row names no actor").not.toBeNull();
}

/** I16 — an `organization_admin` is refused `create`. */
export async function assertI16OrganizationAdminIsRefusedCreate(ctx: Ctx): Promise<void> {
  await expect(
    ctx.svc.create(organizationAdminJwt, { code: fixtureCode("i16"), label: "never" }),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

/**
 * I17 — an `organization_admin` is refused `list`: the fleet-wide count is a
 * figure about every tenant's estate (plan D2). Security review L1.
 */
export async function assertI17OrganizationAdminIsRefusedList(ctx: Ctx): Promise<void> {
  await expect(ctx.svc.list(organizationAdminJwt)).rejects.toBeInstanceOf(ForbiddenException);
}

/**
 * I18 — an `asset_group_admin` is refused `list` by `requireMasterDataUser`
 * (`isMasterDataRole` excludes the role). Security review L1.
 *
 * The message is the claim, not only the class: `isGlobalAdmin` refuses this
 * role too, with the same exception class, so a class check stays green when
 * the first gate admits the role. Asserting the master-data message is what
 * makes that mutation redden here. `list`, so a mutated run writes nothing.
 */
export async function assertI18AssetGroupAdminIsRefusedByTheMasterDataGate(
  ctx: Ctx,
): Promise<void> {
  await expect(ctx.svc.list(assetGroupAdminJwt)).rejects.toThrow(
    "Master data administration requires admin, organization_admin, or location_admin role",
  );
}
