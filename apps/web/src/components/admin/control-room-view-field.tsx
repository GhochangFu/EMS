import type { SiteControlRoomViewKind } from "@bms/shared";

import type { SiteViewDraft } from "../../lib/site-control-room-view";

type ControlRoomViewFieldProps = {
  value: SiteViewDraft;
  onChange: (value: SiteViewDraft) => void;
  /** Already filtered to the site's eligible dashboards (`isEligibleSiteViewDashboard`). */
  dashboards: ReadonlyArray<{ id: string; name: string; slug: string }>;
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
            required
            onChange={(event) =>
              onChange({ kind: "dashboard", dashboardId: event.target.value || null })
            }
          >
            <option value="">Select a dashboard</option>
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
