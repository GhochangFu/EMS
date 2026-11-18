import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { AssetHealthService } from "../asset-health/asset-health.service";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { DegradationController } from "./degradation.controller";
import {
  assertAssetGroupScope,
  assertHIsP1AndDIsP2,
  assertLocationScope,
  assertNothingWasWritten,
  assertSNAndUAnswerNothing,
  assertTenantIsolationOnBothBranches,
  assertTheFleetStatementsPlan,
  assertTheLocalDay,
  assertTheScheduleNote,
  assertTheTenantRoleReadsTheFourTables,
  assertUnknownOrganizationIsEmpty,
  cleanupDegradationFixture,
  emptyCreated,
  seedDegradationFixture,
  seedScopedUsers,
  writeCountsOf,
  type DegradationContext,
} from "./degradation.integration.spec";
import { degradationReadsOf, DegradationService } from "./degradation.service";

/**
 * `E1.5a` (plan T1.9) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * on `bms_tenant` and `bms_fleet`, access control resolves on `bms_auth`, the
 * fixture is written on the superuser connection and removed by the ids it
 * created (`tests/integration-fixture-isolation`). All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.5a",
  label: "the degradation trends (real-only, local day, isolation, scoped users, schedule note, EXPLAIN)",
  because:
    "the real-data line, the target join, the local-day grouping, the row level security on bms_tenant, " +
    "the asset filter on the fleet branch, the scoped users' reads and the active-schedule read are all SQL " +
    "over real rows; a green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("E1.5a — the degradation trends against Postgres (ADR 0138)", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: DegradationContext;
  const created = emptyCreated();
  const stamp = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.5a");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.5a",
    );
    tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E1.5a");
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.5a");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);
    const narrow = new AssetFilterScopeService(fleetDb, accessControl);
    const health = new AssetHealthService(fleetDb);
    const svc = new DegradationService(tenantDb, fleetDb, fleet, health);

    const fx = await seedDegradationFixture(superuser, stamp, created);
    const { locUser, groupUser } = await seedScopedUsers(superuser, stamp, fx, created);
    ctx = {
      fx,
      svc,
      reads: degradationReadsOf({ tenantDb, fleetDb, pool: fleet, health }),
      controller: new DegradationController(svc, narrow, accessControl),
      narrow,
      accessControl,
      fleet,
      superuser,
      tenantDb,
      users: { admin: jwtFor(SEEDED.globalAdmin, "admin"), locUser, groupUser },
      writeCounts: await writeCountsOf(superuser, Object.values(fx.organizations)),
    };
  }, 240_000);

  // (9) After every read, the fixture organizations' schedules, work orders, alarms and rules are unchanged.
  afterEach(async () => {
    if (ctx) await assertNothingWasWritten(ctx);
  });

  afterAll(async () => {
    if (superuser) await cleanupDegradationFixture(superuser, created);
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 120_000);

  it("verify at build: bms_tenant reads asset_templates, automation_rules and both maintenance tables inside withTenant", async () => {
    await assertTheTenantRoleReadsTheFourTables(ctx);
  });

  it("(1) H answers P1 (13–17 days to Poor) and D answers P2 (10–12 days to the rule's 8 degC)", async () => {
    await assertHIsP1AndDIsP2(ctx);
  });

  it("(2) the simulated S, N with no fair band and U with no target class answer nothing", async () => {
    await assertSNAndUAnswerNothing(ctx);
  });

  it("(3) a counter hour at 19:00 UTC is returned under the next local day's label", async () => {
    await assertTheLocalDay(ctx);
  });

  it("(4) tenant isolation: organization A never sees B, on the tenant branch and on the fleet branch; the admin sees both", async () => {
    await assertTenantIsolationOnBothBranches(ctx);
  }, 120_000);

  it("(5) location scope: the Cold Store user lists D only, H is 403, North Yard is empty and not 403", async () => {
    await assertLocationScope(ctx);
  });

  it("(6) asset-group scope: the Fixture Group user lists G only, H is 403", async () => {
    await assertAssetGroupScope(ctx);
  });

  it("(7) an unknown organizationId answers candidates 0 and no asset", async () => {
    await assertUnknownOrganizationIsEmpty(ctx);
  });

  it("(8) H carries one schedule note and D none; without the schedule read only scheduleNotes differs", async () => {
    await assertTheScheduleNote(ctx);
  });

  it("(9) no read writes a schedule, work order, alarm or rule", async () => {
    await ctx.svc.list(null, new Date(ctx.fx.nowMs));
    await ctx.controller.forAsset(ctx.users.admin, ctx.fx.assets.h);
    await assertNothingWasWritten(ctx);
  }, 120_000);

  it("(10) both fleet statements plan as bms_fleet and read their relation", async () => {
    await assertTheFleetStatementsPlan(ctx);
  });
});
