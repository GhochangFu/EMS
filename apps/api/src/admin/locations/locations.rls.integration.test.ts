import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { LocationsAdminService } from "./locations.service";
import {
  assertARefusedCreateWritesNoRow,
  assertARefusedUpdateLeavesTheTypeUnchanged,
  assertCreateAcceptsALiveType,
  assertCreateRefusesAnUnknownTypeWithA400,
  assertCreateWithADuplicateCodeIsA409,
  assertDeactivateGuardSeesActiveAssetsUnderRls,
  assertListCarriesTheRsmocTypeLabel,
  assertListLocationTypesRefusesANonMasterDataUser,
  assertListLocationTypesReturnsTheFour,
  assertPolicyRefusesMismatchedOrg,
  assertRefusesOutOfScopeOrganization,
  assertUpdateRefusesAnUnknownTypeWithA400,
  assertUpdateToATakenSlugIsA409,
  assertWriteLifecycleSurvivesRealRls,
} from "./locations.rls.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F4.16` Task 8 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "LocationsAdminService against real, non-owner roles",
  because:
    "locations.service.ts has no other test file at all. Constructing the service with " +
    "real bms_auth/bms_tenant/bms_fleet connections is the only proof that withTenant " +
    "actually enforces row-level security on create/update/deactivate/reactivate, rather " +
    "than passing only because the owner connection bypasses it regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
/** `asset_group_admin` in `bms.users` — refused by `requireMasterDataUser`. */
const ASSET_GROUP_ADMIN_EMAIL = "wc-hvac-admin@bms.local";

/** Every location code family this suite commits, for the stale sweep below. */
const LOCATION_FAMILIES = ["F4.16-RLS-%", "E71B-LOC-GUARD-%", "F4157-LT-%", "F4211-LOC-%"];
const GUARD_ASSET_FAMILY = "E71B-AS-GUARD-%";

