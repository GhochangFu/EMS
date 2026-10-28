import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aFittedAlarmPageCarriesTruncatedAndACursor,
  aFullAlarmPageIsWholeJson,
  aListWithinTheBudgetIsUnchanged,
  anUnpagedListPutsTruncatedFirst,
  followingAlarmCursorsSkipsAndRepeatsNothing,
  listAssetsPagesAreWhole,
  listDashboardsPageIsWhole,
  listEscalationProfilesPageIsWhole,
  listLocationsPagesAreWhole,
  listMaintenancePagesAreWhole,
  listReportSchedulesPageIsWhole,
  listRulesPagesAreWhole,
  listWorkOrdersPagesAreWhole,
  thePagingKeysComeBeforeTheRows,
} from "./list-page-budget.spec";

/** `F4.291` live check — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F4.291 — a capped copilot list reaches the model whole", () => {
  it("a full live-length alarm page is whole JSON within the bound", aFullAlarmPageIsWholeJson);
  it("a fitted alarm page carries truncated and a cursor", aFittedAlarmPageCarriesTruncatedAndACursor);
  it("following the alarm cursors skips and repeats nothing", followingAlarmCursorsSkipsAndRepeatsNothing);
  it("truncated and nextCursor come before the rows", thePagingKeysComeBeforeTheRows);
  it("an unpaged list puts truncated before its rows", anUnpagedListPutsTruncatedFirst);
  it("a list within the budget is not shortened", aListWithinTheBudgetIsUnchanged);
  it("list_assets pages are whole and complete", listAssetsPagesAreWhole);
  it("list_rules pages are whole and complete", listRulesPagesAreWhole);
  it("list_locations pages are whole and complete", listLocationsPagesAreWhole);
  it("list_work_orders pages are whole and complete", listWorkOrdersPagesAreWhole);
  it("list_maintenance_schedules pages are whole and complete", listMaintenancePagesAreWhole);
  it("a 25-row list_dashboards page is whole", listDashboardsPageIsWhole);
  it("a 25-row list_report_schedules page is whole", listReportSchedulesPageIsWhole);
  it("a 25-row list_escalation_profiles page is whole", listEscalationProfilesPageIsWhole);
});
