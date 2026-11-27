import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, rememberSubject, SEEDED } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAnUnchangedValueWritesNothing,
  assertOtherCallersAreRefused,
  assertTheColumnCheckHoldsTheBound,
  assertTheGlobalAdminSetsAndClears,
  assertTheOrganizationAdminSetsItsOwn,
  type PollIntervalFixtures,
} from "./organizations.poll-interval.integration.spec";
import { OrganizationsAdminService } from "./organizations.service";

/**
 * `F1.2` (plan T7.3) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle. The service runs as the API does: the write and its audit row
 * on `bms_tenant` inside `withTenant`, access control on `bms_auth` + `bms_fleet`. Two fresh
 * organizations; the fixture users and grants need the superuser (`bms.users` is FORCE-bound).
 */
const because =
  "the column, its CHECK, the organization-level gate (a direct grant) and the audit row are claims " +
  "about rows Postgres holds; a green run without a database asserts none of them.";
const connectionString = requireIntegrationDb({ item: "F1.2", label: "the organization default poll interval", because });
const superuserConnectionString = requireIntegrationDb({
  item: "F1.2",
  label: "the organization default poll interval's fixture users",
  because: "the organization and location admins are bms.users rows with grants, which only the superuser may insert.",
  connection: "superuser",
});

describe.skipIf(!connectionString || !superuserConnectionString)(
  "F1.2 — the organization default poll interval",
  { timeout: 60_000 },
  () => {
    let observer: pg.Pool;
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let superPool: pg.Pool;
    let ctx: PollIntervalFixtures;
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
          [`F12PI-${stamp.toUpperCase()}-${suffix}`, `F1.2 poll interval ${suffix}`],
        );
        organizationIds.push(rows[0]!.id);
        return rows[0]!.id;
      };
      const user = async (suffix: string, role: "organization_admin" | "location_admin", organizationId: string) => {
        const email = `f12pi-${stamp}-${suffix}@bms.local`;
        const { rows } = await superPool.query<{ id: string }>(
          `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
             VALUES ($1, 'unused-not-a-login-test', $2, $3, $4) RETURNING id`,
          [email, `F1.2 ${role} ${suffix}`, role, organizationId],
        );
        userIds.push(rows[0]!.id);
        rememberSubject(email, rows[0]!.id);
        return { id: rows[0]!.id, email };
      };

      const orgA = await organization("A");
      const orgB = await organization("B");
      const adminA = await user("a", "organization_admin", orgA);
      await superPool.query("INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)", [
        adminA.id,
        orgA,
      ]);
      const { rows: location } = await observer.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F1.2 poll interval site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0)
         RETURNING id`,
        [orgA, `F12PI-${stamp.toUpperCase()}-LOC`, `f12pi-${stamp}-loc`],
      );
      locationIds.push(location[0]!.id);
      const locationAdmin = await user("loc", "location_admin", orgA);
      await superPool.query("INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)", [
        locationAdmin.id,
        location[0]!.id,
      ]);

      const fleetDb = createDb(observer);
      const tenantDb = createDb(tenantPool);
      ctx = {
        svc: new OrganizationsAdminService(
          fleetDb,
          tenantDb,
          new AccessControlService(createDb(authPool), fleetDb),
          new MasterDataAuditService(tenantDb, fleetDb),
        ),
        observer,
        orgA,
        orgB,
        globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
        organizationAdminA: jwtFor(adminA.email, "organization_admin"),
        locationAdminA: jwtFor(locationAdmin.email, "location_admin"),
      };
    }, 60_000);

    afterAll(async () => {
      if (superPool) {
        await superPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.user_organization_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await superPool.query("DELETE FROM bms.user_location_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await superPool.query("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [userIds]);
        await superPool.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
        await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
      }
      await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), superPool?.end()]);
    }, 60_000);

    it("O1 the global admin sets and clears any organization's default, audited { from, to }", async () => {
      await assertTheGlobalAdminSetsAndClears(ctx);
    });

    it("O2 an organization admin with a direct grant sets its own organization (P12a)", async () => {
      await assertTheOrganizationAdminSetsItsOwn(ctx);
    });

    it("O3 that admin on another organization, and a location admin, are 403 and write nothing", async () => {
      await assertOtherCallersAreRefused(ctx);
    });

    it("O4 the stored value again writes no audit row", async () => {
      await assertAnUnchangedValueWritesNothing(ctx);
    });

    it("O5 the column CHECK refuses 999 even past the API", async () => {
      await assertTheColumnCheckHoldsTheBound(ctx);
    });
  },
);
