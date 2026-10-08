import { expect } from "vitest";

import {
  resolveAdditionSourceDataKey,
  unresolvableAdditionMessage,
} from "./asset-templates-migrate-source-key";

/**
 * `F2.29` (ADR 0039 Amendment 1 decisions 4 and 5) — the migrate service's
 * source-key resolution for a measured addition, from the asset's stored
 * variables plus `{asset_code}`, and the refusal sentence for one it cannot
 * resolve. Pure; no database. Assertions live here;
 * `asset-templates-migrate-source-key.test.ts` is the Vitest entry point
 * (§4.6 / ADR 0014).
 */

export function assertAStoredVariableResolvesThePattern(): void {
  expect(resolveAdditionSourceDataKey("CH{unit}_B", "SKID-7", { unit: "07" })).toEqual({
    ok: true,
    sourceDataKey: "CH07_B",
  });
}

export function assertAssetCodeStillResolvesWithNoStoredVariables(): void {
  expect(resolveAdditionSourceDataKey("{asset_code}_B", "SKID-7", null)).toEqual({
    ok: true,
    sourceDataKey: "SKID-7_B",
  });
}

/** Reserved last, as at instantiation: a stored `asset_code` (never written, but defended) cannot override the code. */
export function assertAStoredAssetCodeCannotOverrideTheCode(): void {
  expect(resolveAdditionSourceDataKey("{asset_code}_B", "SKID-7", { asset_code: "OTHER" })).toEqual({
    ok: true,
    sourceDataKey: "SKID-7_B",
  });
}

export function assertNoStoredVariablesLeavesTheTokenUnresolved(): void {
  expect(resolveAdditionSourceDataKey("CH{unit}_B", "SKID-7", null)).toEqual({ ok: false, unresolved: ["unit"] });
}

export function assertAMissingTokenIsUnresolvedBesideAStoredOne(): void {
  expect(resolveAdditionSourceDataKey("{panel}/CH{unit}", "SKID-7", { unit: "07" })).toEqual({
    ok: false,
    unresolved: ["panel"],
  });
}

export function assertANullPatternIsUnresolved(): void {
  expect(resolveAdditionSourceDataKey(null, "SKID-7", { unit: "07" })).toEqual({ ok: false, unresolved: [] });
}

const NULL_VARS_MESSAGE = unresolvableAdditionMessage({
  assetCode: "SKID-7",
  pointKey: "PANEL_A",
  pattern: "CH{unit}_B",
  unresolved: ["unit"],
  storedVars: null,
});

export function assertTheNullVariablesMessageSaysWhyTheAssetStoresNone(): void {
  expect(NULL_VARS_MESSAGE).toContain(
    "This asset stores no variables — it was built before variables were kept, or with none",
  );
}

export function assertTheNullVariablesMessageNamesTheAssetPointAndToken(): void {
  expect(NULL_VARS_MESSAGE).toContain('Asset "SKID-7": required point "PANEL_A" has pattern "CH{unit}_B"');
  expect(NULL_VARS_MESSAGE).toContain("migration cannot resolve {unit}");
}

export function assertTheNullVariablesMessageKeepsRebuildAsTheRemedy(): void {
  expect(NULL_VARS_MESSAGE).toMatch(/Rebuild these assets from the new version instead\.$/);
}

const PARTIAL_VARS_MESSAGE = unresolvableAdditionMessage({
  assetCode: "SKID-7",
  pointKey: "PANEL_A",
  pattern: "{panel}/CH{unit}",
  unresolved: ["panel"],
  storedVars: { unit: "07", site: "S1" },
});

export function assertThePartialVariablesMessageNamesTheMissingToken(): void {
  expect(PARTIAL_VARS_MESSAGE).toContain("This asset stores {site}, {unit} but not {panel}");
}

export function assertThePartialVariablesMessageDoesNotClaimTheAssetStoresNone(): void {
  expect(PARTIAL_VARS_MESSAGE).not.toContain("stores no variables");
}

export function assertThePartialVariablesMessageKeepsRebuildAsTheRemedy(): void {
  expect(PARTIAL_VARS_MESSAGE).toMatch(/Rebuild these assets from the new version instead\.$/);
}

export function assertANullPatternMessageSaysNoneSet(): void {
  const message = unresolvableAdditionMessage({
    assetCode: "SKID-7",
    pointKey: "PANEL_A",
    pattern: null,
    unresolved: [],
    storedVars: { unit: "07" },
  });
  expect(message).toContain('has pattern (none set), and migration cannot resolve it.');
}

/** The message never quotes a stored value — only token names. */
export function assertTheMessageNamesTokensNotValues(): void {
  expect(PARTIAL_VARS_MESSAGE).not.toContain("S1");
  expect(PARTIAL_VARS_MESSAGE).not.toContain("07");
}
