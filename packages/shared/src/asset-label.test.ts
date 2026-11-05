import { describe, it } from "vitest";

import {
  bareCodeWhenNeitherIsKnown,
  labelOfReadsTheDtoShape,
  locationNameIsTheFallback,
  partsWhereFallsBackToTheLocation,
  partsWhereIsNullWhenNeitherIsKnown,
  partsWhereIsTheRtuName,
  rtuNameIsAppended,
  rtuWinsOverLocation,
  separatorIsMiddleDot,
} from "./asset-label.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.316 — assetLabel (ADR 0111)", () => {
  it("separates with exactly ' · ' (U+00B7)", () => {
    separatorIsMiddleDot();
  });

  it("appends the RTU display name to the code", () => {
    rtuNameIsAppended();
  });

  it("falls back to the location name when there is no RTU", () => {
    locationNameIsTheFallback();
  });

  it("is the bare code, with no separator, when neither is known", () => {
    bareCodeWhenNeitherIsKnown();
  });

  it("prefers the RTU over the location when both are set", () => {
    rtuWinsOverLocation();
  });

  it("assetLabelOf equals assetLabel for the same parts", () => {
    labelOfReadsTheDtoShape();
  });

  it("assetLabelParts answers the RTU name as where", () => {
    partsWhereIsTheRtuName();
  });

  it("assetLabelParts falls back to the location name as where", () => {
    partsWhereFallsBackToTheLocation();
  });

  it("assetLabelParts answers null as where when neither is known", () => {
    partsWhereIsNullWhenNeitherIsKnown();
  });
});
