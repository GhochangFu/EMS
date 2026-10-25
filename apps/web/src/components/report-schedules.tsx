import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReportScheduleDto } from "@bms/shared";

import { fetchNotificationChannels } from "../api/notifications";
import { deleteReportSchedule, fetchReportSchedules } from "../api/reports";
import { apiErrorMessage } from "../lib/api-error-message";
import { formatLabel } from "../lib/report-files-view";
import { cadenceLabel, nextRunLabel } from "../lib/report-schedules-view";
import type { AuthUser } from "../stores/auth-store";
import { ReportScheduleWizard } from "./report-schedule-wizard";

/**
 * `F3.5b` Unit 13 — the Schedules section (ADR 0071 R-12, R-18; Q-6).
 *
 * Every sentence and every filtering rule is in `lib/report-schedules-view.ts`
 * (inside the web coverage `include`); this file is wiring. It has **no role
 * predicate of its own**: `ReportsPanel` renders it only for
 * `isMasterDataAdmin(user.role)` (R-13), the same gate the five routes hold.
 *
 * `F4.280` (ADR 0099 decision 6, Amendment 8): the create and edit form is
 * the `ReportScheduleWizard` stepper (`reportSchedule.create` / `.update`),
 * which holds the three role shapes; this section keeps the list, Edit and
 * Delete, and opens the wizard.
 */

export const REPORT_SCHEDULES_QUERY_KEY = ["report-schedules"] as const;

function locationsCell(count: number): string {
  if (count === 0) return "Whole organization";
  return count === 1 ? "1 location" : `${count} locations`;
}

export type ReportSchedulesProps = {
  /** The signed-in user, passed from `ReportsPanel`. */
  user: AuthUser;
};

export function ReportSchedules({ user }: ReportSchedulesProps): JSX.Element {
  const queryClient = useQueryClient();
  const offersChannel = user.role !== "location_admin";
  // `null`: no wizard open; `"new"`: the create wizard; a row: its edit wizard.
  const [open, setOpen] = useState<ReportScheduleDto | "new" | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // One entry per delete in flight — append, never replace (F3.4 sweep C2).
  const [deletingIds, setDeletingIds] = useState<readonly string[]>([]);

  const schedulesQ = useQuery({ queryKey: REPORT_SCHEDULES_QUERY_KEY, queryFn: fetchReportSchedules });
  const channelsQ = useQuery({ queryKey: ["notification-channels"], queryFn: fetchNotificationChannels, enabled: offersChannel });
  const channelCodeById = useMemo(
    () => new Map((channelsQ.data?.items ?? []).map((channel) => [channel.id, channel.code])),
    [channelsQ.data],
  );

  const deleteM = useMutation({
    mutationFn: (row: ReportScheduleDto) => deleteReportSchedule(row.id),
    onMutate: (row: ReportScheduleDto) => {
      setDeletingIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: REPORT_SCHEDULES_QUERY_KEY });
    },
    onError: (cause: Error) => setActionError(apiErrorMessage(cause)),
    // Removes only **its own** id: two deletes settle twice.
    onSettled: (_data, _error, row: ReportScheduleDto) =>
      setDeletingIds((current) => current.filter((id) => id !== row.id)),
  });

  const startEdit = (row: ReportScheduleDto): void => {
    setOpen(row);
    setOutcome(null);
  };

  const rows = schedulesQ.data;

  return (
    <section className="surface-raised p-4">
      <h2 className="font-condensed text-sm font-bold text-ink">Schedules</h2>
      {schedulesQ.isPending ? <p className="mt-2 text-sm text-ink-muted">Loading schedules…</p> : null}
      {schedulesQ.isError ? (
        <p className="mt-2 text-sm text-critical-ink">{apiErrorMessage(schedulesQ.error)}</p>
      ) : null}
      {rows !== undefined && rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No schedules yet.</p>
      ) : null}
      {rows !== undefined && rows.length > 0 ? (
        <div className="mt-3 overflow-hidden surface-table">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-well text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Cadence</th>
                <th className="px-3 py-2">Run at</th>
                <th className="px-3 py-2">Next run</th>
                <th className="px-3 py-2">Formats</th>
                <th className="px-3 py-2">Locations</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const deleting = deletingIds.includes(row.id);
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                    <td className="px-3 py-2 text-ink-muted">{cadenceLabel(row.cadence)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{`${row.runAtLocal} ${row.timezone}`}</td>
                    <td className="px-3 py-2 text-ink-muted">{nextRunLabel(row.nextRunAt)}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.formats.map(formatLabel).join(" · ")}</td>
                    <td className="px-3 py-2 text-ink-muted">{locationsCell(row.locationIds.length)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.channelId === null ? "—" : (channelCodeById.get(row.channelId) ?? "Configured")}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{row.enabled ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent-strong disabled:cursor-not-allowed disabled:text-ink-hint"
                          disabled={deleting}
                          data-pending-bystander="deleting"
                          onClick={() => startEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-ink-muted disabled:cursor-not-allowed"
                          disabled={deleting}
                          aria-busy={deleting}
                          onClick={() => deleteM.mutate(row)}
                        >
                          {deleting ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {actionError !== null ? <p className="mt-2 text-xs text-critical-ink">{actionError}</p> : null}

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          className="surface-button-primary bg-chrome px-3 py-2 text-sm font-semibold text-on-dark"
          onClick={() => {
            setOpen("new");
            setOutcome(null);
          }}
        >
          New schedule
        </button>
        {outcome !== null ? <p className="text-xs text-accent-strong">{outcome}</p> : null}
      </div>
      {open !== null ? (
        <ReportScheduleWizard
          key={open === "new" ? "new" : open.id}
          user={user}
          schedule={open === "new" ? null : open}
          onCancel={() => setOpen(null)}
          onDone={async (row) => {
            setOpen(null);
            setOutcome(`Saved schedule ${row.name}.`);
            await queryClient.invalidateQueries({ queryKey: REPORT_SCHEDULES_QUERY_KEY });
          }}
        />
      ) : null}
    </section>
  );
}
