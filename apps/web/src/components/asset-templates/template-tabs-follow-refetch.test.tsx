// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  alarmsFollowsARefetchWhileClean,
  alarmsKeepsAnEditOnARefetch,
  alarmsReportsCleanAfterARefetch,
  alarmsStaysDirtyAfterARefetch,
  calculationsFollowsARefetchWhileClean,
  calculationsKeepsAnEditOnARefetch,
  calculationsReportsCleanAfterARefetch,
  calculationsStaysDirtyAfterARefetch,
  dashboardsFollowsARefetchWhileClean,
  dashboardsKeepsAnEditOnARefetch,
  dashboardsReportsCleanAfterARefetch,
  dashboardsStaysDirtyAfterARefetch,
  detailsFollowsARefetchWhileClean,
  detailsFollowsAnUntouchedFieldBesideAnEdit,
  detailsKeepsAnEditOnARefetch,
  detailsKeepsTheEditedFieldBesideAFollowedOne,
  detailsReportsCleanAfterARefetch,
  detailsStaysDirtyAfterARefetch,
  maintenanceFollowsARefetchWhileClean,
  maintenanceKeepsAnEditOnARefetch,
  maintenanceReportsCleanAfterARefetch,
  maintenanceStaysDirtyAfterARefetch,
  pointsFollowsARefetchWhileClean,
  pointsKeepsAnEditOnARefetch,
  pointsReportsCleanAfterARefetch,
  pointsStaysDirtyAfterARefetch,
} from "./template-tabs-follow-refetch.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.85 asset-template tabs — a refetch under the same id and status (post-merge finding F3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Details: a clean tab shows the refetched name", async () => {
    await detailsFollowsARefetchWhileClean();
  });

  it("Details: a clean tab reports clean after the refetch", async () => {
    await detailsReportsCleanAfterARefetch();
  });

  it("Details: an edited tab keeps the typed name", async () => {
    await detailsKeepsAnEditOnARefetch();
  });

  it("Details: an edited tab stays dirty after the refetch", async () => {
    await detailsStaysDirtyAfterARefetch();
  });

  it("Details: an untouched field follows the refetch while another field is edited", async () => {
    await detailsFollowsAnUntouchedFieldBesideAnEdit();
  });

  it("Details: the edited field keeps its text while an untouched one follows", async () => {
    await detailsKeepsTheEditedFieldBesideAFollowedOne();
  });

  it("Points: a clean tab shows the refetched point", async () => {
    await pointsFollowsARefetchWhileClean();
  });

  it("Points: a clean tab reports clean after the refetch", async () => {
    await pointsReportsCleanAfterARefetch();
  });

  it("Points: an edited tab keeps the edit", async () => {
    await pointsKeepsAnEditOnARefetch();
  });

  it("Points: an edited tab stays dirty after the refetch", async () => {
    await pointsStaysDirtyAfterARefetch();
  });

  it("Calculations: a clean tab shows the refetched derived point", async () => {
    await calculationsFollowsARefetchWhileClean();
  });

  it("Calculations: a clean tab reports clean after the refetch", async () => {
    await calculationsReportsCleanAfterARefetch();
  });

  it("Calculations: an edited tab keeps the formula edit", async () => {
    await calculationsKeepsAnEditOnARefetch();
  });

  it("Calculations: an edited tab stays dirty after the refetch", async () => {
    await calculationsStaysDirtyAfterARefetch();
  });

  it("Alarms: a clean tab shows the refetched alarm", async () => {
    await alarmsFollowsARefetchWhileClean();
  });

  it("Alarms: a clean tab reports clean after the refetch", async () => {
    await alarmsReportsCleanAfterARefetch();
  });

  it("Alarms: an edited tab keeps the message edit", async () => {
    await alarmsKeepsAnEditOnARefetch();
  });

  it("Alarms: an edited tab stays dirty after the refetch", async () => {
    await alarmsStaysDirtyAfterARefetch();
  });

  it("Maintenance: a clean tab shows the refetched plan", async () => {
    await maintenanceFollowsARefetchWhileClean();
  });

  it("Maintenance: a clean tab reports clean after the refetch", async () => {
    await maintenanceReportsCleanAfterARefetch();
  });

  it("Maintenance: an edited tab keeps the title edit", async () => {
    await maintenanceKeepsAnEditOnARefetch();
  });

  it("Maintenance: an edited tab stays dirty after the refetch", async () => {
    await maintenanceStaysDirtyAfterARefetch();
  });

  it("Dashboards: a clean tab shows the refetched view", async () => {
    await dashboardsFollowsARefetchWhileClean();
  });

  it("Dashboards: a clean tab reports clean after the refetch", async () => {
    await dashboardsReportsCleanAfterARefetch();
  });

  it("Dashboards: an edited tab keeps the added view", async () => {
    await dashboardsKeepsAnEditOnARefetch();
  });

  it("Dashboards: an edited tab stays dirty after the refetch", async () => {
    await dashboardsStaysDirtyAfterARefetch();
  });
});
