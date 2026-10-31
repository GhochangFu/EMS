// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aCustomPairIsReadInTheSiteZone,
  aPresetSetsTheRangeInTheUrl,
  aTooLongCustomPairIsRefusedWithTheContractSentence,
  theFunctionSelectOffersAllFour,
} from "./range-picker.spec";

/** Vitest entry point (ADR 0014). `TZ` is pinned to a zone no fixture uses. */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
});

describe("F4.297 range picker", () => {
  it("a preset sets range=<key> in the URL form", async () => {
    await aPresetSetsTheRangeInTheUrl();
  });

  it("reads the custom pair as wall time in the site zone", async () => {
    await aCustomPairIsReadInTheSiteZone();
  });

  it("refuses a custom pair over the span limit with the contract's sentence", async () => {
    await aTooLongCustomPairIsRefusedWithTheContractSentence();
  });

  it("offers all four bucket functions", () => {
    theFunctionSelectOffersAllFour();
  });
});
