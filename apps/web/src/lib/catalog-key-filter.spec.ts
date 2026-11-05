import { expect } from "vitest";

import { type CatalogKeyFilter, sharedDomain, sharedValue, visibleCatalogKeys } from "./catalog-key-filter";

/**
 * `F4.313` follow-up (owner ruling 2026-11-05) — unit claims for the key
 * picker's list rule. Each claim is one exported function;
 * `catalog-key-filter.test.ts` is the Vitest entry point.
 */

const CATALOG = [
  { code: "kw", name: "Active power", domain: "electrical" },
  { code: "pf", name: "Power factor", domain: "electrical" },
  { code: "kvah", name: "Apparent energy", domain: "electrical" },
  { code: "flow", name: "Flow rate", domain: "water" },
  { code: "spare", name: "Spare input", domain: null },
] as const;

const DEFAULT: CatalogKeyFilter = { exclude: new Set(), domain: "electrical", showAll: false, search: "", selected: "" };

function codes(filter: Partial<CatalogKeyFilter>): string[] {
  return visibleCatalogKeys(CATALOG, { ...DEFAULT, ...filter }).map((item) => item.code);
}

// Catches: an empty selection treated as a domain (`undefined`) instead of "no filter".
export function sharedDomainOfNothingIsNull(): void {
  expect(sharedDomain([])).toBeNull();
}

// Catches: mixed domains reduced to the first one.
export function sharedDomainOfMixedDomainsIsNull(): void {
  expect(sharedDomain(["electrical", "water"])).toBeNull();
}

// Catches: a uniform selection not returning its domain.
export function sharedDomainOfOneDomainIsThatDomain(): void {
  expect(sharedDomain(["water", "water"])).toBe("water");
}

/** `F4.314` PR 2 — an asset with no organization code shares none. Catches: nulls skipped before comparing. */
export function sharedValueWithANullIsNull(): void {
  expect(sharedValue(["SPEC", null])).toBeNull();
}

// Catches: the search not trimmed or not lower-cased before matching the code.
export function theSearchMatchesTheCodeTrimmedAndCaseInsensitively(): void {
  expect(codes({ search: "  KVA " })).toEqual(["kvah"]);
}

// Catches: the search not matched against the name.
export function theSearchMatchesTheName(): void {
  expect(codes({ search: "factor" })).toEqual(["pf"]);
}

// Catches: the picked key hidden by the domain filter, leaving the select a value with no option.
export function theSelectedKeyStaysVisible(): void {
  expect(codes({ selected: "flow" })).toContain("flow");
}

// Catches: the selected-key bypass placed before the exclusion, so an excluded key comes back.
export function theExclusionBeatsTheSelectedKey(): void {
  expect(codes({ selected: "kw", exclude: new Set(["kw"]) })).not.toContain("kw");
}

// Catches: a key with no domain (as New key creates it) failing the domain filter.
export function aKeyWithNoDomainPassesTheDomainFilter(): void {
  expect(codes({})).toContain("spare");
}