/**
 * Reaps rows an earlier run of this suite committed but never cleaned.
 *
 * `work-orders.service.rls.integration.test.ts` calls this shape "the `F4.16`
 * shape" and carries the same sweep for the same reason: `db:seed`'s
 * `verifyHierarchySeed` counted PHEWB locations exactly, so one leaked fixture
 * row turned the seed red on any database that was not thrown away after the
 * run. CI never saw it — its database is fresh every job — and a developer
 * database accumulates. Five rows had by 2026-08-27, which is what made
 * `db:seed` fail with "PHEWB locations: expected 6, got 7". Since the
 * `F4.169`/`F4.170` addendum the gate counts only the six catalog PHE
 * locations present, so a leaked row no longer stops the seed; the sweep
 * stays, because a leaked row is still a stray location in every PHEWB list.
 *
 * Two leak paths, and neither is reachable from inside the failing process:
 * `svc.create` can commit the row and then throw before returning it (the audit
 * write is a separate transaction), so no caller ever learns the id; and a
 * killed run — Ctrl+C, a crashed worker — never reaches `afterAll` at all. The
 * `register` callback closes the third path, an assertion failing *after* a
 * successful create. This closes the other two.
 *
 * Bounded by `created_at`, which is the only thing that makes it safe: a
 * concurrent instance's rows are seconds old, so a half-hour-old row cannot
 * belong to a run still in flight. Child-first, because the FK from `assets`
 * into `locations` is NO ACTION, not CASCADE. Non-fatal: a row an FK still pins
 * is a later run's hygiene, not this run's failure — fixture codes carry a
 * timestamp, so a leftover cannot collide with anything this run writes.
 */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [GUARD_ASSET_FAMILY],
    );
    for (const family of LOCATION_FAMILIES) {
      // Audit rows first: they carry the location's id, and dropping the
      // location without them leaves an entity_id pointing at nothing.
      await pool.query(
        `DELETE FROM bms.audit_log
          WHERE entity_type = 'location'
            AND entity_id IN (
              SELECT id FROM bms.locations
               WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'
            )`,
        [family],
      );
      await pool.query(
        `DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
        [family],
      );
    }
  } catch (err) {
    process.stderr.write(
      "[F4.16] could not sweep stale fixture rows: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay,\n" +
        "        and pnpm db:seed will fail its PHEWB location count until they go.\n",
    );
  }
}

describe.skipIf(!connectionString)("F4.16 — LocationsAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: LocationsAdminService;
  let organizationId: string;
  let secondOrganizationId: string;
  const createdIds: string[] = [];

  let jwt: JwtPayload;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.16");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.16",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.16",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.16",
    );
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    await sweepStaleRuns(ownerPool);

    const { rows } = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!rows[0]) {
      throw new Error(
        `F4.16: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    organizationId = rows[0].id;

    const { rows: others } = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    if (!others[0]) {
      throw new Error("F4.16: need a second organization to prove cross-org refusal.");
    }
    secondOrganizationId = others[0].id;

    svc = new LocationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
      new VocabulariesService(createDb(tenantPool)),
    );
  });

  afterAll(async () => {
    // The happy-path test below deletes its own row immediately, so on a green
    // run this is a no-op DELETE on an already-gone id. It earns its keep when
    // that test throws *after* the create: `register` records the id at the
    // moment the row exists rather than on the return value, so a failed
    // assertion no longer strands a committed PHEWB location that `db:seed`
    // will later count.
    if (createdIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.locations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  it("creates, reads, updates, deactivates and reactivates a location under real RLS", async () => {
    const id = await assertWriteLifecycleSurvivesRealRls(
      { svc, tenantPool, ownerPool, organizationId },
      jwt,
      (created) => createdIds.push(created),
    );
    // Deleted here, not deferred to afterAll: the lifecycle ends with the row
    // active=true, and this suite's other two `it`s (plus every other
    // integration suite Vitest runs concurrently against the same shared
    // database) can otherwise observe it — access-control-rls.integration.
    // test.ts's global-admin active-location count did exactly that once,
    // 17 instead of 16, a transient off-by-one from this row's window being
    // the whole file's duration rather than just this test's.
    await ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [id]);
  });

  it("refuses an organization_admin creating a location outside their granted organization", async () => {
    await assertRefusesOutOfScopeOrganization(
      { svc, tenantPool, ownerPool, organizationId },
      jwt,
    );
  });

  it("refuses a write whose row claims a different organization than SET LOCAL names (WITH CHECK)", async () => {
    await assertPolicyRefusesMismatchedOrg(
      createDb(tenantPool),
      organizationId,
      secondOrganizationId,
    );
  });

  it("refuses to deactivate a location that still has an active asset (guard counts under the org GUC)", async () => {
    await assertDeactivateGuardSeesActiveAssetsUnderRls(
      { svc, tenantPool, ownerPool, organizationId },
      jwt,
    );
  });

  const register = (created: string) => {
    createdIds.push(created);
  };

  it("F4.157 L1 — create refuses an unknown location type with a 400", async () => {
    await assertCreateRefusesAnUnknownTypeWithA400({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.157 L1 — a refused create writes no row", async () => {
    await assertARefusedCreateWritesNoRow({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.157 L1 control — create accepts a live location type", async () => {
    await assertCreateAcceptsALiveType({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.157 L2 — update refuses an unknown location type with a 400", async () => {
    await assertUpdateRefusesAnUnknownTypeWithA400({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.157 L2 — a refused update leaves the stored type unchanged", async () => {
    await assertARefusedUpdateLeavesTheTypeUnchanged({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.157 L3 — listLocationTypes refuses a non-master-data user with a 403", async () => {
    await assertListLocationTypesRefusesANonMasterDataUser(svc, {
      ...jwtFor(ASSET_GROUP_ADMIN_EMAIL, "organization_admin"),
      role: "asset_group_admin",
    });
  });

  it("F4.157 L4 — listLocationTypes returns the four active types in order", async () => {
    await assertListLocationTypesReturnsTheFour(svc, jwt);
  });

  it("F4.162 L5 — list carries typeLabel: \"RSMOC\" for a live rsmoc fixture location", async () => {
    await assertListCarriesTheRsmocTypeLabel({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.211 — a create with a code the organization holds is a 409 naming the code", async () => {
    await assertCreateWithADuplicateCodeIsA409({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });

  it("F4.211 — an update to a slug another location holds is a 409 naming the slug", async () => {
    await assertUpdateToATakenSlugIsA409({ svc, tenantPool, ownerPool, organizationId }, jwt, register);
  });
});
