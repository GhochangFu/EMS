import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertADuplicatePairIs409,
  assertAnUnknownOrInactiveKeyIs400,
  assertEmptyPatchIs400AndUnknownIdIs404,
  assertGlobalAdminLifecycle,
  assertTenantAdminsAreRefusedEverything,
  assertTheSeededRowIsReadOnly,
  deleteAuditRows,
  type PksFixtures,
} from "./point-key-states.integration.spec";
import { PointKeyStatesAdminService } from "./point-key-states.service";

/**
 * `F4.309` (plan T3) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014);
 * this file owns the database lifecycle. Built from the real roles as `F3.39`'s point-key suite
 * is: the service reads and writes on `bms_fleet`, the audit service holds both pools, and access
 * control reads `bms.users` on `bms_auth`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.309",
  label: "PointKeyStatesAdminService against bms.point_key_states",
  because:
    "the global-admin gate on every route, the 409 on a seeded row, the 400 on an unknown or " +
    "inactive key, the translated unique 409 and the one org-less audit row per write are all " +
    "claims about rows Postgres holds; a green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("F4.309 — the admin point-key-states service", () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: PksFixtures;
  let admin: JwtPayload;
  let tenantAdmins: JwtPayload[];
  const stateIds: string[] = [];
  const stamp = Date.now();
  const activeKey = `f4-309-key-${stamp}`;
  const inactiveKey = `f4-309-off-${stamp}`;

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F4.309");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.309",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.309",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.309",
    );
    await primeSeededSubjects(fleetPool);
    admin = jwtFor(SEEDED.globalAdmin, "admin");
    tenantAdmins = [
      jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      jwtFor(SEEDED.locationAdmin, "location_admin"),
    ];

    await observer.query(
      `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, 'F4.309 per-run key', true), ($2, 'F4.309 inactive key', false)`,
      [activeKey, inactiveKey],
    );

    const fleetDb = createDb(fleetPool);
    ctx = {
      svc: new PointKeyStatesAdminService(
        fleetDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(createDb(tenantPool), fleetDb),
      ),
      observer,
      activeKey,
      inactiveKey,
    };
  });

  afterAll(async () => {
    if (observer) {
      await deleteAuditRows(observer, stateIds);
      // `point_key_states` cascades from `point_keys` (migration `0097`).
      await observer.query("DELETE FROM bms.point_keys WHERE code = ANY($1::text[])", [[activeKey, inactiveKey]]);
    }
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("lets the global admin create, list, patch and delete a row, one org-less audit row each", async () => {
    stateIds.push(await assertGlobalAdminLifecycle(ctx, admin));
  });

  it("refuses an organization_admin and a location_admin the list and every write", async () => {
    const fixture = await ctx.svc.create(admin, { pointKey: activeKey, value: 3, label: "FIXTURE", tone: "open" });
    stateIds.push(fixture.id);
    await assertTenantAdminsAreRefusedEverything(ctx, tenantAdmins, fixture.id);
  });

  it("answers 409 to a PATCH, DELETE or POST of the seeded (breaker_main, 1), and leaves it", async () => {
    await assertTheSeededRowIsReadOnly(ctx, admin);
  });

  it("answers 400 to an unknown or an inactive point key", async () => {
    await assertAnUnknownOrInactiveKeyIs400(ctx, admin);
  });

  it("answers 409 to a duplicate pair, naming it", async () => {
    stateIds.push(await assertADuplicatePairIs409(ctx, admin));
  });

  it("answers 400 to an empty PATCH and 404 to an unknown id", async () => {
    const row = await ctx.svc.create(admin, { pointKey: activeKey, value: 5, label: "SPARE", tone: "shut" });
    stateIds.push(row.id);
    await assertEmptyPatchIs400AndUnknownIdIs404(ctx, admin, row.id);
  });
});
