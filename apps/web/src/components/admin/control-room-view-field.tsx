import type { SiteControlRoomViewKind } from "@bms/shared";

import type { SiteViewDraft } from "../../lib/site-control-room-view";

type ControlRoomViewFieldProps = {
  value: SiteViewDraft;
  onChange: (value: SiteViewDraft) => void;
  /** Already filtered to the site's eligible dashboards (`isEligibleSiteViewDashboard`). */
  dashboards: ReadonlyArray<{ id: string; name: string; slug: string }>;
  /** Whether the reads that decide `dashboards` have answered — until then an unlisted stored
   * dashboard is "loading", not "no longer available". */
  dashboardsLoaded: boolean;
  /** Whether the user has changed the field in this Edit session. Review C1: only then is the
   * dashboard picker `required` — an untouched field over a deleted or re-scoped stored
   * dashboard must not block a Save that changed only the location. */
  touched: boolean;
  /** The site's stored setting as a draft — what the field shows before it is touched. */
  stored: SiteViewDraft;
  /** Plan OQ1/OQ3 — only the global `admin` may set `builtin` or replace it. For any other
   * role the option is not offered, and a site whose stored view is `builtin` renders the
   * field read-only (the API answers 403 regardless). */
  canSetBuiltin: boolean;
};

/**
 * `F3.67` U5 / ADR 0076 decision 3 — a site's "Control Room view" on the
 * location Edit form: the generated view, one of the site's dashboards, or
 * (global admin only) the built-in SMOC view. Presentational: the page owns
 * the reads, the draft and the `PUT`.
 */
export function ControlRoomViewField({
  value,
  onChange,
  dashboards,
  dashboardsLoaded,
  touched,
  stored,
  canSetBuiltin,
}: ControlRoomViewFieldProps) {
  if (stored.kind === "builtin" && !canSetBuiltin) {
    // OQ3: shown as it is, and not changeable — never the first option ("Generated"), which
    // is what a select with no matching option would display.
    return (
      <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
        Control Room view
        <select className="mt-1 w-full rounded border px-3 py-2 text-sm" value="builtin" disabled>
          <option value="builtin" disabled>
            Built-in (SMOC)
          </option>
        </select>
      </label>
    );
  }
  // A stored dashboard the picker does not list (re-scoped away from the site, or moved) stays
  // selected as a disabled option, so the select shows the truth rather than the placeholder.
  const unlistedDashboardId =
    value.dashboardId !== null && !dashboards.some((dashboard) => dashboard.id === value.dashboardId)
      ? value.dashboardId
      : null;
  return (
    <>
      <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
        Control Room view
        <select
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          value={value.kind}
          onChange={(event) =>
            onChange({ kind: event.target.value as SiteControlRoomViewKind, dashboardId: null })
          }
        >
          <option value="generated">Generated</option>
          <option value="dashboard">Dashboard</option>
          {canSetBuiltin ? <option value="builtin">Built-in (SMOC)</option> : null}
        </select>
      </label>
      {value.kind === "dashboard" ? (
        <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
          Control Room dashboard
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={value.dashboardId ?? ""}
            required={touched}
            onChange={(event) =>
              onChange({ kind: "dashboard", dashboardId: event.target.value || null })
            }
          >
            {/* An untouched field with no dashboard is a stored dashboard view whose dashboard
                was deleted (the FK set it NULL): say so, rather than offer a neutral choice. */}
            <option value="">
              {!touched && value.dashboardId === null ? "(no longer available)" : "Select a dashboard"}
            </option>
            {unlistedDashboardId !== null ? (
              <option value={unlistedDashboardId} disabled>
                {dashboardsLoaded ? "(no longer available)" : "Loading…"}
              </option>
            ) : null}
            {dashboards.map((dashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {dashboard.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
