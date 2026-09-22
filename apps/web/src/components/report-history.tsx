import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReportFileDto } from "@bms/shared";

import { deleteReportFile, downloadReportFile, fetchReportFiles } from "../api/reports";
import { ApiError } from "../lib/api-error";
import { apiErrorMessage } from "../lib/api-error-message";
import {
  deliveryStatusLabel,
  formatBytes,
  formatLabel,
  originLabel,
  periodLabel,
} from "../lib/report-files-view";

/**
 * `F3.5a` Unit 11 — the saved-report History list (ADR 0071 decision 12;
 * R-13, R-14).
 *
 * Every label comes from `lib/report-files-view.ts`, which is inside the web
 * coverage `include` (`src/lib/**`) and asserted without a DOM; this file is
 * wiring. It has **no role predicate of its own**: `ReportsPanel` renders it
 * only for `isMasterDataAdmin(user.role)` (R-13), and the list route is
 * already scoped by decision 6, so a second gate here would invent a rule
 * the API does not mirror.
 *
 * The query key `["report-files"]` is the one the panel's Save mutation
 * invalidates, so a save and a delete are one cache entry and one request.
 */

/** The query key the panel's Save mutation invalidates — one spelling, imported. */
export const REPORT_FILES_QUERY_KEY = ["report-files"] as const;

/**
 * The 503 is the API's own sentence (object storage not configured — the
 * `asset-images` precedent); anything else is a generic line so a proxy's
 * HTML page or a bare status never reaches the screen.
 */
function listFailureSentence(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 503) {
    return apiErrorMessage(cause);
  }
  return "Report history unavailable.";
}

export function ReportHistory(): JSX.Element {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  // One entry per delete in flight (F3.4 post-merge sweep C2). A single id is
  // one too few: the second `onMutate` overwrites it and the first row's
  // button returns to "Delete" — enabled — while its request is still open.
  const [deletingIds, setDeletingIds] = useState<readonly string[]>([]);

  const filesQ = useQuery({
    queryKey: REPORT_FILES_QUERY_KEY,
    queryFn: fetchReportFiles,
  });

  const downloadMutation = useMutation({
    mutationFn: (file: ReportFileDto) => downloadReportFile(file),
    onSuccess: () => setActionError(null),
    onError: (cause: Error) => setActionError(apiErrorMessage(cause)),
  });

  const deleteMutation = useMutation({
    mutationFn: (file: ReportFileDto) => deleteReportFile(file.id),
    onMutate: (file: ReportFileDto) => {
      // Append, never replace: two deletes can be open at once.
      setDeletingIds((current) => (current.includes(file.id) ? current : [...current, file.id]));
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: REPORT_FILES_QUERY_KEY });
    },
    onError: (cause: Error) => setActionError(apiErrorMessage(cause)),
    // `onSettled` removes only **its own** id: React Query runs one per
    // mutation call, so two deletes settle twice and each leaves the other's
    // entry alone.
    onSettled: (_data, _error, file: ReportFileDto) =>
      setDeletingIds((current) => current.filter((id) => id !== file.id)),
  });

  const files = filesQ.data;

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-sm font-bold text-bms-ink">History</h2>
      {filesQ.isPending ? (
        <p className="mt-2 text-sm text-bms-muted">Loading report history…</p>
      ) : null}
      {filesQ.isError ? (
        <p className="mt-2 text-sm text-red-700">{listFailureSentence(filesQ.error)}</p>
      ) : null}
      {files !== undefined && files.length === 0 ? (
        <p className="mt-2 text-sm text-bms-muted">No saved reports yet.</p>
      ) : null}
      {files !== undefined && files.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
              <tr>
                <th className="px-3 py-2">Filename</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Format</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2">Origin</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {files.map((file) => {
                const deleting = deletingIds.includes(file.id);
                return (
                  <tr key={file.id}>
                    <td className="px-3 py-2 font-medium text-bms-ink">{file.filename}</td>
                    <td className="px-3 py-2 text-bms-muted">{periodLabel(file)}</td>
                    <td className="px-3 py-2 text-bms-muted">{formatLabel(file.format)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatBytes(file.byteSize)}</td>
                    <td className="px-3 py-2 text-bms-muted">{originLabel(file)}</td>
                    <td className="px-3 py-2 text-bms-muted">
                      {deliveryStatusLabel(file.deliveryStatus, file.scheduleId)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-bms-green"
                          onClick={() => downloadMutation.mutate(file)}
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          className="text-xs text-bms-muted disabled:cursor-not-allowed"
                          disabled={deleting}
                          onClick={() => deleteMutation.mutate(file)}
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
      {actionError !== null ? <p className="mt-2 text-xs text-red-700">{actionError}</p> : null}
    </section>
  );
}
