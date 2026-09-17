// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFailedCatalogFetchRendersTheError,
  aLocationAdminReadsTheCanvasAndGetsNoImport,
  anUnknownCodeRendersTheNotFoundPanel,
  everyWidgetRendersDisabledWithNoWritableControl,
  importIsDisabledUntilAnOrganizationIsChosen,
  importLandsOnTheNewDraft,
  theHeaderNamesTheEntry,
  theZeroBindingEntryRenders,
  theZeroWidgetEntryRendersTheEmptyState,
} from "./dashboard-template-stock-view-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F3.44 the read-only viewer for a stock dashboard-template entry", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders every widget disabled, with no writable control", async () => {
    await everyWidgetRendersDisabledWithNoWritableControl();
  });

  it("names the entry in the header", async () => {
    await theHeaderNamesTheEntry();
  });

  it("renders the zero-binding entry", async () => {
    await theZeroBindingEntryRenders();
  });

  it("renders the empty state for a zero-widget entry", async () => {
    await theZeroWidgetEntryRendersTheEmptyState();
  });

  it("imports the resolved entry code and lands on the new draft", async () => {
    await importLandsOnTheNewDraft();
  });

  it("keeps Import disabled until an organization is chosen", async () => {
    await importIsDisabledUntilAnOrganizationIsChosen();
  });

  it("renders the not-found panel for a code the catalog does not carry", async () => {
    await anUnknownCodeRendersTheNotFoundPanel();
  });

  it("lets a location_admin read the canvas with no Import control", async () => {
    await aLocationAdminReadsTheCanvasAndGetsNoImport();
  });

  it("renders the error when the catalog fetch fails", async () => {
    await aFailedCatalogFetchRendersTheError();
  });
});
