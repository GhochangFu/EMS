// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addAndRemoveAPlan,
  draftEditsAPlanAndSaveSendsTheMergedContent,
  readOnlyRendersEveryPlanWithNoSavePath,
} from "./maintenance-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F2.19 maintenance tab — ADR 0038 Amendment 5 Part B", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders every plan read-only, with no save path and no <details>", async () => {
    await readOnlyRendersEveryPlanWithNoSavePath();
  });

  it("edits a plan on a draft and sends the merged content", async () => {
    await draftEditsAPlanAndSaveSendsTheMergedContent();
  });

  it("adds a plan and removes it again, returning the tab to clean", async () => {
    await addAndRemoveAPlan();
  });
});
