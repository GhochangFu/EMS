// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  offersOnlyInteriorNodesInTreeOrder,
  rendersNothingForAFlatScope,
  reportsTheChoice,
} from "./map-subtree-filter.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is
 * on THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F2.10 MapSubtreeFilter", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Z1 offers only interior nodes, in tree order, with the tree's dashes", () => {
    offersOnlyInteriorNodesInTreeOrder();
  });

  it("Z2 renders nothing when no node has a child (B13)", () => {
    rendersNothingForAFlatScope();
  });

  it("Z3 reports the chosen id, and null for All sites", async () => {
    await reportsTheChoice();
  });
});
