import { expect } from "vitest";

import { siteLayoutBodySchema } from "../../contracts/site-layout-writes";
import { catalogEntry } from "./index";
import type { CatalogEntry } from "./types";

/**
 * `F4.320` PR 2 (ADR 0099 Amendment 15) — the two Replace entries beside their Make twins:
 * `location.siteLayout.replace` and `dashboardTemplate.replaceSiteLayouts`. The rules every entry
 * obeys are `catalog.spec.ts`; this file holds what is particular to these two. Vitest entry
 * point: the sibling `.test.ts`.
 *
 * Mutation, applied once and seen red: drop either entry's `red: true`.
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, body: Record<string, unknown>): string {
  return entry(id).summary({ body, params: { id: SITE }, targetName: "Bilsi", organizationName: "PHE West Bengal" });
}

/** Decision 1 — the per-site entry: the Make route shape at `/replace`, a red `edit`. */
export function thePerSiteEntryIsTheReplaceRoute(): void {
  const replace = entry("location.siteLayout.replace");
  const make = entry("location.siteLayout.make");
  expect(replace.method).toBe("POST");
  expect(replace.path).toBe("/admin/locations/:id/site-layout/replace");
  expect(replace.body).toBe(siteLayoutBodySchema);
  expect(replace.bodyName).toBe("siteLayoutBodySchema");
  expect(replace.risk).toBe("edit");
  expect(replace.red).toBe(true);
  expect(replace.target).toEqual({ kind: "siteLayout", param: "id" });
  expect(replace.refs).toEqual([{ field: "templateId", kind: "dashboardTemplate" }]);
  expect(replace.steps).toEqual([{ id: "groups", title: "Groups", fields: ["tabGroups", "templateId"] }]);
  // The twin is not red: the colour is this entry's, not the target kind's.
  expect(make.red).toBeUndefined();
}

/** Decision 1 — the bulk entry: no body, the template as target, no steps, a red `edit`. */
export function theBulkEntryIsTheReplaceSiteLayoutsRoute(): void {
  const bulk = entry("dashboardTemplate.replaceSiteLayouts");
  expect(bulk.method).toBe("POST");
  expect(bulk.path).toBe("/admin/dashboard-templates/:id/replace-site-layouts");
  expect(bulk.bodyName).toBeNull();
  expect(bulk.risk).toBe("edit");
  expect(bulk.red).toBe(true);
  expect(bulk.target).toEqual(entry("dashboardTemplate.applyToSites").target);
  expect(bulk.steps).toEqual([]);
  expect(entry("dashboardTemplate.applyToSites").red).toBeUndefined();
}

/** Decision 2 — the per-site summary names the site and the source, and says what is lost. */
export function thePerSiteSummarySaysWhatIsLost(): void {
  const newest = summary("location.siteLayout.replace", {});
  expect(newest).toContain('"Bilsi"');
  expect(newest).toContain("the newest published version of its template");
  expect(newest).toContain("every builder edit on it is lost");
  expect(newest).toContain("a drawn mimic is detached");
  expect(summary("location.siteLayout.replace", { templateId: TEMPLATE })).toContain(`template ${TEMPLATE}`);
}

/** Decision 2 — the bulk summary names the template and every older copy, and says what is lost. */
export function theBulkSummarySaysWhatIsLost(): void {
  const text = summary("dashboardTemplate.replaceSiteLayouts", {});
  expect(text).toContain('"Bilsi"');
  expect(text).toContain("every site in PHE West Bengal that holds an older copy");
  expect(text).toContain("every builder edit on it is lost");
  expect(text).toContain("a drawn mimic is detached");
}
