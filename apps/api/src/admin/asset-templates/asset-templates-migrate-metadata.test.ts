import { describe, it } from "vitest";

import {
  assertAComputedRowIsNotReadAsAMetadataOverride,
  assertAKeyNotMeasuredOnTheTargetIsSkipped,
  assertARowWithNoOverrideRefusesNothing,
  assertAnOverrideStillLegalOnTheTargetPasses,
  assertAnOverrideTheTargetDefaultInvertsRefuses,
  assertEachAssetIsCheckedOnItsOwn,
} from "./asset-templates-migrate-metadata.spec";

/** `F2.30` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.30 — migrate re-validates a metadata override against the target defaults", () => {
  it("refuses an override the target version's default inverts, naming asset, point and both bounds", () => {
    assertAnOverrideTheTargetDefaultInvertsRefuses();
  });

  it("passes an override still legal on the target version", () => {
    assertAnOverrideStillLegalOnTheTargetPasses();
  });

  it("refuses nothing for a row that overrides none of the five", () => {
    assertARowWithNoOverrideRefusesNothing();
  });

  it("does not read a computed row as a metadata override", () => {
    assertAComputedRowIsNotReadAsAMetadataOverride();
  });

  it("skips a key the target does not declare as measured", () => {
    assertAKeyNotMeasuredOnTheTargetIsSkipped();
  });

  it("checks each asset on its own", () => {
    assertEachAssetIsCheckedOnItsOwn();
  });
});
