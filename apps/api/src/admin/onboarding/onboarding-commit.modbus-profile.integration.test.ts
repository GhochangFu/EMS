import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertABoundRtuKeepsIngestOn,
  assertACodeResolvesToTheOrganizationsNewestVersion,
  assertAnotherOrganizationsEndpointIs409,
  assertAnotherOrganizationsProfileIsNotFound,
  assertAnUnboundRtuIsCommittedWithIngestOff,
  assertAProfileIsCopiedIntoTheDeviceSlice,
  assertTheAuditNamesTheProfileAndNoRegister,
  type OnboardingModbusFixtures,
} from "./onboarding-commit.modbus-profile.integration.spec";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F1.2` plan PR 11 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle. The commit runs as the API does: the session read and the
 * cross-organization endpoint check on `bms_fleet`, the write on `bms_tenant` inside `withTenant`,
 * access control on `bms_auth` + `bms_fleet`. The actor is the seeded global `admin`.
 *
 * Fixtures: two fresh organizations (inserted on `bms_fleet`) and a location in B; profile rows
 * and B's endpoint holder need the superuser (`bms.device_profiles` is append-only by privilege,
 * migration `0164`). Cleanup is by the organizations this run created.
 */
const because =
  "the stored connection row, the tenant predicate that hides another organization's profile, the " +
  "cross-organization endpoint refusal and the audit row are claims about rows Postgres holds.";
const connectionString = requireIntegrationDb({ item: "F1.2", label: "the onboarding commit binds a profile", because });
const superuserConnectionString = requireIntegrationDb({
  item: "F1.2",
  label: "the onboarding commit's fixture profile rows",
  because: "profile rows are append-only by privilege, so only the superuser may insert and delete them.",
  connection: "superuser",
});

describe.skipIf(!connectionString || !superuserConnectionString)(
  "F1.2 PR 11 — the onboarding commit binds a device profile (ADR 0141 decision 23)",
  { timeout: 60_000 },
  () => {
    let observer: pg.Pool;
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let superPool: pg.Pool;
    let ctx: OnboardingModbusFixtures;
    const stamp = randomUUID().replace(/-/g, "").slice(0, 8);
    const organizationIds: string[] = [];

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
          [`F12O-${stamp.toUpperCase()}-${suffix}`, `F1.2 onboarding Modbus ${suffix}`],
        );
        organizationIds.push(rows[0]!.id);
        return rows[0]!.id;
      };
      const orgA = await organization("A");
      const orgB = await organization("B");
      const { rows: location } = await observer.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F1.2 PR 11 site B', 'smoc_campus', 0, 0) RETURNING id`,
        [orgB, `F12O-${stamp.toUpperCase()}-B`, `f12o-${stamp}-b`],
      );
      const { rows: domain } = await observer.query<{ code: string }>(
        "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
      );

      const fleetDb = createDb(observer);
      const tenantDb = createDb(tenantPool);
      ctx = {
        commit: new OnboardingCommitService(
          fleetDb,
          tenantDb,
          new AccessControlService(createDb(authPool), fleetDb),
          new MasterDataAuditService(tenantDb, fleetDb),
          new OnboardingValidateService(),
          new VocabulariesService(fleetDb),
          { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
          // F3.22: the three template services; no draft here holds a template.
          {} as never,
          {} as never,
          {} as never,
          { listParentCandidates: async () => [] } as never,
        ),
        tenantDb,
        observer,
        superPool,
        admin: jwtFor("admin@bms.local", "admin"),
        stamp,
        orgA,
        orgB,
        locationB: location[0]!.id,
        domain: domain[0]!.code,
        sessionIds: [],
        committedLocationIds: [],
      };
    }, 60_000);

    afterAll(async () => {
      if (superPool) {
        await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.asset_points WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        // `rtu_connection_configs` goes with its RTU (`ON DELETE CASCADE`).
        await superPool.query("DELETE FROM bms.rtus WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.onboarding_sessions WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.device_profiles WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
        await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
      }
      await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), superPool?.end()]);
    }, 60_000);

    it("OM1 copies the profile's registers and { code, version } into the device slice", async () => {
      await assertAProfileIsCopiedIntoTheDeviceSlice(ctx);
    });
    it("OM2 keeps ingest on for an RTU committed with a profile", async () => {
      await assertABoundRtuKeepsIngestOn(ctx);
    });
    it("OM3 commits an RTU without a profile with ingest off and a canonical host", async () => {
      await assertAnUnboundRtuIsCommittedWithIngestOff(ctx);
    });
    it("OM4 refuses another organization's profile as not found and writes nothing", async () => {
      await assertAnotherOrganizationsProfileIsNotFound(ctx);
    });
    it("OM5 answers 409 for an endpoint another organization's RTU uses (Amendment 2 (a))", async () => {
      await assertAnotherOrganizationsEndpointIs409(ctx);
    });
    it("OM7 resolves a code to the organization's newest version only", async () => {
      await assertACodeResolvesToTheOrganizationsNewestVersion(ctx);
    });
    it("OM6 audits the profile by code and version, never a register", async () => {
      await assertTheAuditNamesTheProfileAndNoRegister(ctx);
    });
  },
);
