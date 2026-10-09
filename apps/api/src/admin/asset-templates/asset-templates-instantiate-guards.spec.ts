import { expect } from "vitest";

import { storedSourceDataKeyVars } from "./asset-templates-instantiate-guards";

/**
 * `F2.29` (ADR 0039 Amendment 1 decision 2) — what the instantiate insert
 * stores in `bms.assets.source_data_key_vars` for a request's
 * `sourceDataKeyVars`. Pure; no database. Assertions live here;
 * `asset-templates-instantiate-guards.test.ts` is the Vitest entry point
 * (§4.6 / ADR 0014).
 */

export function assertAnOrdinaryVariableIsStored(): void {
  expect(storedSourceDataKeyVars({ unit: "01", panel: "P2" })).toEqual({ unit: "01", panel: "P2" });
}

export function assertTheReservedAssetCodeIsNeverStored(): void {
  expect(storedSourceDataKeyVars({ unit: "01", asset_code: "X" })).toEqual({ unit: "01" });
}

export function assertAnAbsentRecordStoresNull(): void {
  expect(storedSourceDataKeyVars(undefined)).toBeNull();
}

export function assertAnEmptyRecordStoresNull(): void {
  expect(storedSourceDataKeyVars({})).toBeNull();
}

export function assertARecordOfOnlyAssetCodeStoresNull(): void {
  expect(storedSourceDataKeyVars({ asset_code: "X" })).toBeNull();
}

/**
 * A `__proto__` key parsed from JSON is an own property. Copied by assignment
 * it would hit the prototype setter and vanish; copied as an entry it stays a
 * plain own key, and the stored object has no prototype it could have changed.
 */
export function assertAProtoKeyIsKeptAsAPlainOwnKey(): void {
  const parsed = JSON.parse('{"__proto__":"P","unit":"01"}') as Record<string, string>;
  const stored = storedSourceDataKeyVars(parsed);
  expect(stored).not.toBeNull();
  expect(Object.keys(stored!)).toEqual(["__proto__", "unit"]);
  expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
}

/** The stored record is a copy: a later mutation of the request does not reach it. */
export function assertTheStoredRecordIsACopy(): void {
  const request: Record<string, string> = { unit: "01" };
  const stored = storedSourceDataKeyVars(request);
  request.unit = "99";
  expect(stored).toEqual({ unit: "01" });
}
