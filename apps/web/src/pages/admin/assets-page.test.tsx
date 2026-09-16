// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  closeRemovesThePanelAndLeavesTheRow,
  imagesOpensThePanelForThatRow,
} from "./assets-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F3.4 assets page image panel (Q-0, Q-2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the images panel for the row whose Images action was pressed", async () => {
    await imagesOpensThePanelForThatRow();
  });

  it("closes the panel without disturbing the list", async () => {
    await closeRemovesThePanelAndLeavesTheRow();
  });
});
