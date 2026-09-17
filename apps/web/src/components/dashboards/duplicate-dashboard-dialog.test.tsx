// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  duplicatesAndNavigatesIntoTheNewDashboardsBuilder,
  duplicatingAnAssetGroupDashboardKeepsTheGroup,
  locationAdminGetsNoAssetGroupOption,
  locationAdminGetsNoOrganizationWideOption,
  prefillsNameAndSlugSkippingATakenCandidate,
  showsTheBindingsCarryOverWarning,
  theGroupListIsTheSourcesOrganizationOnly,
  widgetCopyFailureRendersInlineWithoutDeletingTheHalfMadeCopy,
} from "./duplicate-dashboard-dialog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects (ADR
 * 0042 decision 2).
 */
describe("F3.1d Unit 9 — DuplicateDashboardDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("states in visible text that a copy carries the source's bindings", async () => {
    await showsTheBindingsCarryOverWarning();
  });

  it("gives a location_admin no organization-wide option", async () => {
    await locationAdminGetsNoOrganizationWideOption();
  });

  it("gives a location_admin no asset-group option (F3.34)", async () => {
    await locationAdminGetsNoAssetGroupOption();
  });

  it("duplicating an asset-group dashboard keeps the group (F3.34)", async () => {
    await duplicatingAnAssetGroupDashboardKeepsTheGroup();
  });

  it("the group list is the source's organization only (F3.34)", async () => {
    await theGroupListIsTheSourcesOrganizationOnly();
  });

  it("prefills name and slug from the source, skipping an already-taken candidate", async () => {
    await prefillsNameAndSlugSkippingATakenCandidate();
  });

  it("creates, replaces widgets with every source id dropped, and navigates into the new builder", async () => {
    await duplicatesAndNavigatesIntoTheNewDashboardsBuilder();
  });

  it("on a widget-copy failure renders the error inline and never deletes the half-made copy", async () => {
    await widgetCopyFailureRendersInlineWithoutDeletingTheHalfMadeCopy();
  });
});
