import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { MlAnomaliesService } from "../ml/ml-anomalies.service";
import { createEnergyRateResolver } from "../tariffs/energy-rate-resolver";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { AdvisoriesController } from "./advisories.controller";
import {
  assertExcessAgreesWithTheEnergyPage,
  assertLocationNarrowsToTheSubtree,
  assertOutsideScopeIsEmptyOr403,
  assertSimulatedNoZoneAndEnergyOffAnswerNone,
  assertTenantIsolationOnBothBranches,
  assertTheBaselineHourReadPlansOnTheHourlyAggregate,
  assertTheContextChangesNoNumber,
  assertTheHourReadPlansOnTheAggregate,
  assertTheLowPfMeterMatchesTheHandArithmetic,
  cleanupAdvisoriesFixture,
  emptyCreated,
  seedAdvisoriesFixture,
  type AdvisoriesContext,
} from "./advisories.integration.spec";
import { AdvisoriesService } from "./advisories.service";

/**
 * `E1.6a` (plan T1.8) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * on `bms_tenant` and `bms_fleet`, access control resolves on `bms_auth`, the
 * fixture is written on the superuser connection and removed by the ids it
 * created (`tests/integration-fixture-isolation`). All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.6a",
  label: "the advisories (real-only, zone, energy setting, tariff money, isolation, context, EXPLAIN)",
  because:
    "the real-data line, the location's own zone, the energy setting, the kVAh bill rate, the row level " +
    "security on bms_tenant, the asset filter on the fleet branch and the local-hour energy read are all " +
    "SQL over real rows; a green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("E1.6a — the advisories against Postgres (ADR 0137)", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: AdvisoriesContext;
  const created = emptyCreated();
  const stamp = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.6a");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.6a",
    );
    tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E1.6a");
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.6a");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);
    const narrow = new AssetFilterScopeService(fleetDb, accessControl);
    const rates = createEnergyRateResolver(fleetDb, fleet);
    const svc = new AdvisoriesService(tenantDb, fleetDb, fleet, rates, new MlAnomaliesService(tenantDb, fleetDb));
    const svcNoContext = new AdvisoriesService(tenantDb, fleetDb, fleet, rates, {
      forAsset: async (_assetId: string, _window: { from: Date; to: Date }, now: Date) => ({ asOf: now.toISOString(), scores: [] }),
    } as unknown as MlAnomaliesService);

    const fx = await seedAdvisoriesFixture(superuser, stamp, created);
    ctx = {
      fx,
      svc,
      svcNoContext,
      controller: new AdvisoriesController(svc, narrow, accessControl),
      narrow,
      fleet,
      tenantDb,
      users: {
        globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
        locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      },
    };
  }, 240_000);

  afterAll(async () => {
    if (superuser) await cleanupAdvisoriesFixture(superuser, created);
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 120_000);

  it("a real low-PF meter on a kVAh tariff: one advisory whose kVAh, kVAr and money match the hand arithmetic", async () => {
    await assertTheLowPfMeterMatchesTheHandArithmetic(ctx);
  });

  it("the same data on a simulated asset, at a location with no zone, or with energy features off: none", async () => {
    await assertSimulatedNoZoneAndEnergyOffAnswerNone(ctx);
  });

  it("1.6 × its own history answers excess_consumption, and the Energy page's verdictFor says above", async () => {
    await assertExcessAgreesWithTheEnergyPage(ctx);
  });

  it("a planted unusual hour is a context line and changes no number", async () => {
    await assertTheContextChangesNoNumber(ctx);
  });

  it("tenant isolation: organization A never sees B's meter, on the tenant branch and on the fleet branch", async () => {
    await assertTenantIsolationOnBothBranches(ctx);
  }, 120_000);

  it("another organization's id or location answers advisories: [] (never 403); the asset route is 403 outside scope", async () => {
    await assertOutsideScopeIsEmptyOr403(ctx);
  });

  it("locationId narrows to the subtree", async () => {
    await assertLocationNarrowsToTheSubtree(ctx);
  });

  it("EXPLAIN: the hour read plans on the 5-minute aggregate for the fixture's meters", async () => {
    await assertTheHourReadPlansOnTheAggregate(ctx);
  });

  it("F4.384 EXPLAIN: the baseline hour read plans on the hourly aggregate and returns X's 672 hours", async () => {
    await assertTheBaselineHourReadPlansOnTheHourlyAggregate(ctx);
  });
});
