import type { AccessibleScope } from "@bms/shared";

import {
  allowedSmocTabs,
  DEFAULT_SMOC_TAB,
  findSmocSite,
  isSmocSite,
  smocTabFromParam,
  smocTabPath,
  SMOC_TABS,
} from "./smoc-pages";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function scope(kind: AccessibleScope["kind"], assetGroupCodes: readonly string[] = []): AccessibleScope {
  return {
    kind,
    locations: [],
    assetGroups: assetGroupCodes.map((code, index) => ({
      id: `grp-${index}`,
      locationId: "loc-1",
      code,
      name: code,
      organizationId: "org-1",
    })),
    assetIds: [],
  };
}

const HVAC_ONLY = scope("asset_group", ["hvac"]);
const ELECTRICAL_ONLY = scope("asset_group", ["electrical"]);
const GLOBAL = scope("global");

/** `P1` — the seven tabs, in the shell's order, each with its D3 area. */
export function runP1(): void {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["overview", "overview"],
    ["sld", "electrical"],
    ["ups", "upsBattery"],
    ["battery", "upsBattery"],
    ["hvac", "hvac"],
    ["env", "environment"],
    ["it", "it"],
  ];
  assert(SMOC_TABS.length === expected.length, `expected 7 tabs, got ${SMOC_TABS.length}`);
  expected.forEach(([key, area], index) => {
    const tab = SMOC_TABS[index];
    assert(tab?.key === key, `tab ${index}: expected key ${key}, got ${tab?.key}`);
    assert(tab?.area === area, `tab ${index}: expected area ${area}, got ${tab?.area}`);
  });
}

/** `P2` — `smocTabPath` builds the `:tab` URL, encoding the location id. */
export function runP2(): void {
  assert(
    smocTabPath("rsmoc wc", "hvac") === "/control-room/site/rsmoc%20wc/hvac",
    "smocTabPath must encode the locationId and append the tab key",
  );
}

/** `P3` — a missing `:tab` param reads as the default tab (D2). */
export function runP3(): void {
  assert(
    smocTabFromParam(undefined) === DEFAULT_SMOC_TAB && DEFAULT_SMOC_TAB === "overview",
    "an undefined param must resolve to the overview tab",
  );
}

/** `P4` — an unknown `:tab` param resolves to `null` (D2, D5). */
export function runP4(): void {
  assert(smocTabFromParam("not-a-tab") === null, "an unknown tab param must be null");
}

/** `P5` — a known `:tab` param resolves to itself. */
export function runP5(): void {
  assert(smocTabFromParam("sld") === "sld", "a known tab param must resolve to itself");
}

/** `P6a` — an HVAC-only asset-group scope allows exactly two tabs. */
export function runP6a(): void {
  const keys = allowedSmocTabs(HVAC_ONLY).map((tab) => tab.key);
  assert(keys.length === 2, `HVAC_ONLY must allow exactly 2 tabs, got ${keys.length}`);
}

/** `P6b` — an HVAC-only scope allows overview. */
export function runP6b(): void {
  const keys = allowedSmocTabs(HVAC_ONLY).map((tab) => tab.key);
  assert(keys.includes("overview"), "HVAC_ONLY must allow overview");
}

/** `P6c` — an HVAC-only scope allows hvac. */
export function runP6c(): void {
  const keys = allowedSmocTabs(HVAC_ONLY).map((tab) => tab.key);
  assert(keys.includes("hvac"), "HVAC_ONLY must allow hvac");
}

/** `P7a` — an electrical-only scope allows ups (the electrical fallback). */
export function runP7a(): void {
  const keys = allowedSmocTabs(ELECTRICAL_ONLY).map((tab) => tab.key);
  assert(keys.includes("ups"), "ELECTRICAL_ONLY must allow ups");
}

/** `P7b` — an electrical-only scope allows battery (the electrical fallback). */
export function runP7b(): void {
  const keys = allowedSmocTabs(ELECTRICAL_ONLY).map((tab) => tab.key);
  assert(keys.includes("battery"), "ELECTRICAL_ONLY must allow battery");
}

/** `P7c` — an electrical-only scope does not allow hvac (after a positive control on the same list). */
export function runP7c(): void {
  const keys = allowedSmocTabs(ELECTRICAL_ONLY).map((tab) => tab.key);
  assert(keys.includes("ups"), "positive control: ELECTRICAL_ONLY must allow ups");
  assert(!keys.includes("hvac"), "ELECTRICAL_ONLY must not allow hvac");
}

/** `P8` — a global scope allows all seven tabs. */
export function runP8(): void {
  const keys = allowedSmocTabs(GLOBAL).map((tab) => tab.key);
  assert(keys.length === 7, `GLOBAL must allow all 7 tabs, got ${keys.length}`);
}

/**
 * The fixtures spell the codes as literals, never through `SMOC_SITE_CODE` or
 * `SMOC_ORG_CODE`: a fixture built from a constant follows a mutated constant.
 */
const ESKOM = { code: "ESKOM" };
const PHEWB = { code: "PHEWB" };

/** `P9` — `findSmocSite` picks the `RSMOC-WC` row wherever it sits in the list, not the first. */
export function runP9(): void {
  const items = [
    { id: "loc-1", code: "OTHER-SITE", organization: ESKOM },
    { id: "loc-2", code: "RSMOC-WC", organization: ESKOM },
    { id: "loc-3", code: "ANOTHER", organization: ESKOM },
  ];
  const found = findSmocSite(items);
  assert(found?.id === "loc-2", `findSmocSite must pick the RSMOC-WC row, got ${found?.id}`);
}

/**
 * `P9b` — a location code is unique only per organization (migration 0016):
 * an `RSMOC-WC` row of another organization placed first is not the SMOC site.
 */
export function runP9b(): void {
  const items = [
    { id: "loc-phe", code: "RSMOC-WC", organization: PHEWB },
    { id: "loc-eskom", code: "RSMOC-WC", organization: ESKOM },
  ];
  const found = findSmocSite(items);
  assert(found?.id === "loc-eskom", `findSmocSite must pick the ESKOM RSMOC-WC row, got ${found?.id}`);
}

/** `P9c` — `isSmocSite` is false for `RSMOC-WC` in another organization. */
export function runP9c(): void {
  assert(
    isSmocSite({ code: "RSMOC-WC", organization: ESKOM }),
    "positive control: RSMOC-WC in ESKOM must be the SMOC site",
  );
  assert(
    !isSmocSite({ code: "RSMOC-WC", organization: PHEWB }),
    "RSMOC-WC in PHEWB must not be the SMOC site",
  );
}
