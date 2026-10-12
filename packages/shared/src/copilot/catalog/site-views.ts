import { putSiteControlRoomViewBodySchema } from "../../contracts/site-control-room-view-writes";
import { siteLayoutBodySchema } from "../../contracts/site-layout-writes";
import { plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/** " in <organization>", or nothing when a wizard has no organization name to give. */
function inOrganization(organizationName: string): string {
  return organizationName === "" ? "" : ` in ${organizationName}`;
}

/** What a view body sets the site to, as the card reads it. */
function viewTarget(body: Readonly<Record<string, unknown>>): string {
  if (body.kind === "dashboard") return `dashboard ${text(body, "dashboardId")}`;
  if (body.kind === "builtin") return "the built-in SMOC view";
  return "the generated view";
}

/** The site template a site-layout body copies. */
function layoutSource(body: Readonly<Record<string, unknown>>): string {
  const templateId = text(body, "templateId");
  return templateId === "" ? "the organization's newest published site template" : `template ${templateId}`;
}

/**
 * `F3.86` PR 3d (ADR 0099 release 2, ruling Q7(b), plan §5.5) — the two
 * location sub-routes of `LocationsAdminController`: a site's Control Room
 * view, and the site-layout copy. One file per area, so the wizard PRs never
 * edit the same catalog file (plan §4.5).
 *
 * The resolver mirrors each route's own checks (`siteControlRoomView`: the
 * site, then a built-in view is the global admin's only; `siteLayout`: the
 * site, then a dashboard on the site's scope), and the route checks again at
 * Confirm. `tabGroups` maps tab keys to group ids, so it is no `CatalogRef`:
 * the route's planner refuses a group that is not at the site with its own
 * 400, which the card shows. An `ambiguous` 409 after a Confirm is a failed
 * change; the card lists the candidates and links the site page's wizard
 * (plan §5.5) — the card never re-proposes.
 */
export const SITE_VIEW_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "location.controlRoomView.set",
    title: "Set a site's Control Room view",
    method: "PUT",
    path: "/admin/locations/:id/control-room-view",
    params: { id: uuidParam },
    body: putSiteControlRoomViewBodySchema,
    bodyName: "putSiteControlRoomViewBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "siteControlRoomView", param: "id" },
    refs: [{ field: "dashboardId", kind: "dashboard" }],
    formulas: [],
    steps: [{ id: "view", title: "View", fields: ["kind", "dashboardId", "builtinKey"] }],
    summary: ({ body, targetName, organizationName }) =>
      `Set the Control Room view of ${quoted(targetName)}${inOrganization(organizationName)} to ${viewTarget(body)}.`,
  },
  {
    id: "location.siteLayout.make",
    title: "Make a site layout",
    method: "POST",
    path: "/admin/locations/:id/site-layout",
    params: { id: uuidParam },
    body: siteLayoutBodySchema,
    bodyName: "siteLayoutBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "siteLayout", param: "id" },
    refs: [{ field: "templateId", kind: "dashboardTemplate" }],
    formulas: [],
    steps: [{ id: "groups", title: "Groups", fields: ["tabGroups", "templateId"] }],
    summary: ({ body, targetName, organizationName }) => {
      const tabGroups = body.tabGroups;
      const chosen = tabGroups !== null && typeof tabGroups === "object" ? Object.keys(tabGroups).length : 0;
      const tabs =
        chosen > 0
          ? `, with the chosen groups for ${plural(chosen, "tab")}`
          : "";
      return `Make the site layout for ${quoted(targetName)}${inOrganization(organizationName)} from ${layoutSource(body)}${tabs}.`;
    },
  },
];

/** The area's write routes that are not entries. Both are entries since PR 3d. */
export const SITE_VIEW_PENDING: readonly ExcludedRoute[] = [];
