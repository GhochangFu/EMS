import { randomUUID } from "node:crypto";

import type pg from "pg";

import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import {
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
} from "./asset-roles.schema";
import type { AssetRolesAdminService } from "./asset-roles.service";

/**
 * `F3.40` / ADR 0051 decision 5 — assertions for the asset role write path.
 *
 * Assertions live here and the database lifecycle lives in the sibling `.test`
 * (ADR 0014). Everything below states a claim the row makes:
 *
 * - `0060` put `meter` and `pump` in the vocabulary — the migration's own gate,
 *   read back through the service rather than out of the SQL file.
 * - Only the global `admin` may write, and a tenant administrator is refused —
 *   the security claim, checked with the SAME call that succeeds for `admin`,
 *   so a refusal cannot come from the request being malformed.
 * - Retirement is `PATCH { active: false }`, and the picker read drops it while
 *   the admin read keeps it.
 * - The audit row is org-less and carries no `entity_id`.
 */

/** A global `admin`. Seeded by `pnpm db:seed` (`AUTH_MODE=local`). */
export const globalAdminJwt: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "integration:admin",
  role: "admin",
};

/**
 * A `location_admin`, and the point is that `requireMasterDataUser` ADMITS
 * them. They pass the master-data gate every other admin route uses and are
 * stopped only by `isGlobalAdmin`, which is exactly the hole ADR 0051 decision
 * 5 closes. A `viewer` would be refused one step earlier and prove nothing
 * about this gate.
 */
export const tenantAdminJwt: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "wc-admin@bms.local",
  name: "integration:location-admin",
  role: "location_admin",
};

/**
 * The family every fixture code of this suite belongs to. A constant, and it is
 * only ever used age-bounded — see `removeFixtures`.
 */
const FIXTURE_FAMILY = "f340-";

/**
 * THE PREFIX IS PER RUN, and `tests/integration-fixture-isolation.test.ts` is
 * why.
 *
 * These rows are COMMITTED — `bms.asset_roles` has no policy and this suite
 * isolates by cleaning up, not by `tx.rollback()`. A constant prefix means two
 * concurrent instances of this one file delete each other's rows: the second
 * run's `beforeAll` sweep removes the first run's fixture between its `create`
 * and its `PATCH`, and the failure is a 404 that looks like a service defect.
 * The `randomUUID()` slice makes the two runs disjoint.
 *
 * Eight characters of a v4 uuid, so the whole code stays far inside
 * `code varchar(64)` however long a suffix an assertion chooses.
 */
const RUN_PREFIX = `${FIXTURE_FAMILY}${randomUUID().slice(0, 8)}-`;

/** Codes this suite creates. Every one is removed in the `.test`'s `afterAll`. */
export const fixtureCode = (suffix: string): string => `${RUN_PREFIX}${suffix}`;

/**
 * Removes what this run created, and only what this run created.
 *
 * TWO SWEEPS, WITH DIFFERENT SCOPES ON PURPOSE.
 *
 * 1. **This run's rows, by `RUN_PREFIX`.** Unbounded by age, because they are
 *    this run's own and no other instance can hold them.
 * 2. **The family's ORPHANS, bounded by `created_at`.** A run killed part-way
 *    leaves rows a per-run prefix can never name again, and they would sit in a
 *    shared developer database for good. The age bound is what keeps this from
 *    reaching a concurrent instance — the exemption
 *    `tests/integration-fixture-isolation.test.ts` states for exactly this case.
 *    An hour is far longer than the suite takes and far shorter than a
 *    developer leaves a database alone.
 *
 * The audit rows go first in each pair. They carry no foreign key to
 * `bms.asset_roles` and would simply accumulate, but an audit row naming a code
 * that no longer exists is a misleading thing to leave behind.
 *
 * Nothing here touches `bms.asset_group_members`: this suite creates no
 * membership, so no `asset_group_members_role_fkey` can hold a fixture code and
 * the `DELETE` cannot be refused.
 */
export async function removeFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_type = 'asset_role' AND payload->>'code' LIKE $1`,
    [`${RUN_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.asset_roles WHERE code LIKE $1`, [`${RUN_PREFIX}%`]);

  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE entity_type = 'asset_role'
        AND payload->>'code' LIKE $1
        AND created_at < now() - interval '1 hour'`,
    [`${FIXTURE_FAMILY}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_roles WHERE code LIKE $1 AND created_at < now() - interval '1 hour'`,
    [`${FIXTURE_FAMILY}%`],
  );
}

/**
 * Migration `0060`'s effect, read through the service that serves it.
 *
 * The SQL file's own `DO` block already refuses to apply without these two
 * rows. This checks the other half — that they arrive at a caller as ordinary
 * vocabulary entries, active, ordered inside the electrical band and not after
 * the water one.
 */
