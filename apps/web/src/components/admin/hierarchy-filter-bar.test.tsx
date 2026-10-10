// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anInteriorNodeIsSelectableAndSyncsTheRoute,
  anOrphanIsOfferedAtDepthZero,
  optionsAreDepthFirstWithTheChildIndented,
  syncRoutesFalseLeavesThePathUnchanged,
} from "./hierarchy-filter-bar.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is
 * on THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F2.10 HierarchyFilterBar — the location tree", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("H1 lists the locations depth-first with the child labelled '— Child'", async () => {
    await optionsAreDepthFirstWithTheChildIndented();
  });

  it("H2 an interior node is selectable and syncs the route to its RTUs", async () => {
    await anInteriorNodeIsSelectableAndSyncsTheRoute();
  });

  it("H3 a node whose parent is not in the list is offered at depth 0", async () => {
    await anOrphanIsOfferedAtDepthZero();
  });

  it("H4 syncRoutes={false} reports the choice and leaves the route alone", async () => {
    await syncRoutesFalseLeavesThePathUnchanged();
  });
});
