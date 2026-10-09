// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFailedReadEnablesConfirmWithTheErrorLine,
  aTopLevelMoveReadsNothingAndConfirmIsEnabled,
  confirmWaitsForTheScheduleRead,
  escapeCallsOnClose,
  listsOnlyTheSchedulesOnTheNewAncestors,
  noMatchingScheduleShowsTheEmptySentence,
  theBodyNamesBothChains,
  theTitleNamesTheNewParent,
  theTitleSaysTopLevelForNoParent,
} from "./location-move-dialog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is
 * on THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F2.10 LocationMoveDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("M1 the title names the new parent", async () => {
    await theTitleNamesTheNewParent();
  });

  it("M2 the title says 'top level' for no parent", async () => {
    await theTitleSaysTopLevelForNoParent();
  });

  it("M3 the body names the old chain and the new chain", async () => {
    await theBodyNamesBothChains();
  });

  it("M4 lists only this organization's schedules on the new parent or its ancestors", async () => {
    await listsOnlyTheSchedulesOnTheNewAncestors();
  });

  it("M5 no matching schedule shows the empty sentence", async () => {
    await noMatchingScheduleShowsTheEmptySentence();
  });

  it("M6 Confirm is disabled while the schedules load, enabled once they resolve", async () => {
    await confirmWaitsForTheScheduleRead();
  });

  it("M7 a failed read enables Confirm and shows the error line", async () => {
    await aFailedReadEnablesConfirmWithTheErrorLine();
  });

  it("M7b a move to the top level reads no schedule and Confirm is enabled at once (O4)", async () => {
    await aTopLevelMoveReadsNothingAndConfirmIsEnabled();
  });

  it("M8 Escape calls onClose and not onConfirm", async () => {
    await escapeCallsOnClose();
  });
});
