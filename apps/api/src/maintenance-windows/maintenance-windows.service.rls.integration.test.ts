import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { MaintenanceWindowsService } from "./maintenance-windows.service";
import {
  assertALinkOutsideTheOrganizationIsRefused,
  assertAnAbsentStartIsTheDatabaseClock,
  assertAnAssetGroupAdminCannotNameItsGroupsLocation,
  assertAnOrganizationLessUsersNamesComeBack,
  assertAWindowWithNoTargetIsNotFound,
  assertLinksMustBeInTheCallersScope,
  assertTheExtendAuditReadsTheLockedEnd,
  assertTheListHidesAnAncestorAndUnreadableLinks,
  assertTheListHidesTargetsTheCallerCannotRead,
  assertALocationAboveTheGrantIsRefused,
  assertAssetIdFindsAWindowThroughItsLocation,
  assertAssetIdsFollowTheReader,
  assertCreateWritesWindowTargetsAndAudit,
  assertEndAndCancelKeepToTheirState,
  assertEveryTargetMustBeInScopeToChange,
  assertExtendIsBoundedAndActiveOnly,
  assertOutOfScopeAndMissingTargetsShareOneText,
  assertStateSplitsTheList,
  assertTargetsOfTwoOrganizationsAreRefused,
  assertTheListShowsWindowsAboveAReadableAsset,
  buildWindowsFixture,
  dropWindowsGlobalActor,
  dropWindowsOrganization,
  type WindowsFixture,
} from "./maintenance-windows.service.rls.integration.spec";

/**
 * `F4.359` U3 — Vitest entry point for the maintenance-window service on the
 * real `bms_tenant` / `bms_fleet` pair, built as
 * `alarm-list-filters.integration.test.ts` builds it. Assertions live in the
 * sibling `.spec` (ADR 0014).
 */
const connectionString = requireIntegrationDb({
  item: "F4.359",
  label: "MaintenanceWindowsService scope, state and audit",
  because:
    "a maintenance window silences alarms for every asset under its targets; a green run here without a " +
    "database would assert that a site admin cannot reach another site's window and that the state guards " +
    "refuse a second end while nothing checked it.",
});

describe.skipIf(!connectionString)("F4.359 — MaintenanceWindowsService on the real tenant and fleet pools", () => {
  let pools: pg.Pool[] = [];
  let admin: pg.Pool | undefined;
  const organizations: string[] = [];
  let fx: WindowsFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.359");
    const tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.359");
    const authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.359");
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.359");
    pools = [fleetPool, tenantPool, authPool, admin];
    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const svc = new MaintenanceWindowsService(tenantDb, fleetDb, new MasterDataAuditService(tenantDb, fleetDb));
    const access = new AccessControlService(createDb(authPool), fleetDb);
    fx = await buildWindowsFixture(admin, svc, access, (id) => organizations.push(id));
  });

  afterAll(async () => {
    if (admin) for (const id of organizations) await dropWindowsOrganization(admin, id);
    if (admin && fx) await dropWindowsGlobalActor(admin, fx);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): WindowsFixture => fx ?? (() => { throw new Error("F4.359: the fixture was not built"); })();

  it("(1) create writes one window, three targets and one audit row with the reason", () => assertCreateWritesWindowTargetsAndAudit(fixture()));
  it("(2) targets of two organizations are a 400 and nothing is written", () => assertTargetsOfTwoOrganizationsAreRefused(fixture()));
  it("(3) an out-of-scope target and a missing one answer the same 400", () => assertOutOfScopeAndMissingTargetsShareOneText(fixture()));
  it("(4) a location above the caller's grant is refused (P2)", () => assertALocationAboveTheGrantIsRefused(fixture()));
  it("(5) the list shows a window above a readable asset, not another site's or organization's", () =>
    assertTheListShowsWindowsAboveAReadableAsset(fixture()));
  it("(6) state splits active, future and past; a cancelled future window is past", () => assertStateSplitsTheList(fixture()));
  it("(7) assetId finds a window through its location target", () => assertAssetIdFindsAWindowThroughItsLocation(fixture()));
  it("(8) an active item's assetIds follow the reader and the filter", () => assertAssetIdsFollowTheReader(fixture()));
  it("(9) extend is bounded to now + 7 d and refused off an active window", () => assertExtendIsBoundedAndActiveOnly(fixture()));
  it("(10) end and cancel keep to their state, once", () => assertEndAndCancelKeepToTheirState(fixture()));
  it("(11) a site admin cannot change a window that also targets another site (D15)", () =>
    assertEveryTargetMustBeInScopeToChange(fixture()));
  it("(12) a work order of another organization is a 400", () => assertALinkOutsideTheOrganizationIsRefused(fixture()));
  it("(13) an asset-group admin's real scope names a member asset, not its group's location (D15 too)", () =>
    assertAnAssetGroupAdminCannotNameItsGroupsLocation(fixture()));
  it("(14) the list hides a target the caller cannot read, and its label", () => assertTheListHidesTargetsTheCallerCannotRead(fixture()));
  it("(14b) the list hides an ancestor location target and a link the caller cannot read", () =>
    assertTheListHidesAnAncestorAndUnreadableLinks(fixture()));
  it("(15) an organization-less user's created-by and ended-by names come back", () =>
    assertAnOrganizationLessUsersNamesComeBack(fixture()));
  it("(16) a work order or schedule link must be inside the caller's scope", () => assertLinksMustBeInTheCallersScope(fixture()));
  it("(17) a window with no target is not found", () => assertAWindowWithNoTargetIsNotFound(fixture()));
  it("(18) the extend audit's previous end is the locked row's", () => assertTheExtendAuditReadsTheLockedEnd(fixture()));
  it("(19) an absent start is the database clock", () => assertAnAbsentStartIsTheDatabaseClock(fixture()));
});
