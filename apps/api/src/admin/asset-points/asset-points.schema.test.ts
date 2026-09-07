import { describe, it } from "vitest";

import {
  assertAnEmptyPatchAndAnEmptyIdListAreRefused,
  assertAnUnknownKeyIsRefusedOnBothObjects,
  assertTheIdListIsCappedAtTheSharedMaximum,
  assertTheThreeSpellingsOfEachPatchFieldParse,
  assertTheWithinRowRulesReportUnderPatch,
} from "./asset-points.schema.spec";

/** `F2.7` Unit I — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the asset-point bulk-update body", () => {
  it("refuses an empty patch, an empty id list and an id that is not a uuid", () => {
    assertAnEmptyPatchAndAnEmptyIdListAreRefused();
  });

  it("accepts exactly MAX_ASSET_POINT_BULK_IDS ids and refuses one more", () => {
    assertTheIdListIsCappedAtTheSharedMaximum();
  });

  it("reports a zero multiplier, an empty band and an unknown policy under patch", () => {
    assertTheWithinRowRulesReportUnderPatch();
  });

  it("refuses an unknown key on the body and on the patch", () => {
    assertAnUnknownKeyIsRefusedOnBothObjects();
  });

  it("accepts a value, an explicit null and an absent field on every patch field", () => {
    assertTheThreeSpellingsOfEachPatchFieldParse();
  });
});
