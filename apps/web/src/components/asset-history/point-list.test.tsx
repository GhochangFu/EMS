// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aSecondPointOnAnExistingUnitIsAdded,
  aThirdUnitIsRefusedInline,
  theLatestCellDropsOnlyAFloatsBinaryTail,
  theLatestCellShowsADashForASampleWithNoValue,
} from "./point-list.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.297 point list", () => {
  it("refuses a point whose unit would need a third axis, inline", async () => {
    await aThirdUnitIsRefusedInline();
  });

  it("adds a point whose unit already has an axis", async () => {
    await aSecondPointOnAnExistingUnitIsAdded();
  });

  it("drops only a float's binary tail in the Latest cell", async () => {
    await theLatestCellDropsOnlyAFloatsBinaryTail();
  });

  it("shows a dash in the Latest cell for a sample with no value", async () => {
    await theLatestCellShowsADashForASampleWithNoValue();
  });
});