export async function assertTheEstateShapesAreInTheVocabulary(
  svc: AssetRolesAdminService,
): Promise<void> {
  const { items } = await svc.list(globalAdminJwt);
  const byCode = new Map(items.map((item) => [item.code, item]));

  for (const code of ["meter", "pump"]) {
    const row = byCode.get(code);
    expect(row, `migration 0060 seeds '${code}' — run pnpm db:migrate`).toBeDefined();
    expect(row!.active).toBe(true);
  }

  // Appended to the electrical band (110-160), below water's 210. Asserted as a
  // range rather than as 170/180 so a later insert between them is free, while
  // a code that drifts into another train's band still fails.
  expect(byCode.get("meter")!.sortOrder).toBeGreaterThan(160);
  expect(byCode.get("pump")!.sortOrder).toBeGreaterThan(160);
  expect(byCode.get("meter")!.sortOrder).toBeLessThan(210);
  expect(byCode.get("pump")!.sortOrder).toBeLessThan(210);

  // Anti-vacuity: the list is the real vocabulary, not two rows.
  expect(items.length).toBeGreaterThanOrEqual(28);
}

/**
 * A create lands, and its audit row belongs to no tenant.
 *
 * `entity_id` is asserted NULL rather than left unread. `bms.audit_log.entity_id`
 * is `uuid` and `asset_roles.code` is `varchar(64)`, so a caller that passed the
 * code would get `22P02` — a 500 after the row had already been written. A test
 * that only checked the vocabulary would never see it.
 */
export async function assertCreateLandsWithAnOrgLessAuditRow(
  svc: AssetRolesAdminService,
  pool: pg.Pool,
): Promise<void> {
  const code = fixtureCode("created");
  const created = await svc.create(globalAdminJwt, {
    code,
    label: "F3.40 fixture",
    sortOrder: 990,
  });

  expect(created).toEqual({ code, label: "F3.40 fixture", sortOrder: 990, active: true });

  const { rows } = await pool.query<{
    organization_id: string | null;
    entity_id: string | null;
    entity_type: string;
    payload: { code?: string } | null;
  }>(
    // Keyed on THIS code, not "the newest create". Another assertion in this
    // file creates a role too, and a positional read would pass or fail on the
    // order Vitest happens to run them in.
    `SELECT organization_id, entity_id, entity_type, payload
       FROM bms.audit_log
      WHERE action = 'master.asset_role.create' AND payload->>'code' = $1
      LIMIT 1`,
    [code],
  );

  const audit = rows[0];
  expect(audit, "no audit row written for master.asset_role.create").toBeDefined();
  expect(audit!.organization_id).toBeNull();
  expect(audit!.entity_id).toBeNull();
  expect(audit!.entity_type).toBe("asset_role");
  expect(audit!.payload?.code).toBe(code);
}

/** `sortOrder` is optional, and the column default stands when it is omitted. */
export async function assertCreateWithoutSortOrderTakesTheColumnDefault(
  svc: AssetRolesAdminService,
): Promise<void> {
  const created = await svc.create(globalAdminJwt, {
    code: fixtureCode("default-order"),
    label: "F3.40 fixture, unordered",
  });
  expect(created.sortOrder).toBe(100);
}

/** A repeat of an existing code is a 409, not a 500. */
export async function assertADuplicateCodeIsAConflict(
  svc: AssetRolesAdminService,
): Promise<void> {
  await expect(
    svc.create(globalAdminJwt, { code: "meter", label: "A second meter" }),
  ).rejects.toMatchObject({ status: 409 });
}

/**
 * THE SECURITY CLAIM. A `location_admin` is refused on both verbs.
 *
 * The `admin` call below is the anti-vacuity twin: the same body, the same
 * service, one succeeding and one refused, so the 403 is attributable to the
 * role and to nothing else.
 */
export async function assertATenantAdministratorCannotWriteTheVocabulary(
  svc: AssetRolesAdminService,
): Promise<void> {
  const code = fixtureCode("refused");

  await expect(
    svc.create(tenantAdminJwt, { code, label: "Should never land" }),
  ).rejects.toMatchObject({ status: 403 });

  await expect(
    svc.update(tenantAdminJwt, "meter", { label: "Should never land" }),
  ).rejects.toMatchObject({ status: 403 });

  // The refusal is the role, not the body: the same create succeeds for admin.
  const created = await svc.create(globalAdminJwt, { code, label: "Should never land" });
  expect(created.code).toBe(code);
}

/**
 * Retirement, and the two reads that must disagree about it.
 *
 * `VocabulariesService.list` serves `active = true` only, so a retired code
 * leaves every picker — that is the requirement, not an accident of the query.
 * `AssetRolesAdminService.list` keeps it, or the administrator who retired it
 * could never name it again.
 */
