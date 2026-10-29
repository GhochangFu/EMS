import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import {
  assertALocationOfAnotherOrganizationIsNotFound,
  assertALocationOutsideTheScopeIsRefused,
  assertAScopeWithAGapHasOnlyItsTopRoot,
  assertANamedLocationIsItsOwnRow,
  assertAlarmsRaisedAndOpenBySeverity,
  assertAnAssetOutsideTheReadableIdsIsNotCounted,
  assertARowCountsItsSubtreesAssets,
  assertKwhRollsUpAndIsNullWithoutData,
  assertNoDataAssetsAreCountedAndNamed,
  assertTheDefaultRowsAreTheReadableRootsInNameOrder,
  assertTheUnrestrictedRowsAreTheOrganizationsRoots,
  buildSummaryFixture,
  dropSummaryFixture,
  type SummaryFixture,
} from "./location-summary.integration.spec";
import { LocationSummaryService } from "./location-summary.service";

/**
 * `F4.290` PR 2 — Vitest entry point for `LocationSummaryService`'s
 * integration claims. Assertions live in the sibling `.spec` (ADR 0014). The
 * service runs on the `bms_fleet` pool, as in the API; the fixture is
 * committed as the superuser in two fresh organizations (a continuous
 * aggregate cannot see an uncommitted sample) and deleted by their ids in
 * `afterAll`, telemetry first with the aggregates re-covered.
 */
const connectionString = requireIntegrationDb({
  item: "F4.290",
  label: "get_location_summary's rows, rollups, kWh, alarms and no-data assets",
  because:
    "the claims are the location roots, the subtree rollup through the ancestor walk, kWh from the _1h " +
    "aggregate and alarm counts from bms.alarms; a fake would answer every one of them while no row was read.",
});

describe.skipIf(!connectionString)("F4.290 — the location summary over a real database", () => {
  const run = randomUUID().replace(/-/g, "").slice(0, 8);
  let fleet: pg.Pool | undefined;
  let admin: pg.Pool | undefined;
  const organizations: string[] = [];
  let fx: SummaryFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "F4.290");
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.290");
    const svc = new LocationSummaryService(createDb(fleet), fleet);
    fx = await buildSummaryFixture(admin, svc, run, (id) => organizations.push(id));
  }, 180_000);

  afterAll(async () => {
    if (admin) await dropSummaryFixture(admin, organizations);
    await Promise.all([fleet, admin].map((pool) => pool?.end()));
  }, 180_000);

  const fixture = (): SummaryFixture => fx ?? (() => { throw new Error("F4.290: the fixture was not built"); })();

  it("the default rows are the readable roots in name order", () => assertTheDefaultRowsAreTheReadableRootsInNameOrder(fixture()));
  it("the unrestricted rows are the organization's roots", () => assertTheUnrestrictedRowsAreTheOrganizationsRoots(fixture()));
  it("a row counts its subtree's assets", () => assertARowCountsItsSubtreesAssets(fixture()));
  it("kWh rolls up and is null without data", () => assertKwhRollsUpAndIsNullWithoutData(fixture()));
  it("alarms are counted raised and open by severity", () => assertAlarmsRaisedAndOpenBySeverity(fixture()));
  it("no-data assets are counted and named", () => assertNoDataAssetsAreCountedAndNamed(fixture()));
  it("an asset outside the readable ids is not counted", () => assertAnAssetOutsideTheReadableIdsIsNotCounted(fixture()));
  it("a named location is its own row", () => assertANamedLocationIsItsOwnRow(fixture()));
  it("a location of another organization is not found", () => assertALocationOfAnotherOrganizationIsNotFound(fixture()));
  it("a location outside the caller's scope is refused", () => assertALocationOutsideTheScopeIsRefused(fixture()));
  it("a scope with a gap has only its top root", () => assertAScopeWithAGapHasOnlyItsTopRoot(fixture()));
});
