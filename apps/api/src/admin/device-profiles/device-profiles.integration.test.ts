import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, rememberSubject } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertALocationAdminReadsItsOrganization,
  assertASaveIsANewRowAndAStaleSaveIs409,
  assertAnEditOrACopyResetsVerified,
  assertAnImportCopiesTheRepositoryNotAPeer,
  assertEveryWriteIsAudited,
  assertOrganizationsAreIsolated,
  assertTheRegisterBound,
  assertTheUniqueKeySettlesEveryRace,
  fixtureStock,
  type DeviceProfileFixtures,
} from "./device-profiles.integration.spec";
import { DeviceProfilesAdminService } from "./device-profiles.service";

/**
 * `F1.2` (plan T5.2) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service runs
 * as the API does: rows on `bms_tenant` inside `withTenant`, the `:id` lookup
 * on `bms_fleet`, access control on `bms_auth` + `bms_fleet`, audit on the
 * tenant transaction.
 *
 * Fixtures: two fresh organizations (inserted on `bms_fleet`), one
 * `organization_admin` granted on each, and a `location_admin` granted one
 * location of A (its own fixture row). The users and grants, and the
 * cleanup of the profile and audit rows, need the superuser: `bms.users` is
 * FORCE-bound and `bms.device_profiles` is append-only by privilege
 * (migration `0164` — no role the API holds may DELETE a row). Cleanup is by
 * the ids this run created.
 */
const because =
  "Row Level Security on the tenant pool, migration 0164's append-only grants, the unique key that " +
  "settles two saves from one base and the audit rows are all claims about rows Postgres holds; a " +
  "green run without a database asserts none of them.";
const connectionString = requireIntegrationDb({ item: "F1.2", label: "the device profiles API", because });
const superuserConnectionString = requireIntegrationDb({
  item: "F1.2",
  label: "the device profiles API's fixture users and append-only cleanup",
  because:
    "the two organization admins are bms.users rows with organization grants, and the profile rows are " +
    "append-only by privilege, so only the superuser may insert the one and delete the other.",
  connection: "superuser",
});

describe.skipIf(!connectionString || !superuserConnectionString)("F1.2 — the device profiles API", { timeout: 60_000 }, () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: DeviceProfileFixtures;
  const stamp = randomUUID().replace(/-/g, "").slice(0, 8);
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const locationIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F1.2");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F1.2");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F1.2",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F1.2");
    await primeSeededSubjects(observer);

    const organization = async (suffix: string): Promise<string> => {
      const { rows } = await observer.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [`F12DP-${stamp.toUpperCase()}-${suffix}`, `F1.2 device profiles ${suffix}`],
      );
      organizationIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const user = async (
      suffix: string,
      role: "organization_admin" | "location_admin",
      organizationId: string,
    ): Promise<{ id: string; email: string }> => {
      const email = `f12dp-${stamp}-${suffix}@bms.local`;
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
           VALUES ($1, 'unused-not-a-login-test', $2, $3, $4) RETURNING id`,
        [email, `F1.2 ${role} ${suffix}`, role, organizationId],
      );
      const id = rows[0]!.id;
      userIds.push(id);
      rememberSubject(email, id);
      return { id, email };
    };
    const organizationAdmin = async (suffix: string, organizationId: string): Promise<{ id: string; email: string }> => {
      const admin = await user(suffix, "organization_admin", organizationId);
      await superPool.query("INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)", [
        admin.id,
        organizationId,
      ]);
      return admin;
    };

    const orgA = await organization("A");
    const orgB = await organization("B");
    const adminA = await organizationAdmin("a", orgA);
    const adminB = await organizationAdmin("b", orgB);
    const { rows: location } = await observer.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F1.2 device profiles site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0)
       RETURNING id`,
      [orgA, `F12DP-${stamp.toUpperCase()}-LOC`, `f12dp-${stamp}-loc`],
    );
    locationIds.push(location[0]!.id);
    const locationAdminA = await user("loc", "location_admin", orgA);
    await superPool.query("INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)", [
      locationAdminA.id,
      location[0]!.id,
    ]);

    const fleetDb = createDb(observer);
    const tenantDb = createDb(tenantPool);
    const stock = fixtureStock(stamp);
    ctx = {
      svc: new DeviceProfilesAdminService(
        tenantDb,
        fleetDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        Object.values(stock),
      ),
      observer,
      superPool,
      stamp,
      orgA,
      orgB,
      adminA: jwtFor(adminA.email, "organization_admin"),
      adminAId: adminA.id,
      adminB: jwtFor(adminB.email, "organization_admin"),
      locationAdminA: jwtFor(locationAdminA.email, "location_admin"),
      stock,
    };
  }, 60_000);

  afterAll(async () => {
    if (superPool) {
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await superPool.query("DELETE FROM bms.device_profiles WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await superPool.query("DELETE FROM bms.user_organization_access WHERE user_id = ANY($1::uuid[])", [userIds]);
      await superPool.query("DELETE FROM bms.user_location_access WHERE user_id = ANY($1::uuid[])", [userIds]);
      await superPool.query("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [userIds]);
      await superPool.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    }
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), superPool?.end()]);
  }, 60_000);

  it("I1 gives organization B's admin 404 on A's profile and lists none of A's; a location admin may not write", async () => {
    await assertOrganizationsAreIsolated(ctx);
  });

  it("I1b lets a location admin read its organization's profiles and keeps another organization 404", async () => {
    await assertALocationAdminReadsItsOrganization(ctx);
  });

  it("I2 saves a new row and leaves the old one byte-equal; a stale or mismatched base is 409", async () => {
    await assertASaveIsANewRowAndAStaleSaveIs409(ctx);
  });

  it("I3 answers 409 when the unique key refuses a save, an import or a create (23505)", async () => {
    await assertTheUniqueKeySettlesEveryRace(ctx);
  });

  it("I4 carries the stock file's verified on an import and resets it to false on an edit or a copy", async () => {
    await assertAnEditOrACopyResetsVerified(ctx);
  });

  it("I5 imports the repository's registers after a peer organization edited its own copy", async () => {
    await assertAnImportCopiesTheRepositoryNotAPeer(ctx);
  });

  it("I6 refuses 257 registers with 400 and stores 256", async () => {
    await assertTheRegisterBound(ctx);
  });

  it("I7 audits every write with its organization, code, version and register count, never the registers", async () => {
    await assertEveryWriteIsAudited(ctx);
  });
});
