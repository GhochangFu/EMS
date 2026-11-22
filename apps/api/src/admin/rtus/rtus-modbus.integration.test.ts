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
  assertABadBodyIs400,
  assertABindCreatesTheRowAndCopiesTheRegisters,
  assertALaterProfileVersionLeavesTheBindAlone,
  assertAnMqttRowIs409,
  assertAnotherOrganizationsEndpointIs409,
  assertAnotherOrganizationsProfileIs404,
  assertARebindRewritesTheConfig,
  assertTheAuditHoldsNoRegisterList,
  assertTheBindMovesTheAssetsByTheExistingRule,
  assertTheGateIsTheLocations,
  type RtuModbusFixtures,
} from "./rtus-modbus.integration.spec";
import { RtusModbusService } from "./rtus-modbus.service";
import { RtusAdminService } from "./rtus.service";

/**
 * `F1.2` (plan T7.2) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014);
 * this file owns the database lifecycle. The services run as the API does: RTU and profile reads
 * on `bms_tenant` inside `withTenant`, the RTU lookup and the cross-organization endpoint check
 * on `bms_fleet`, access control on `bms_auth` + `bms_fleet`, audit on the tenant transaction.
 *
 * Fixtures: two fresh organizations (inserted on `bms_fleet`), each with a location and an
 * `organization_admin` granted on it. The users, grants and profile rows need the superuser:
 * `bms.users` is FORCE-bound and `bms.device_profiles` is append-only by privilege (migration
 * `0164`). Cleanup is by the ids this run created.
 */
const because =
  "the stored connection row, the cross-organization endpoint refusal, the tenant policy that hides " +
  "another organization's profile, the asset hand-over and the audit row are all claims about rows " +
  "Postgres holds; a green run without a database asserts none of them.";
const connectionString = requireIntegrationDb({ item: "F1.2", label: "the RTU Modbus bind", because });
const superuserConnectionString = requireIntegrationDb({
  item: "F1.2",
  label: "the RTU Modbus bind's fixture users and profile rows",
  because:
    "the organization admins are bms.users rows with organization grants, and the profile rows are " +
    "append-only by privilege, so only the superuser may insert the one and delete the other.",
  connection: "superuser",
});

describe.skipIf(!connectionString || !superuserConnectionString)("F1.2 — the RTU Modbus bind", { timeout: 60_000 }, () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: RtuModbusFixtures;
  const stamp = randomUUID().replace(/-/g, "").slice(0, 8);
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const locationIds: string[] = [];
  const createdRtuIds: string[] = [];

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

    const side = async (suffix: "A" | "B"): Promise<{ organizationId: string; locationId: string; email: string }> => {
      const { rows: org } = await observer.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [`F12RM-${stamp.toUpperCase()}-${suffix}`, `F1.2 RTU Modbus ${suffix}`],
      );
      const organizationId = org[0]!.id;
      organizationIds.push(organizationId);
      const { rows: location } = await observer.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, 'F1.2 RTU Modbus site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0)
         RETURNING id`,
        [organizationId, `F12RM-${stamp.toUpperCase()}-${suffix}`, `f12rm-${stamp}-${suffix.toLowerCase()}`],
      );
      locationIds.push(location[0]!.id);
      const email = `f12rm-${stamp}-${suffix.toLowerCase()}@bms.local`;
      const { rows: user } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
           VALUES ($1, 'unused-not-a-login-test', $2, 'organization_admin', $3) RETURNING id`,
        [email, `F1.2 organization admin ${suffix}`, organizationId],
      );
      userIds.push(user[0]!.id);
      rememberSubject(email, user[0]!.id);
      await superPool.query("INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)", [
        user[0]!.id,
        organizationId,
      ]);
      return { organizationId, locationId: location[0]!.id, email };
    };
    const a = await side("A");
    const b = await side("B");

    const fleetDb = createDb(observer);
    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const rtus = new RtusAdminService(fleetDb, tenantDb, accessControl, audit);
    ctx = {
      svc: new RtusModbusService(fleetDb, tenantDb, accessControl, audit, rtus),
      rtus,
      observer,
      superPool,
      stamp,
      orgA: a.organizationId,
      orgB: b.organizationId,
      locationA: a.locationId,
      locationB: b.locationId,
      adminA: jwtFor(a.email, "organization_admin"),
      adminB: jwtFor(b.email, "organization_admin"),
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    if (superPool) {
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await superPool.query("DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      // `rtu_connection_configs` goes with its RTU (`ON DELETE CASCADE`).
      await superPool.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [createdRtuIds]);
      await superPool.query("DELETE FROM bms.device_profiles WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await superPool.query("DELETE FROM bms.user_organization_access WHERE user_id = ANY($1::uuid[])", [userIds]);
      await superPool.query("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [userIds]);
      await superPool.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    }
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), superPool?.end()]);
  }, 60_000);

  it("B1 creates a modbus_tcp row whose registers deep-equal the profile's, with { code, version }", async () => {
    await assertABindCreatesTheRowAndCopiesTheRegisters(ctx);
  });

  it("B2 leaves the bound config unchanged when the profile gains a later version", async () => {
    await assertALaterProfileVersionLeavesTheBindAlone(ctx);
  });

  it("B3 answers 404 for another organization's profile and writes nothing", async () => {
    await assertAnotherOrganizationsProfileIs404(ctx);
  });

  it("B4 answers 409 for an RTU whose connection row is MQTT", async () => {
    await assertAnMqttRowIs409(ctx);
  });

  it("B5 rewrites the config on a re-bind: null removes the interval, the legacy flat unitId goes", async () => {
    await assertARebindRewritesTheConfig(ctx);
  });

  it("B6 answers 400 for 999 ms, a register list, a bad unit id or a missing interval", async () => {
    await assertABadBodyIs400(ctx);
  });

  it("B7 moves an ingest-enabled RTU's assets to mqtt by the existing rule", async () => {
    await assertTheBindMovesTheAssetsByTheExistingRule(ctx);
  });

  it("B8 audits master.rtu.modbus.update with the profile reference and count, never the registers", async () => {
    await assertTheAuditHoldsNoRegisterList(ctx);
  });

  it("B9 answers 409 for an endpoint another organization's RTU uses (Amendment 2 (a))", async () => {
    await assertAnotherOrganizationsEndpointIs409(ctx);
  });

  it("B10 answers 403 to another organization's admin and 404 for an unknown RTU", async () => {
    await assertTheGateIsTheLocations(ctx);
  });
});
