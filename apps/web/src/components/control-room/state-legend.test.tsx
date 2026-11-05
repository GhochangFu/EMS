// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aSharedLabelIsToldApartByItsTone,
  drawsNoSwitchingGroupWhenThereAreNone,
  eachGlyphDrawsInItsTonesLook,
  eachEntryDrawsTheMimicSwitchGlyph,
  keepsTheStateLegendGroupUnchangedBesideThem,
  listsEachSwitchingStateOnceInToneThenLabelOrder,
  omitsAnInactiveSeverity,
  rendersALabelAsPlainText,
  rendersInRankOrderWithNormalFirstAndOfflineLast,
  rendersNoStandbyPill,
} from "./state-legend.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 state legend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Normal first, the severities by rank, then Offline last", async () => {
    await rendersInRankOrderWithNormalFirstAndOfflineLast();
  });

  it("renders no Standby pill", async () => {
    await rendersNoStandbyPill();
  });

  it("omits an inactive severity, beside an active one", async () => {
    await omitsAnInactiveSeverity();
  });

  it("F4.309 lists each switching state once, in tone then label order", async () => {
    await listsEachSwitchingStateOnceInToneThenLabelOrder();
  });

  it("F4.309 draws the mimic's switch glyph beside each switching state", async () => {
    await eachEntryDrawsTheMimicSwitchGlyph();
  });

  it("F4.309 renders a switching-state label as plain text", async () => {
    await rendersALabelAsPlainText();
  });

  it("F4.309 keeps the State legend group unchanged beside the switching states", async () => {
    await keepsTheStateLegendGroupUnchangedBesideThem();
  });

  it("F4.309 tells a shared label apart by its tone (review M2)", async () => {
    await aSharedLabelIsToldApartByItsTone();
  });

  it("F4.309 draws each glyph in its tone's look (review L5)", async () => {
    await eachGlyphDrawsInItsTonesLook();
  });

  it("F4.309 draws no switching group when there are no switching states", async () => {
    await drawsNoSwitchingGroupWhenThereAreNone();
  });
});
