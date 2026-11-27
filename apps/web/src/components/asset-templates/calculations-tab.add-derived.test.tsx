// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFrozenVersionOffersNoAdd,
  addsANewDerivedPointAndSavesIt,
  anAddedPointCanBeRemoved,
  anIncompleteNewPointBlocksTheSave,
  theEmptyStateOffersTheControl,
} from "./calculations-tab.add-derived.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.389 calculations tab — add a new derived point", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("adds a derived point with a formula and a trigger, and the save carries it", async () => {
    await addsANewDerivedPointAndSavesIt();
  });

  it("blocks the save while the added point has no key, formula or trigger", async () => {
    await anIncompleteNewPointBlocksTheSave();
  });

  it("offers no add control on a frozen version", async () => {
    await aFrozenVersionOffersNoAdd();
  });

  it("names the add control in the empty state of a draft", async () => {
    await theEmptyStateOffersTheControl();
  });

  it("removes an added point before it is saved, and the tab is clean again", async () => {
    await anAddedPointCanBeRemoved();
  });
});
