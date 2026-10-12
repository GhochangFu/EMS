import { expect } from "vitest";

import { putSiteControlRoomViewBodySchema } from "../../contracts/site-control-room-view-writes";
import { siteLayoutBodySchema } from "../../contracts/site-layout-writes";
import { catalogEntry } from "./index";
import { bodyFieldsOf } from "./object-shape";
import type { CatalogEntry } from "./types";

/**
 * `F3.86` PR 3d (plan §5.5, ruling Q7(b)) — the two location sub-route
 * entries: the site's Control Room view and the site-layout copy. The rules
 * every entry obeys are `catalog.spec.ts`; this file holds what is particular
 * to these two. Vitest entry point: the sibling `.test.ts`.
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const DASHBOARD = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";
const GROUP_A = "44444444-4444-4444-8444-444444444444";
const GROUP_B = "55555555-5555-4555-8555-555555555555";

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, body: Record<string, unknown>): string {
  return entry(id).summary({ body, params: { id: SITE }, targetName: "Lotapata", organizationName: "PHE West Bengal" });
}

/** The view entry is the controller's route and body, with the site as its target. */
export function theViewEntryIsThePutRoute(): void {
  const view = entry("location.controlRoomView.set");
  expect(view.method).toBe("PUT");
  expect(view.path).toBe("/admin/locations/:id/control-room-view");
  expect(view.body).toBe(putSiteControlRoomViewBodySchema);
  expect(view.risk).toBe("edit");
  expect(view.target).toEqual({ kind: "siteControlRoomView", param: "id" });
  expect(view.refs).toEqual([{ field: "dashboardId", kind: "dashboard" }]);
}

/** The site-layout entry is the controller's route and body, with the site as its target. */
export function theSiteLayoutEntryIsThePostRoute(): void {
  const layout = entry("location.siteLayout.make");
  expect(layout.method).toBe("POST");
  expect(layout.path).toBe("/admin/locations/:id/site-layout");
  expect(layout.body).toBe(siteLayoutBodySchema);
  expect(layout.risk).toBe("create");
  expect(layout.target).toEqual({ kind: "siteLayout", param: "id" });
  expect(layout.refs).toEqual([{ field: "templateId", kind: "dashboardTemplate" }]);
}

/** The refined view body unwraps to its three fields (the positive control for the step rule). */
export function theRefinedViewBodyHasItsThreeFields(): void {
  expect(bodyFieldsOf(putSiteControlRoomViewBodySchema)).toEqual(["kind", "dashboardId", "builtinKey"]);
  expect(entry("location.controlRoomView.set").steps).toEqual([
    { id: "view", title: "View", fields: ["kind", "dashboardId", "builtinKey"] },
  ]);
}

/** Each view kind reads as itself, and names the site. */
export function theViewSummaryNamesTheSiteAndTheKind(): void {
  const generated = summary("location.controlRoomView.set", { kind: "generated" });
  expect(generated).toContain("Lotapata");
  expect(generated).toContain("the generated view");
  const dashboard = summary("location.controlRoomView.set", { kind: "dashboard", dashboardId: DASHBOARD });
  expect(dashboard).toContain("Lotapata");
  expect(dashboard).toContain(`dashboard ${DASHBOARD}`);
  const builtin = summary("location.controlRoomView.set", { kind: "builtin", builtinKey: "smoc" });
  expect(builtin).toContain("Lotapata");
  expect(builtin).toContain("the built-in SMOC view");
}

/** No template: the newest published one; a template: its id. */
export function theSiteLayoutSummaryNamesTheSiteAndTheTemplate(): void {
  const newest = summary("location.siteLayout.make", {});
  expect(newest).toContain("Lotapata");
  expect(newest).toContain("the organization's newest published site template");
  expect(newest).not.toContain("tab");
  const chosen = summary("location.siteLayout.make", { templateId: TEMPLATE });
  expect(chosen).toContain(`template ${TEMPLATE}`);
}

/** With `tabGroups`, the summary counts the tabs the admin chose groups for. */
export function theSiteLayoutSummaryCountsTheChosenTabs(): void {
  expect(summary("location.siteLayout.make", { tabGroups: { sld: GROUP_A, hvac: GROUP_B } })).toContain(
    "with the chosen groups for 2 tabs",
  );
  expect(summary("location.siteLayout.make", { tabGroups: { sld: GROUP_A } })).toContain(
    "with the chosen groups for 1 tab.",
  );
  // An empty map (the wizard sets one on an ambiguous answer) chose nothing, so it counts nothing.
  const empty = summary("location.siteLayout.make", { tabGroups: {} });
  expect(empty).toContain("the organization's newest published site template.");
  expect(empty).not.toContain("tab");
}
