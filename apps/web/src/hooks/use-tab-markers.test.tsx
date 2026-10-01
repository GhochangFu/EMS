// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aKeyReadsTheSiteWidgetsOfThatTab,
  aNullKeyMakesNoRequest,
  theFirstStoredTabIsBySortOrder,
  theMapHoldsTheGroupTabsOnly,
} from "./use-tab-markers.spec";

/**
 * `F3.77` — Vitest entry point for `useTabMarkers`; assertions live in the sibling `.spec`
 * (ADR 0014), one claim per `it()`.
 */
describe("F3.77 useTabMarkers", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a null key makes no request", async () => {
    await aNullKeyMakesNoRequest();
  });

  it("a key reads the site widgets of that tab", async () => {
    await aKeyReadsTheSiteWidgetsOfThatTab();
  });

  it("the map holds the group tabs only", async () => {
    await theMapHoldsTheGroupTabsOnly();
  });

  it("the first stored tab is by sortOrder", () => {
    theFirstStoredTabIsBySortOrder();
  });
});
