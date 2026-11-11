import { useQuery } from "@tanstack/react-query";

import { fetchRtuDropHistory } from "../../api/device-health";
import { apiErrorMessage } from "../../lib/api-error-message";
import { DROP_REASON_LABELS, absoluteTime, firstDroppedLabel } from "../../lib/device-health-format";

/**
 * `F3.16` / ADR 0127 decision 3 — one RTU's 30 days of hourly drop buckets,
 * opened from the RTUs page's Drops 24 h cell. The first dropped point (asset
 * code and point key, or the source key) is device-supplied and renders as
 * text (decision 8).
 */
export function RtuDropHistoryDrawer({
  rtu,
  onClose,
}: {
  rtu: { id: string; code: string };
  onClose: () => void;
}) {
  const historyQ = useQuery({
    queryKey: ["admin", "device-health", "drops", rtu.id],
    queryFn: () => fetchRtuDropHistory(rtu.id),
  });
  const items = historyQ.data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-scrim/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Drop history — ${rtu.code}`}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto surface-dialog p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-lg font-bold">Drop history — {rtu.code}</h2>
            <p className="text-2xs text-ink-muted">Dropped readings per hour, last 30 days</p>
          </div>
          <button type="button" className="text-sm text-ink-muted hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>

        {historyQ.isLoading ? <p className="mt-4 text-sm text-ink-muted">Loading…</p> : null}
        {historyQ.isError ? (
          <p role="alert" className="mt-4 text-sm text-critical-ink">
            {apiErrorMessage(historyQ.error)}
          </p>
        ) : null}
        {historyQ.isSuccess && items.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No dropped readings in the last 30 days.</p>
        ) : null}
        {items.length > 0 ? (
          <table className="mt-4 min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-2">Hour</th>
                <th className="px-2 py-2">Reason</th>
                <th className="px-2 py-2">Count</th>
                <th className="px-2 py-2">First dropped</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.bucket}|${item.reason}`} className="border-b border-well-deep">
                  <td className="px-2 py-2 whitespace-nowrap">{absoluteTime(item.bucket)}</td>
                  <td className="px-2 py-2">{DROP_REASON_LABELS[item.reason]}</td>
                  <td className="px-2 py-2 font-mono">{item.count}</td>
                  <td className="px-2 py-2 font-mono">{firstDroppedLabel(item.first) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </aside>
    </div>
  );
}
