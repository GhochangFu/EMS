// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aMimicHidesTheBoundPointsField,
  aMimicHidesTheDecimalsField,
  aMimicHidesTheUnitField,
  aMimicShowsThePresetSelectOnItsPreset,
  aValueTileHasNoPresetField,
  aValueTileShowsTheBoundPointsField,
  aValueTileShowsTheDecimalsField,
  aValueTileShowsTheUnitField,
  choosingAPresetWritesItToTheConfig,
  stubFetch,
  thePresetOptionReadsThePresetLabel,
  thePresetProblemRendersUnderThePreset,
} from "./widget-inspector.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32 widget inspector — the plant mimic", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a value tile shows the Unit field (the control for the next case)", () => {
    aValueTileShowsTheUnitField();
  });

  it("a mimic hides the Unit field", () => {
    aMimicHidesTheUnitField();
  });

  it("a value tile shows the Decimals field (the control for the next case)", () => {
    aValueTileShowsTheDecimalsField();
  });

  it("a mimic hides the Decimals field", () => {
    aMimicHidesTheDecimalsField();
  });

  it("a value tile shows the Bound points field (the control for the next case)", () => {
    aValueTileShowsTheBoundPointsField();
  });

  it("a mimic hides the Bound points field and its point picker", () => {
    aMimicHidesTheBoundPointsField();
  });

  it("a value tile has no Preset field", () => {
    aValueTileHasNoPresetField();
  });

  it("a mimic shows a Preset select on its own preset", () => {
    aMimicShowsThePresetSelectOnItsPreset();
  });

  it("the preset option reads the preset's label", () => {
    thePresetOptionReadsThePresetLabel();
  });

  it("choosing a preset writes it to the row's config", async () => {
    await choosingAPresetWritesItToTheConfig();
  });

  it("a preset problem renders under the Preset field", () => {
    thePresetProblemRendersUnderThePreset();
  });
});
