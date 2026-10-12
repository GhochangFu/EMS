import { afterEach, describe, it, vi } from "vitest";

import { theViewCardReadsTheStoredSetting } from "./copilot-current.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 3d — an edit card's Now values", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a site's stored Control Room view for the view card", () => theViewCardReadsTheStoredSetting());
});
