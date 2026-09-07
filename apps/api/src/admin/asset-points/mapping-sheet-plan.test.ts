import { describe, it } from "vitest";

import {
  assertActiveAndMetadataDiffs,
  assertAForeignStoredRtuIsRefusedNotSilentlyUnwired,
  assertAPreFillRowOnARetiredGatewayImportsAsACreate,
  assertARetiredRtuIsAcceptedOnlyWhereTheRowAlreadyPointsAtIt,
  assertAssetNameIsInformationalAndCountsAddUp,
  assertUnmatchedTextIsEchoedBounded,
  assertBlankActiveOnANewRowIsUntouched,
  assertBlankRtuCodeFollowsTheSourceKindRule,
  assertChangedSourceKeyIsOneUpdate,
  assertExportedRowsPlanAsIdentity,
  assertMergedPairIsRefusedNamingTheInheritedSide,
  assertResolutionErrors,
  assertSourceKeyDuplicates,
  assertTrueOnAPreFillRowCreates,
} from "./mapping-sheet-plan.spec";

/** `F2.7` G4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — planMappingSheet, steps 5-15 against a location snapshot (ADR 0056 decision 7)", () => {
  it("plans a location's own export as the identity: no creates, no updates, no errors", () => {
    assertExportedRowsPlanAsIdentity();
  });

  it("reports a changed source key as one field-level update", () => {
    assertChangedSourceKeyIsOneUpdate();
  });

  it("keeps a manual row manual and turns a measured row unmapped on a blank rtu_code", () => {
    assertBlankRtuCodeFollowsTheSourceKindRule();
  });

  it("diffs active, the five and unit field by field; a blank unit on an update clears it", () => {
    assertActiveAndMetadataDiffs();
  });

  it("creates a pre-fill row on TRUE, with template.unit ?? catalog.unit for a blank unit", () => {
    assertTrueOnAPreFillRowCreates();
  });

  it("counts a blank active on a new row as an untouched suggestion and stops there", () => {
    assertBlankActiveOnANewRowIsUntouched();
  });

  it("resolves the asset, the key kind, the catalog and the RTU in order, one code per row", () => {
    assertResolutionErrors();
  });

  it("refuses a merged band the template inverts, naming the inherited side and its value", () => {
    assertMergedPairIsRefusedNamingTheInheritedSide();
  });

  it("refuses a source key used twice on one asset, in the sheet or by an existing row the sheet leaves alone", () => {
    assertSourceKeyDuplicates();
  });

  it("treats asset_name as informational and lands every row in exactly one bucket", () => {
    assertAssetNameIsInformationalAndCountsAddUp();
  });

  it("accepts a retired RTU's code only where the existing row already points at it (correction 39)", () => {
    assertARetiredRtuIsAcceptedOnlyWhereTheRowAlreadyPointsAtIt();
  });

  it("imports the pre-fill row of an asset on a retired gateway as one unmapped create, not an error", () => {
    assertAPreFillRowOnARetiredGatewayImportsAsACreate();
  });

  it("refuses a row wired to an RTU outside the location rather than reading it as blank and unwiring it", () => {
    assertAForeignStoredRtuIsRefusedNotSilentlyUnwired();
  });

  it("echoes unmatched sheet text bounded in asset_not_found, point_key_unknown and rtu_not_found (security H1)", () => {
    assertUnmatchedTextIsEchoedBounded();
  });
});
