import type { AccessibleScope } from "@bms/shared";

import {
  allowedSmocTabs,
  DEFAULT_SMOC_TAB,
  findSmocSite,
  SMOC_PAGES,
  smocTabFromParam,
  smocTabPath,
  SMOC_SITE_CODE,
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

/** `P6` — an HVAC-only asset-group scope allows only overview and hvac. */
export function runP6(): void {
  const keys = allowedSmocTabs(HVAC_ONLY).map((tab) => tab.key);
  assert(keys.length === 2, `HVAC_ONLY must allow exactly 2 tabs, got ${keys.length}`);
  assert(keys.includes("overview"), "HVAC_ONLY must allow overview");
  assert(keys.includes("hvac"), "HVAC_ONLY must allow hvac");
}

/** `P7` — an electrical-only scope allows ups and battery (the electrical fallback), not hvac. */
export function runP7(): void {
  const keys = allowedSmocTabs(ELECTRICAL_ONLY).map((tab) => tab.key);
  assert(keys.includes("ups"), "ELECTRICAL_ONLY must allow ups");
  assert(keys.includes("battery"), "ELECTRICAL_ONLY must allow battery");
  assert(!keys.includes("hvac"), "ELECTRICAL_ONLY must not allow hvac");
}

/** `P8` — a global scope allows all seven tabs. */
export function runP8(): void {
  const keys = allowedSmocTabs(GLOBAL).map((tab) => tab.key);
  assert(keys.length === 7, `GLOBAL must allow all 7 tabs, got ${keys.length}`);
}

/** `P9` — `findSmocSite` picks the `RSMOC-WC` row wherever it sits in the list, not the first. */
export function runP9(): void {
  const items = [
    { id: "loc-1", code: "OTHER-SITE" },
    { id: "loc-2", code: SMOC_SITE_CODE },
    { id: "loc-3", code: "ANOTHER" },
  ];
  const found = findSmocSite(items);
  assert(found?.id === "loc-2", `findSmocSite must pick the RSMOC-WC row, got ${found?.id}`);
}

/**
 * `P10` — the deprecated `SMOC_PAGES` still equals today's seven label/path
 * pairs (the `CR ·` prefix, the `/cr-*` paths), so `site-page.tsx` keeps
 * building and rendering correctly until `U4` removes this export.
 */
export function runP10(): void {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["CR · Main Dashboard", "/cr-overview"],
    ["CR · Electrical SLD", "/cr-sld"],
    ["CR · UPS Monitoring", "/cr-ups"],
    ["CR · Battery Bank", "/cr-battery"],
    ["CR · HVAC System", "/cr-hvac"],
    ["CR · Environment", "/cr-env"],
    ["CR · IT & Rack Load", "/cr-it"],
  ];
  assert(SMOC_PAGES.length === expected.length, `expected 7 pages, got ${SMOC_PAGES.length}`);
  expected.forEach(([label, path], index) => {
    const page = SMOC_PAGES[index];
    assert(page?.label === label, `page ${index}: expected label ${label}, got ${page?.label}`);
    assert(page?.path === path, `page ${index}: expected path ${path}, got ${page?.path}`);
  });
}
