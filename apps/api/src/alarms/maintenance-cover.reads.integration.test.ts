import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertCoverForAlarmsBatchesAcrossOrganizations,
  assertCoverForAlarmUnderTheTenant,
  assertCoverReadsOnlyWhatTheWindowsNeed,
  assertReadActiveWindowsIsTheD2Predicate,
  buildCoverReadsFixture,
  type CoverReadsFixture,
  dropCoverOrganization,
} from "./maintenance-cover.reads.integration.spec";

/**
 * `F4.359` U6 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools and the two organizations' lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.359",
  label: "maintenance-window cover reads against a real database",
  because:
    "the active predicate is the database clock's (plan D2), the location walk is the ADR 0098 tree's and " +
    "the raiser's read runs as bms_tenant under FORCE row security — none of which a fake can hold.",
});

describe.skipIf(!connectionString)("F4.359 U6 — the maintenance-window cover reads", () => {
  let pools: pg.Pool[] = [];
  let fx: CoverReadsFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.359");
    const tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.359");
    const admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.359");
    pools = [fleetPool, tenantPool, admin];
    fx = await buildCoverReadsFixture({ admin, adminDb: createDb(admin), tenantDb: createDb(tenantPool), fleetDb: createDb(fleetPool) });
  });

  afterAll(async () => {
    if (fx) {
      await dropCoverOrganization(fx.admin, fx.org.organizationId);
      await dropCoverOrganization(fx.admin, fx.foreign.organizationId);
    }
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): CoverReadsFixture => fx ?? (() => { throw new Error("fixture not built"); })();

  it("readActiveWindows is D2's active predicate on now(), one organization's when named", () => assertReadActiveWindowsIsTheD2Predicate(fixture()));
  it("coverForAlarm, as bms_tenant: the earliest covering window through the tree and the bound assets", () =>
    assertCoverForAlarmUnderTheTenant(fixture()));
  it("the walks run only when an active window needs them", () => assertCoverReadsOnlyWhatTheWindowsNeed(fixture()));
  it("coverForAlarms batches every organization on the fleet handle", () => assertCoverForAlarmsBatchesAcrossOrganizations(fixture()));
});
