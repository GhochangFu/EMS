// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  commitFollowsAPreviewOfTheSameFile,
  everyProblemNamesItsCellAndItsReason,
  withoutALocationTheExportIsDisabledAndSaysWhy,
} from "./mapping-sheet-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F2.7 mapping-sheet panel (ADR 0056 decisions 6 and 7)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("names the Excel row, the column, the label and the message for every problem", async () => {
    await everyProblemNamesItsCellAndItsReason();
  });

  it("enables Commit only after a preview of the file that is chosen", async () => {
    await commitFollowsAPreviewOfTheSameFile();
  });

  it("disables the export until a location is chosen, and says so", () => {
    withoutALocationTheExportIsDisabledAndSaysWhy();
  });
});
