import type {
  DashboardSummaryDto,
  SiteControlRoomViewKind,
  SiteControlRoomViewSettingDto,
} from "@bms/shared";

import type { PutSiteControlRoomViewPayload } from "../api/admin/locations";

/**
 * `F3.67` U5 / ADR 0076 decision 5, plan D6 — whether the location admin page
 * offers a dashboard as a site's Control Room view: scoped to the site itself,
 * or to one of the site's asset groups. The client mirror of the API's
 * `dashboardIsScopedToSite` (`apps/api/src/control-room/site-control-room-view.pure.ts`);
 * the server re-checks on `PUT` and answers 400 for an ineligible dashboard, so
 * this only decides what the picker lists.
 *
 * **An `asset`-scoped dashboard is never eligible (D6), by an explicit guard.**
 * The API holds it by construction (`dashboards_scope_check` allows one scope
 * column), but this predicate reads a response, not the table, so it fails
 * closed on `assetId` rather than trust the CHECK.
 *
 * The organization is not compared: the page reads dashboards with
 * `fetchDashboards(<the site's organizationId>)`.
 */
export function isEligibleSiteViewDashboard(
  d: Pick<DashboardSummaryDto, "locationId" | "assetGroupId" | "assetId">,
  locationId: string,
  siteGroupIds: ReadonlySet<string>,
): boolean {
  if (d.assetId !== null) {
    return false;
  }
  if (d.locationId === locationId) {
    return true;
  }
  return d.assetGroupId !== null && siteGroupIds.has(d.assetGroupId);
}

/** The field's editable state: the kind, and the chosen dashboard when the kind is
 * `dashboard`. `builtin` carries no key here — `smoc` is the only one (decision 4). */
export type SiteViewDraft = {
  kind: SiteControlRoomViewKind;
  dashboardId: string | null;
};

/** The stored setting as the field's starting draft. */
export function siteViewDraftFromSetting(setting: SiteControlRoomViewSettingDto): SiteViewDraft {
  return {
    kind: setting.kind,
    dashboardId: setting.kind === "dashboard" ? setting.dashboardId : null,
  };
}

/** Whether a draft differs from the stored setting — the page `PUT`s only when it does. */
export function siteViewDraftChanged(stored: SiteViewDraft, draft: SiteViewDraft): boolean {
  return stored.kind !== draft.kind || stored.dashboardId !== draft.dashboardId;
}

/** A draft as the `PUT` body: exactly one of the three shapes the `.strict()` server schema
 * accepts. A `dashboard` draft with no dashboard chosen throws, and the page's error line
 * shows the message (the select is `required`, so a browser submit does not reach this). */
export function siteViewPayloadFromDraft(draft: SiteViewDraft): PutSiteControlRoomViewPayload {
  if (draft.kind === "dashboard") {
    if (!draft.dashboardId) {
      throw new Error("Choose a dashboard for the Control Room view");
    }
    return { kind: "dashboard", dashboardId: draft.dashboardId };
  }
  if (draft.kind === "builtin") {
    return { kind: "builtin", builtinKey: "smoc" };
  }
  return { kind: "generated" };
}
