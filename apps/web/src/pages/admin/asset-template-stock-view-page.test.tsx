// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRoleThatCannotAuthorSeesTheRefusal,
  anUnknownCodeRendersTheNotFoundPanel,
  bothFormulaEditorsRenderReadOnly,
  everyAlarmRendersDisabledWithNoSavePath,
  everyMaintenancePlanRendersDisabledWithNoSavePath,
  everyPointRendersAndNoFieldAcceptsInput,
  importIsDisabledUntilAnOrganizationIsChosen,
  importLandsOnTheNewDraft,
} from "./asset-template-stock-view-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F2.14 the read-only viewer for a stock catalog entry", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders every declared point with no field that accepts input", async () => {
    await everyPointRendersAndNoFieldAcceptsInput();
  });

  it("renders every stored alarm disabled, with no save path", async () => {
    await everyAlarmRendersDisabledWithNoSavePath();
  });

  it("renders every stored maintenance plan disabled, with no save path (F2.19)", async () => {
    await everyMaintenancePlanRendersDisabledWithNoSavePath();
  });

  it("renders both the formula and the KPI expression editor read-only", async () => {
    await bothFormulaEditorsRenderReadOnly();
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

  it("refuses the viewer to a role that cannot author templates", async () => {
    await aRoleThatCannotAuthorSeesTheRefusal();
  });
});
