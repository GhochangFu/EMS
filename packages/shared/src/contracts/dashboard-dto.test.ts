import { describe, it } from "vitest";

import {
  runDashboardAssetScopeFieldsTests,
  runDashboardGridTests,
  runDashboardTabsFieldsTests,
  runWidgetTabIdTests,
} from "./dashboard-dto.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1d Unit 2 — DASHBOARD_GRID wired into dashboardWidgetIdentitySchema", () => {
  it("reads the single-source grid bounds rather than a private 11/12/24", () => {
    runDashboardGridTests();
  });
});

describe("F3.2 — dashboardDto/dashboardSummaryDto gain the asset scope arm (ADR 0067)", () => {
  it("rejects a dashboard or summary row missing assetId; the summary alone also carries assetCode", () => {
    runDashboardAssetScopeFieldsTests();
  });
});

describe("F3.73 — the dashboard DTO carries tabs and a template stamp", () => {
  it("requires tabs and templateId on a dashboard as read", () => {
    runDashboardTabsFieldsTests();
  });

  it("requires tabId on a widget as read, null for the legacy canvas", () => {
    runWidgetTabIdTests();
  });
});
