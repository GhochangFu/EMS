// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedListReadSettles,
  aRefusedCloseShowsTheSentence,
  aRefusedCreateShowsTheSentence,
  aRefusedReorderShowsTheSentence,
  aRefusedStatusChangeShowsTheSentence,
  highAndMediumPillsDiffer,
  highAndMediumRailsDiffer,
  highPillIsTheRuledStrongWarning,
  mediumPillIsTheRuledSoftWarning,
  mediumRailIsTheHalfOpacityWarning,
} from "./work-orders-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * jsdom docblock is here because Vitest reads it from the file it collects
 * (ADR 0042 decision 2); importing the page module loads browser-only stores.
 */
describe("F3.65b work-order priority colours (owner ruling R-f)", () => {
  it("renders the high and medium priority pills differently", () => {
    highAndMediumPillsDiffer();
  });

  it("gives the high pill the solid warning line on the strong wash", () => {
    highPillIsTheRuledStrongWarning();
  });

  it("gives the medium pill the soft warning line on the plain wash", () => {
    mediumPillIsTheRuledSoftWarning();
  });

  it("renders the high and medium card rails differently", () => {
    highAndMediumRailsDiffer();
  });

  it("gives the medium rail the half-opacity warning border", () => {
    mediumRailIsTheHalfOpacityWarning();
  });
});

describe("F4.204 work-order refusals read as a sentence, not the response body", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("WO1 a refused create shows the server's sentence", async () => {
    await aRefusedCreateShowsTheSentence();
  });

  it("WO2 a refused status change shows the server's sentence", async () => {
    await aRefusedStatusChangeShowsTheSentence();
  });

  it("WO3 a refused close shows the server's sentence", async () => {
    await aRefusedCloseShowsTheSentence();
  });

  it("WO4 a refused kanban reorder shows the server's sentence", async () => {
    await aRefusedReorderShowsTheSentence();
  });
});

describe("F4.209 the work-orders page settles while its list has no data", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The commit bound is the fail-fast gate; the per-test timeout is the backstop.
  it("WO5 a failed list read settles without a render loop", async () => {
    await aFailedListReadSettles();
  }, 10_000);
});
