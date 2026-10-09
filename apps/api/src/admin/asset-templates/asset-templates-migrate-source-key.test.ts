import { describe, it } from "vitest";

import {
  assertAMissingTokenIsUnresolvedBesideAStoredOne,
  assertANullPatternIsUnresolved,
  assertANullPatternMessageSaysNoneSet,
  assertAStoredAssetCodeCannotOverrideTheCode,
  assertAStoredVariableResolvesThePattern,
  assertAssetCodeStillResolvesWithNoStoredVariables,
  assertNoStoredVariablesLeavesTheTokenUnresolved,
  assertTheMessageNamesTokensNotValues,
  assertTheNullVariablesMessageKeepsRebuildAsTheRemedy,
  assertTheNullVariablesMessageNamesTheAssetPointAndToken,
  assertTheNullVariablesMessageSaysWhyTheAssetStoresNone,
  assertThePartialVariablesMessageDoesNotClaimTheAssetStoresNone,
  assertThePartialVariablesMessageKeepsRebuildAsTheRemedy,
  assertThePartialVariablesMessageNamesTheMissingToken,
} from "./asset-templates-migrate-source-key.spec";

/**
 * `F2.29` — Vitest entry point for the migrate source-key resolver. Assertions
 * live in the sibling `.spec` (§4.6 / ADR 0014). One claim per `it`.
 */
describe("F2.29 — resolveAdditionSourceDataKey", () => {
  it("resolves a pattern from a stored variable", () => {
    assertAStoredVariableResolvesThePattern();
  });

  it("resolves {asset_code} for an asset with no stored variables", () => {
    assertAssetCodeStillResolvesWithNoStoredVariables();
  });

  it("sets asset_code last, so a stored one cannot override the code", () => {
    assertAStoredAssetCodeCannotOverrideTheCode();
  });

  it("leaves a token unresolved when the asset stores no variables", () => {
    assertNoStoredVariablesLeavesTheTokenUnresolved();
  });

  it("names the one missing token beside a stored one", () => {
    assertAMissingTokenIsUnresolvedBesideAStoredOne();
  });

  it("treats a null pattern as unresolved", () => {
    assertANullPatternIsUnresolved();
  });
});

describe("F2.29 — unresolvableAdditionMessage", () => {
  it("says why an asset with NULL variables stores none", () => {
    assertTheNullVariablesMessageSaysWhyTheAssetStoresNone();
  });

  it("names the asset, the point, the pattern and the token", () => {
    assertTheNullVariablesMessageNamesTheAssetPointAndToken();
  });

  it("keeps Rebuild as the remedy for an asset with NULL variables", () => {
    assertTheNullVariablesMessageKeepsRebuildAsTheRemedy();
  });

  it("names the stored tokens and the missing one for an asset with some variables", () => {
    assertThePartialVariablesMessageNamesTheMissingToken();
  });

  it("does not say an asset with some variables stores none", () => {
    assertThePartialVariablesMessageDoesNotClaimTheAssetStoresNone();
  });

  it("keeps Rebuild as the remedy for an asset with some variables", () => {
    assertThePartialVariablesMessageKeepsRebuildAsTheRemedy();
  });

  it("says (none set) for a point with no pattern", () => {
    assertANullPatternMessageSaysNoneSet();
  });

  it("names tokens, never stored values", () => {
    assertTheMessageNamesTokensNotValues();
  });
});