export async function assertPatchRetiresACodeAndOnlyTheAdminReadKeepsIt(
  svc: AssetRolesAdminService,
  vocabularies: VocabulariesService,
): Promise<void> {
  const code = fixtureCode("retired");
  await svc.create(globalAdminJwt, { code, label: "F3.40 retiring fixture" });

  const before = await vocabularies.list();
  expect(before.assetRoles.map((role) => role.code)).toContain(code);

  const retired = await svc.update(globalAdminJwt, code, { active: false });
  expect(retired.active).toBe(false);

  const after = await vocabularies.list();
  expect(after.assetRoles.map((role) => role.code)).not.toContain(code);

  const admin = await svc.list(globalAdminJwt);
  expect(admin.items.map((role) => role.code)).toContain(code);

  const inactiveOnly = await svc.list(globalAdminJwt, false);
  expect(inactiveOnly.items.map((role) => role.code)).toContain(code);

  // And back, or retirement through the API would be one-way.
  const restored = await svc.update(globalAdminJwt, code, { active: true });
  expect(restored.active).toBe(true);
  expect((await vocabularies.list()).assetRoles.map((role) => role.code)).toContain(code);
}

/** A `PATCH` that names one field leaves the others alone. */
export async function assertPatchIsPartial(
  svc: AssetRolesAdminService,
): Promise<void> {
  const code = fixtureCode("partial");
  await svc.create(globalAdminJwt, { code, label: "Before", sortOrder: 991 });

  const updated = await svc.update(globalAdminJwt, code, { label: "After" });
  expect(updated).toEqual({ code, label: "After", sortOrder: 991, active: true });
}

/** An empty body is a 400 rather than a silent no-op with an audit row. */
export async function assertAnEmptyPatchIsRefused(
  svc: AssetRolesAdminService,
): Promise<void> {
  await expect(svc.update(globalAdminJwt, "meter", {})).rejects.toMatchObject({
    status: 400,
  });
}

/** An unknown code is a 404, and it is checked before the body. */
export async function assertAnUnknownCodeIsNotFound(
  svc: AssetRolesAdminService,
): Promise<void> {
  await expect(
    svc.update(globalAdminJwt, "no-such-role-code", { label: "x" }),
  ).rejects.toMatchObject({ status: 404 });
}

/**
 * The body schemas, with no database.
 *
 * Called from a plain `describe` in the `.test`, outside the `skipIf`, because
 * none of it needs Postgres — and a schema that stopped rejecting a bad code
 * would otherwise go unchecked on every machine without `DATABASE_URL`.
 */
export function assertTheBodySchemasHold(): void {
  // One spelling convention. `HT_Panel` is valid to the column and outside the
  // parser `tests/f3.38-stock-catalog-vocabulary.test.ts` scans the migrations
  // with, so the write path must not be able to create it.
  expect(createAssetRoleBodySchema.safeParse({ code: "HT_Panel", label: "x" }).success).toBe(false);
  expect(createAssetRoleBodySchema.safeParse({ code: "ht-panel", label: "x" }).success).toBe(true);

  // Digits are allowed inside a code and refused at its head. `co2-scrubber` is
  // a plant shape; `2nd-stage` is a spelling accident. EVERY code this suite
  // creates carries the run's uuid, so a rule that refused digits would let the
  // service accept fixture codes the controller rejects — the ADR 0051 class of
  // defect where a test asserts against a state no operator can produce.
  expect(createAssetRoleBodySchema.safeParse({ code: "co2-scrubber", label: "x" }).success).toBe(
    true,
  );
  expect(createAssetRoleBodySchema.safeParse({ code: "2nd-stage", label: "x" }).success).toBe(false);
  expect(
    createAssetRoleBodySchema.safeParse({ code: fixtureCode("shape"), label: "x" }).success,
    "the run-unique fixture codes this suite creates must be codes the route accepts",
  ).toBe(true);

  // ADR 0029: unknown keys are a 400, never silently dropped.
  expect(
    createAssetRoleBodySchema.safeParse({ code: "ok-code", label: "x", organizationId: "…" })
      .success,
  ).toBe(false);

  // `code` is the primary key and the FK target — a PATCH must not rename it.
  expect(updateAssetRoleBodySchema.safeParse({ code: "renamed" }).success).toBe(false);

  // Retirement is a field of this body, and every field of it is optional.
  expect(updateAssetRoleBodySchema.safeParse({ active: false }).success).toBe(true);
  expect(updateAssetRoleBodySchema.safeParse({}).success).toBe(true);

  // 64 is `code varchar(64)`; a 65th character must not reach the database.
  expect(createAssetRoleBodySchema.safeParse({ code: "a".repeat(65), label: "x" }).success).toBe(
    false,
  );
}
