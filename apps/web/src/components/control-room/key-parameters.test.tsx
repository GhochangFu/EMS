// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aStaleSliceRendersOfflineAndNoNeedleMovement,
  batteryHealthBandsFallFromOkToCritical,
  powerFactorBandsAreWarningBelowPointNine,
  rendersTheFourGaugeTitles,
  upsLoadBandsRiseFromOkToCritical,
} from "./key-parameters.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 Key Parameters gauges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four gauge titles", () => {
    rendersTheFourGaugeTitles();
  });

  it("renders a stale slice as Offline with the needle at min, not the raw value", () => {
    aStaleSliceRendersOfflineAndNoNeedleMovement();
  });

  it("paints the UPS load bands ok, warning from 80, critical from 95", () => {
    upsLoadBandsRiseFromOkToCritical();
  });

  it("paints the battery health bands critical below 70, warning below 85, ok from 85", () => {
    batteryHealthBandsFallFromOkToCritical();
  });

  it("paints the power factor bands warning below 0.9, ok from 0.9", () => {
    powerFactorBandsAreWarningBelowPointNine();
  });
});
