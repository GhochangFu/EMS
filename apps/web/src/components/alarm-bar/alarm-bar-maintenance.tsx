import { useState } from "react";
import { Link } from "react-router-dom";

import { type MaintenanceScope, useActiveMaintenance } from "../../hooks/use-active-maintenance";
import { canManageMaintenanceWindows } from "../../lib/admin-access";
import type { AlarmBarScope } from "../../lib/alarm-bar";
import { useAuthStore } from "../../stores/auth-store";

/** The bar's page scope as the windows read takes it; the all scope sends no filter. */
export function maintenanceScopeOf(scope: AlarmBarScope): MaintenanceScope {
  if (scope.kind === "organization") return { organizationId: scope.organizationId };
  if (scope.kind === "location") return { locationId: scope.locationId };
  return {};
}

type AlarmBarMaintenanceProps = {
  scope: AlarmBarScope;
  /** `summary.suppressed` from the feed; `null` while the scope's first read is in flight. */
  suppressed: number | null;
};

/**
 * `F4.359` U13 (ADR 0131 decision 15; plan D17) — the alarm bar's "Maintenance N" pill: shown while at
 * least one active window touches the page scope, N the scope's active suppressed alarms. It never
 * blinks and plays no tone (decision 6). A click opens the active windows upward — reason, end time,
 * targets — and an admin gets a link to the admin page.
 *
 * Visibility is the windows read (refetched every 60 s, so a window that starts or ends by time may
 * lag that long — D17), not N: a window can suppress nothing yet. `AlarmBar` mounts this only with a
 * feed installed, so no shell spec issues the read.
 */
export function AlarmBarMaintenance({ scope, suppressed }: AlarmBarMaintenanceProps) {
  const { windows } = useActiveMaintenance(maintenanceScopeOf(scope));
  const role = useAuthStore((state) => state.user?.role);
  const [open, setOpen] = useState(false);
  if (windows.length === 0) return null;
  const mayManage = role !== undefined && canManageMaintenanceWindows(role);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="alarm-bar-maintenance"
        onClick={() => setOpen((was) => !was)}
        className="surface-pill inline-flex shrink-0 items-center gap-1 rounded-full border border-info-line bg-info-wash px-2 py-0.5 text-2xs font-semibold text-info-ink"
      >
        {suppressed === null ? "Maintenance" : `Maintenance ${suppressed}`}
      </button>
      {open ? (
        <section
          id="alarm-bar-maintenance"
          // Plan Q6: on the wall, a pointer on the bar's panels does not pause the rotation.
          data-wall-bar
          aria-label="Active maintenance windows"
          className="surface-raised fixed bottom-[var(--alarm-bar-h)] left-4 z-40 flex max-h-[24rem] w-[min(28rem,calc(100%-2rem))] flex-col rounded-t-lg text-xs text-ink"
        >
          {/* A div, not <header>: inside the shell or the wall a <header> is a banner landmark. */}
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h2 className="font-semibold">Maintenance windows</h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-0.5 hover:bg-well">
              Close
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {windows.map((window) => (
              <li key={window.id} className="flex flex-col gap-0.5 border-b border-line px-3 py-2 last:border-b-0">
                <span className="font-semibold">{window.reason}</span>
                <span className="text-ink-muted">{`Ends ${new Date(window.endsAt).toLocaleString()}`}</span>
                {window.targets.length > 0 ? (
                  <span className="text-ink-muted">{window.targets.map((target) => target.label).join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {mayManage ? (
            <div className="border-t border-line px-3 py-2">
              <Link to="/admin/maintenance-windows" className="font-semibold text-accent hover:underline">
                Manage maintenance windows
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
