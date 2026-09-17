import type { AssetDomainDto } from "@bms/shared";

import type { AssetRow } from "../api/assets";

import {
  activeLabel,
  domainLabel,
  filterAssetRows,
  noDashboardsSentence,
  siteOptions,
} from "./asset-browser";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// No gate type-checks this file (`apps/web/tsconfig.json` excludes
// `src/**/*.spec.ts`, and vitest strips types), so the literals below are kept
// honest by hand — the same note `asset-picker.spec.ts` carries.
const ROWS: AssetRow[] = [
  { id: "1", code: "CR-HVAC-1", name: "Control Room HVAC 1", siteName: "RSMOC Western Cape", domain: "hvac", locationId: "loc-1", locationName: "Western Cape control room", rtuId: null, rtuDisplayName: null, telemetrySource: null, active: true, templateId: null },
  { id: "2", code: "GP-CRAC-01", name: "Gauteng CRAC Unit 1", siteName: "RSMOC Gauteng", domain: "hvac", locationId: "loc-2", locationName: "Gauteng control room", rtuId: null, rtuDisplayName: null, telemetrySource: null, active: true, templateId: null },
  { id: "3", code: "FEED-PUMP-2", name: "Feed Pump 2", siteName: "RSMOC KwaZulu-Natal", domain: "water", locationId: "loc-3", locationName: "KwaZulu-Natal control room", rtuId: null, rtuDisplayName: null, telemetrySource: null, active: false, templateId: null },
];

function ids(rows: readonly AssetRow[]): string {
  return rows.map((row) => row.id).join(",");
}

/** L1 — empty filters pass every row through. */
export function runEmptyFilterTests(): void {
  assert(
    ids(filterAssetRows(ROWS, { query: "", domain: "", site: "" })) === "1,2,3",
    "empty filters must return every row",
  );
}

/** L2 — the text filter matches code or name, case-insensitively, trimmed. */
export function runTextFilterTests(): void {
  assert(ids(filterAssetRows(ROWS, { query: "hvac-1", domain: "", site: "" })) === "1", "must match the code");
  assert(ids(filterAssetRows(ROWS, { query: "feed pump", domain: "", site: "" })) === "3", "must match the name");
  assert(ids(filterAssetRows(ROWS, { query: "  HVAC-1  ", domain: "", site: "" })) === "1", "must trim and ignore case");
}

/**
 * L3 — the text filter does NOT read `siteName` (ADR 0068 decision 1: code
 * and name; the site has its own filter). This is the assertion that keeps
 * `filterAssetsByQuery` from `asset-picker.ts` from being reused here.
 */
export function runTextFilterIgnoresSiteTests(): void {
  assert(
    filterAssetRows(ROWS, { query: "kwazulu", domain: "", site: "" }).length === 0,
    "a query that matches only the site name must return no rows",
  );
}

/** L4 — domain and site are exact matches; the three filters compose as AND. */
export function runCompositionTests(): void {
  assert(ids(filterAssetRows(ROWS, { query: "", domain: "hvac", site: "" })) === "1,2", "domain must match exactly");
  assert(ids(filterAssetRows(ROWS, { query: "", domain: "", site: "RSMOC Gauteng" })) === "2", "site must match exactly");
  assert(ids(filterAssetRows(ROWS, { query: "control", domain: "hvac", site: "" })) === "1", "query AND domain");
  assert(filterAssetRows(ROWS, { query: "control", domain: "water", site: "" }).length === 0, "query AND domain must not OR");
}

/** L5 — distinct site names, sorted. */
export function runSiteOptionsTests(): void {
  const doubled = [...ROWS, { ...ROWS[1]!, id: "4" }];
  assert(
    siteOptions(doubled).join("|") === "RSMOC Gauteng|RSMOC KwaZulu-Natal|RSMOC Western Cape",
    `siteOptions must be distinct and sorted, got ${siteOptions(doubled).join("|")}`,
  );
}

/** L6 — the vocabulary label, or the bare code when the vocabulary has no row. */
export function runDomainLabelTests(): void {
  const domains: AssetDomainDto[] = [{ code: "hvac", label: "HVAC", sortOrder: 10, active: true }];
  assert(domainLabel("hvac", domains) === "HVAC", "must return the vocabulary label");
  assert(domainLabel("water", domains) === "water", "an unknown code must fall back to the code");
}

/** L7 — a hand-created asset (`templateId === null`) gets the sentence that says why. */
export function runNoDashboardsSentenceTests(): void {
  assert(noDashboardsSentence(null).includes("created by hand"), "null templateId must explain itself");
  assert(
    !noDashboardsSentence("66666666-6666-4666-8666-666666666666").includes("created by hand"),
    "a templated asset must get the plain sentence",
  );
  assert(
    noDashboardsSentence("66666666-6666-4666-8666-666666666666").startsWith("No dashboards for this asset"),
    "the plain sentence",
  );
}

/** `activeLabel` — both branches, so the coverage denominator sees them. */
export function runActiveLabelTests(): void {
  assert(activeLabel(true) === "Active", "true → Active");
  assert(activeLabel(false) === "Inactive", "false → Inactive");
}
