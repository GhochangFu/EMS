import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { dropOrganization } from "./alarm-list-filters.integration.spec";
import {
  assertByLocationCountsTheWindow,
  assertBySeverityCountsTheWindow,
  assertMttaIsTheAcknowledgedMean,
  assertMttrIsTheClearedMean,
  assertNoAcknowledgementIsNull,
  assertTheLocationsAreCutAt25,
  assertTheOutsiderIsCountedWhenPassed,
  assertTopAssetsAreOrderedByRaised,
  assertTwentyFiveLocationsAreNotCut,
  buildAlarmStatsFixture,
  type AlarmStatsFixture,
} from "./alarm-stats.integration.spec";
import { AlarmStatsService } from "./alarm-stats.service";

/**
 * `F4.291` PR 2 — Vitest entry point for `AlarmStatsService.range`.
 * Assertions live in the sibling `.spec` (ADR 0014). The service runs on the
 * real `bms_tenant` / `bms_fleet` pair (one organization's ids: the tenant
 * transaction under that organization's GUC); the fixture is written as the
 * superuser in a fresh organization and deleted by its id.
 */
const connectionString = requireIntegrationDb({
  item: "F4.291",
  label: "AlarmStatsService alarm statistics",
  because:
    "the copilot's get_alarm_stats answers counts, MTTA and MTTR from these four selects; a green run " +
    "without a database would assert that an asset outside the resolved ids is never counted while " +
    "nothing checked it.",
});

describe.skipIf(!connectionString)("F4.291 — AlarmStatsService counts a window of alarms over the given assets", () => {
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  let pools: pg.Pool[] = [];
  let admin: pg.Pool | undefined;
  let organizationId: string | undefined;
  let fx: AlarmStatsFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.291");
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.291",
    );
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.291");
    pools = [fleetPool, tenantPool, admin];
    const svc = new AlarmStatsService(createDb(tenantPool), createDb(fleetPool));
    fx = await buildAlarmStatsFixture(admin, run, svc, (id) => {
      organizationId = id;
    });
  }, 60_000);

  afterAll(async () => {
    if (admin && organizationId) await dropOrganization(admin, organizationId);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): AlarmStatsFixture => {
    if (fx === undefined) throw new Error("F4.291: the fixture was not built");
    return fx;
  };

  it("passed, the outsider is counted in every section (the positive neighbour)", () => assertTheOutsiderIsCountedWhenPassed(fixture()));
  it("by severity counts the half-open window, without the outsider", () => assertBySeverityCountsTheWindow(fixture()));
  it("by location counts the window per named location, without the outsider", () => assertByLocationCountsTheWindow(fixture()));
  it("the top assets are ordered by raised count, without the outsider", () => assertTopAssetsAreOrderedByRaised(fixture()));
  it("MTTA is the mean over the acknowledged alarms", () => assertMttaIsTheAcknowledgedMean(fixture()));
  it("MTTR is the mean over the cleared alarms", () => assertMttrIsTheClearedMean(fixture()));
  it("no acknowledgement in the window is mttaSeconds: null", () => assertNoAcknowledgementIsNull(fixture()));
  it("26 locations are cut at 25 with moreLocations", () => assertTheLocationsAreCutAt25(fixture()));
  it("25 locations are not cut", () => assertTwentyFiveLocationsAreNotCut(fixture()));
});
