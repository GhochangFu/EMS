// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCycleBlocksTheSaveUnderBothRows,
  aFrozenVersionDisablesEveryControl,
  aMixedDialectPairSkipsTheCycleMirror,
  choosingV2FlipsAStreamingRowToScheduled,
  choosingV3TeachesTheParameterFormAndItsLatency,
  eachRowRendersItsDialectsControls,
  savingCarriesTheRatioAndPreservesTheDialect,
} from "./calculations-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.22 calculations tab — Grammar, Minimum coverage and the v2 trigger rule (ADR 0055)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders each derived row's controls by its stored dialect", async () => {
    await eachRowRendersItsDialectsControls();
  });

  it("teaches the $key form and the v3 latency hint when bms-calc-v3 is chosen (ADR 0070)", async () => {
    await choosingV3TeachesTheParameterFormAndItsLatency();
  });

  it("flips a streaming v1 row to scheduled when bms-calc-v2 is chosen, and asks for an interval", async () => {
    await choosingV2FlipsAStreamingRowToScheduled();
  });

  it("saves the ratio, preserves the edited row's dialect, and leaves the untouched row alone", async () => {
    await savingCarriesTheRatioAndPreservesTheDialect();
  });

  it("disables every control on a frozen version and offers no Save", async () => {
    await aFrozenVersionDisablesEveryControl();
  });

  it("renders the cycle sentence under both rows of a within-template cycle and blocks the save", async () => {
    await aCycleBlocksTheSaveUnderBothRows();
  });

  it("skips the cycle mirror on a mixed-dialect pair, but still blocks the save on the sibling-reference sentence", async () => {
    await aMixedDialectPairSkipsTheCycleMirror();
  });
});
