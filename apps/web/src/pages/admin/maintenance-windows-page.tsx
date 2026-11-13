import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import type { MaintenanceWindowItem, MaintenanceWindowState } from "@bms/shared/contracts";

import { fetchMaintenanceWindows } from "../../api/maintenance-windows";
import { AdminRoute } from "../../components/admin-route";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import {
  type MaintenanceWindowDialog,
  MaintenanceWindowWizard,
  WINDOW_MAX_DAYS,
} from "../../components/maintenance/maintenance-window-wizards";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageMaintenanceWindows } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { localMinuteOf, localZoneLabel } from "../../lib/maintenance-window-time";
import { type AuthUser, useAuthStore } from "../../stores/auth-store";

/**
 * `F4.359` U15 (ADR 0131 decision 16; plan ruling Q6) — the Maintenance windows page: the
 * active, future and past windows (past: the newest 100), the Create button, and each row's
 * actions — Extend and End on an active window, Cancel on a future one. Every action is a
 * `WizardShell` wizard (`maintenance-window-wizards.tsx`).
 *
 * The route element is this file's export: signed out goes to login, signed in goes through
 * `AdminRoute` (so an `operator` is sent home), and `extra-admin-routes.tsx` mounts it — `app.tsx`
 * sits at the AGENTS.md section 4.5 cap. The reads are the caller's own scope (decision 13).
 *
 * Every time is in the browser's own zone, and the Start and End columns name it — the same
 * convention as the wizards' inputs (`lib/maintenance-window-time.ts`). A window's state moves with
 * the clock, so each section re-reads once a minute.
 */

/** Each section's read: past is the newest 100 (the list's ceiling; the API orders by start, newest first). */
const SECTIONS: readonly { state: MaintenanceWindowState; title: string; empty: string }[] = [
  { state: "active", title: "Active", empty: "No maintenance window is active." },
  { state: "future", title: "Future", empty: "No maintenance window is planned." },
  { state: "past", title: "Past", empty: "No maintenance window has ended yet." },
];
const LIMIT = 100;
/** A window starts and ends by the clock, not an event: the sections re-read once a minute. */
const REFETCH_MS = 60_000;

const actionClass = "text-xs font-semibold text-accent-strong";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";

/** Future is read soonest first; the API orders every state by start, newest first. */
const ordered = (state: MaintenanceWindowState, items: readonly MaintenanceWindowItem[]): readonly MaintenanceWindowItem[] =>
  state === "future" ? [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) : items;

function WindowRows({
  state,
  items,
  canManage,
  open,
}: {
  state: MaintenanceWindowState;
  items: readonly MaintenanceWindowItem[];
  canManage: boolean;
  open: (dialog: MaintenanceWindowDialog) => void;
}) {
  const zone = localZoneLabel();
  return (
    <table aria-label={`${state[0]?.toUpperCase()}${state.slice(1)} maintenance windows`} className="min-w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase text-ink-muted">
          <th className="px-2 py-2">Reason</th>
          <th className="px-2 py-2">{`Start (${zone})`}</th>
          <th className="px-2 py-2">{`End (${zone})`}</th>
          <th className="px-2 py-2">Targets</th>
          <th className="px-2 py-2">Link</th>
          <th className="px-2 py-2">Created by</th>
          <th className="px-2 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-well-deep">
            <td className="px-2 py-2 font-semibold text-ink">{item.reason}</td>
            <td className="px-2 py-2">{localMinuteOf(item.startsAt)}</td>
            <td className="px-2 py-2">
              {localMinuteOf(item.endedAt ?? item.endsAt)}
              {item.endedAt !== null && item.endedByName !== null ? (
                <span className="block text-2xs text-ink-muted">{`Ended by ${item.endedByName}`}</span>
              ) : null}
            </td>
            <td className="px-2 py-2">{item.targets.map((target) => target.label).join(", ")}</td>
            <td className="px-2 py-2">{item.workOrder?.reference ?? item.maintenanceSchedule?.title ?? "—"}</td>
            <td className="px-2 py-2">{item.createdByName}</td>
            <td className="px-2 py-2">
              {canManage ? (
                <div className="flex gap-2">
                  {state === "active" ? (
                    <>
                      <button type="button" className={actionClass} onClick={() => open({ kind: "extend", window: item })}>
                        Extend
                      </button>
                      <button type="button" className="text-xs font-semibold text-critical-ink" onClick={() => open({ kind: "end", window: item })}>
                        End
                      </button>
                    </>
                  ) : null}
                  {state === "future" ? (
                    <button type="button" className="text-xs font-semibold text-critical-ink" onClick={() => open({ kind: "cancel", window: item })}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WindowSection({
  state,
  title,
  empty,
  canManage,
  open,
}: (typeof SECTIONS)[number] & { canManage: boolean; open: (dialog: MaintenanceWindowDialog) => void }) {
  const listQ = useQuery({
    queryKey: ["maintenance-windows", "admin", state],
    queryFn: () => fetchMaintenanceWindows({ state, limit: LIMIT }),
    refetchInterval: REFETCH_MS,
  });
  const items = ordered(state, listQ.data?.items ?? []);
  return (
    <SectionCard title={title} bodyClassName="p-3 space-y-2 overflow-x-auto">
      {listQ.isError ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(listQ.error)}
        </p>
      ) : null}
      {listQ.isPending ? (
        <p role="status" className="text-xs text-ink-muted">
          Loading…
        </p>
      ) : null}
      {listQ.isSuccess && items.length === 0 ? <p className="text-sm text-ink-muted">{empty}</p> : null}
      <WindowRows state={state} items={items} canManage={canManage} open={open} />
    </SectionCard>
  );
}

function MaintenanceWindowsAdminPage({ user }: { user: AuthUser }) {
  const [dialog, setDialog] = useState<MaintenanceWindowDialog | null>(null);
  const canManage = canManageMaintenanceWindows(user.role);
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Maintenance Windows"
        subtitle={`Suppress the alarms of assets, locations or rules for a set time, at most ${WINDOW_MAX_DAYS} days`}
      />
      <div className="space-y-4">
        {canManage ? (
          <div className="flex justify-end">
            <button type="button" className={primaryClass} onClick={() => setDialog({ kind: "create" })}>
              Create window
            </button>
          </div>
        ) : null}
        {SECTIONS.map((section) => (
          <WindowSection key={section.state} {...section} canManage={canManage} open={setDialog} />
        ))}
      </div>
      {dialog !== null ? <MaintenanceWindowWizard dialog={dialog} onClose={() => setDialog(null)} /> : null}
    </MasterDataLayout>
  );
}

/** `/admin/maintenance-windows`: login when signed out, then `AdminRoute`, then the page. */
export function MaintenanceWindowsRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AdminRoute user={user}>
      <MaintenanceWindowsAdminPage user={user} />
    </AdminRoute>
  );
}
