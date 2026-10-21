// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { aFillForAnotherStockEntryIsNotTaken, aFillSetsTheImportsOrganization } from "./import-stock-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — the asset stock import takes a copilot fill for its organization (review C2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sets the organization from a fill for this stock entry", () => aFillSetsTheImportsOrganization());
  it("does not take a fill for another stock entry", () => aFillForAnotherStockEntryIsNotTaken());
});
