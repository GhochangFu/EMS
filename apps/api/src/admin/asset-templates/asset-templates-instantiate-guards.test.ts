import { describe, it } from "vitest";

import {
  assertAProtoKeyIsKeptAsAPlainOwnKey,
  assertARecordOfOnlyAssetCodeStoresNull,
  assertAnAbsentRecordStoresNull,
  assertAnEmptyRecordStoresNull,
  assertAnOrdinaryVariableIsStored,
  assertTheReservedAssetCodeIsNeverStored,
  assertTheStoredRecordIsACopy,
} from "./asset-templates-instantiate-guards.spec";

/**
 * `F2.29` — Vitest entry point for `storedSourceDataKeyVars`. Assertions live
 * in the sibling `.spec` (§4.6 / ADR 0014). One claim per `it`: `expect` throws.
 */
describe("F2.29 — storedSourceDataKeyVars", () => {
  it("stores an ordinary variable", () => {
    assertAnOrdinaryVariableIsStored();
  });

  it("never stores the reserved asset_code", () => {
    assertTheReservedAssetCodeIsNeverStored();
  });

  it("stores null for an absent record", () => {
    assertAnAbsentRecordStoresNull();
  });

  it("stores null for an empty record", () => {
    assertAnEmptyRecordStoresNull();
  });

  it("stores null for a record holding only asset_code", () => {
    assertARecordOfOnlyAssetCodeStoresNull();
  });

  it("keeps a __proto__ key as a plain own key", () => {
    assertAProtoKeyIsKeptAsAPlainOwnKey();
  });

  it("stores a copy of the request's record", () => {
    assertTheStoredRecordIsACopy();
  });
});
