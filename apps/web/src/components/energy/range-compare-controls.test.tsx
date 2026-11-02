// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aTypedStartIsReadInTheViewsZone,
  choosingAPresetDropsTheInstants,
  choosingAPresetKeepsTheCompareToggle,
  customSeedsTheLast24HoursInTheViewsZone,
  offersTheSevenRangesInOrder,
  rendersNoPickerForAPreset,
  thePickersWaitWhileTheZoneIsNull,
  togglingCompareSetsAndClearsPrevious,
} from "./range-compare-controls.spec";

/**
 * `F4.302` U3 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). The browser zone is pinned to `America/St_Johns`, which no
 * fixture uses (ADR 0108 Status ruling c).
 */
describe("F4.302 — the range and compare controls", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "America/St_Johns");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers the seven ranges in order", () => {
    offersTheSevenRangesInOrder();
  });

  it("renders no picker for a preset range", () => {
    rendersNoPickerForAPreset();
  });

  it("custom seeds the last 24 hours in the view's zone", async () => {
    await customSeedsTheLast24HoursInTheViewsZone();
  });

  it("a typed custom start is read in the view's zone", () => {
    aTypedStartIsReadInTheViewsZone();
  });

  it("the pickers wait while the zone is null", () => {
    thePickersWaitWhileTheZoneIsNull();
  });

  it("choosing a preset drops the custom instants", async () => {
    await choosingAPresetDropsTheInstants();
  });

  it("choosing a preset keeps the compare toggle", async () => {
    await choosingAPresetKeepsTheCompareToggle();
  });

  it("toggling compare sets and clears previous", async () => {
    await togglingCompareSetsAndClearsPrevious();
  });
});
