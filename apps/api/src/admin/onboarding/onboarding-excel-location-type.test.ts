import { describe, it } from "vitest";

import {
  assertEmptyCoordinateCellsTakeTheMumbaiDefault,
  assertEmptyLocationTypeIsRefused,
  assertLocationTypeCellIsCaseFolded,
  assertUnknownLocationTypeIsRefusedWithoutEcho,
} from "./onboarding-excel-location-type.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingExcelService.parseUpload — the location type cell (F4.157)", () => {
  it("refuses an empty type cell, naming the row and the codes", () => {
    assertEmptyLocationTypeIsRefused();
  });

  it("refuses an unknown type cell by its length, without echoing it", () => {
    assertUnknownLocationTypeIsRefusedWithoutEcho();
  });

  it("folds the case of a type cell before comparing it", () => {
    assertLocationTypeCellIsCaseFolded();
  });

  it("E4 gives empty coordinate cells the Mumbai default (F3.79)", () => {
    assertEmptyCoordinateCellsTakeTheMumbaiDefault();
  });
});
