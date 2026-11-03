// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillWritesTheAreaAndNullClearsIt,
  anEditOpensWithTheStoredArea,
  anEmptyAreaSubmitsNull,
  aTypedFt2AreaIsSentAsTyped,
  anUntouchedAreaReadsUnchangedOnReview,
  noHintShowsForSquareMetres,
  thePlaceStepHasTheAreaFields,
  theAreaCellFormatsByLocale,
  theFt2HintShowsTheSquareMetres,
  theListHasTheAreaColumnAfterTimezone,
} from "./locations-page.floor-area.spec";

/** userEvent types every key; a wizard walk takes seconds under jsdom. */
const SLOW = 20_000;

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.304 U6 — the Place step's floor area and the list's Area (m²) column", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("W1 the Place step has Floor area and Area unit (m2)", () => thePlaceStepHasTheAreaFields(), SLOW);
  it("W2 an empty area submits floorArea null", () => anEmptyAreaSubmitsNull(), SLOW);
  it("W3 1000 ft2 is sent as typed", () => aTypedFt2AreaIsSentAsTyped(), SLOW);
  it("W3 the ft2 hint reads = 92.90 m²", () => theFt2HintShowsTheSquareMetres(), SLOW);
  it("W4 no hint for m2", () => noHintShowsForSquareMetres(), SLOW);
  it("W5 an edit opens with the stored area and sends it back", () => anEditOpensWithTheStoredArea(), SLOW);
  it("W6 a fill writes the area and null clears it", () => aFillWritesTheAreaAndNullClearsIt(), SLOW);
  it("W7 an untouched area reads unchanged on Review", () => anUntouchedAreaReadsUnchangedOnReview(), SLOW);
  it("L1 the list has Area (m²) after Timezone", () => theListHasTheAreaColumnAfterTimezone(), SLOW);
  it("L2 the area cell formats by locale", () => theAreaCellFormatsByLocale(), SLOW);
});
