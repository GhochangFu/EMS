import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertForeignOrganizationIsNotFound,
  assertGroupTabRolesAreNonEmpty,
  assertGroupTabScopesTheRail,
  assertOfflineCountsFollowTheLiveWindow,
  assertOverviewReadsTheSite,
  assertOwningOrganizationReads,
  assertQuietTabHasAStatus,
  assertQuietTabHasNoWorstSeverity,
  assertReadableTabGroupCountsItsRole,
  assertRetiredMemberIsNotInTheScope,
  assertRetiredMemberIsNotInTheSummary,
  assertRetiredMemberIsNotOnTheRail,
  assertRetiredMemberTabStatusAgrees,
  assertTheReadRunsOnTheTenantHandle,
  assertUnreadableTabGroupCountsNoRole,
  assertStampedTabIsNotFound,
  assertStampedTabIsNotListed,
  assertStampedTabRowExists,
  assertTabWithCriticalMemberIsCritical,
  assertTabWithNoReadableMemberIsOutsideScope,
  assertUnknownTabIsNotFound,
  assertUnreadableMemberIsNotCounted,
  assertUnrestrictedReaderCountsBothMembers,
} from "./site-widgets.service.integration.spec";

/**
 * `F3.73` (plan D9, Task 3.4) — Vitest entry point for the site-widgets read against a real
 * database. Assertions live in the sibling `.spec` (ADR 0014); this file owns the pool. Every
 * case is rolled back (see the spec).
 */
const connectionString = requireIntegrationDb({
  item: "F3.73",
  label: "the site-widgets read",
  because:
    "the per-tab worst severity, the offline count against the shared live window, the readable-asset " +
    "narrowing and the organization predicates on the tab reads are all SQL, so a green run without a " +
    "database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.73 — SiteWidgetsService (real database)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.73");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("S1 a tab whose member holds an active critical alarm is critical", () => assertTabWithCriticalMemberIsCritical(db), 60_000);
  it("S2a a quiet group tab still has a status", () => assertQuietTabHasAStatus(db), 60_000);
  it("S2b a quiet group tab has no worst severity and tone ok", () => assertQuietTabHasNoWorstSeverity(db), 60_000);
  it("S3 offline counts follow the shared live window", () => assertOfflineCountsFollowTheLiveWindow(db), 60_000);
  it("S4a an unrestricted reader counts both members", () => assertUnrestrictedReaderCountsBothMembers(db), 60_000);
  it("S4b an unreadable member is not counted", () => assertUnreadableMemberIsNotCounted(db), 60_000);
  it("S4c a tab with no readable member is outside scope", () => assertTabWithNoReadableMemberIsOutsideScope(db), 60_000);
  it("S5 a group tab's roles are its group's role summary", () => assertGroupTabRolesAreNonEmpty(db), 60_000);
  it("S6 a group tab scopes the rail and the summary", () => assertGroupTabScopesTheRail(db), 60_000);
  it("S7 the Overview reads the dashboard's site", () => assertOverviewReadsTheSite(db), 60_000);
  it("S8 an unknown tab is a 404", () => assertUnknownTabIsNotFound(db), 60_000);
  it("S9a control: the foreign-stamped tab row exists", () => assertStampedTabRowExists(db), 60_000);
  it("S9b a foreign-stamped tab is not found by ?tab=", () => assertStampedTabIsNotFound(db), 60_000);
  it("S9c a foreign-stamped tab is not listed in tabs", () => assertStampedTabIsNotListed(db), 60_000);
  it("S10a a foreign organization gets 404", () => assertForeignOrganizationIsNotFound(db), 60_000);
  it("S10b the owning organization reads", () => assertOwningOrganizationReads(db), 60_000);
  it("S11a a caller not granted the tab's group reads no role", () => assertUnreadableTabGroupCountsNoRole(db), 60_000);
  it("S11b control: a caller granted the tab's group reads its role", () => assertReadableTabGroupCountsItsRole(db), 60_000);
  it("S12a a retired member is not in the tab's scope", () => assertRetiredMemberIsNotInTheScope(db), 60_000);
  it("S12b a retired member's alarm is not on the rail", () => assertRetiredMemberIsNotOnTheRail(db), 60_000);
  it("S12c a retired member's alarm is not in the summary", () => assertRetiredMemberIsNotInTheSummary(db), 60_000);
  it("S12d control: the tab's status agrees with its rail", () => assertRetiredMemberTabStatusAgrees(db), 60_000);
  it("S13 the read runs on the tenant handle, not the fleet one", () => assertTheReadRunsOnTheTenantHandle(db), 60_000);
});
