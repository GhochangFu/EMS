import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { fetchActiveAlarms } from "../../api/alarms";
import { ALARM_BAR_LIST_LIMIT, type AlarmBarScope, alarmBarScopeKey, alarmLocationLabel, alarmReadScopeOf } from "../../lib/alarm-bar";
import { alarmSubjectName } from "../../lib/alarm-source";
import { useAlarmBarStore } from "../../stores/alarm-bar-store";
import { AlarmDetailsPanel } from "../alarm-details-panel";

type AlarmBarListProps = {
  scope: AlarmBarScope;
  /** Plan Q4: "Estate", "This organization", … */
  scopeLabel: string;
  /** A viewer reads the details panel without its write half. */
  readOnly: boolean;
  onClose: () => void;
};

/**
 * `F4.357` U5 (ADR 0130 decisions 2 and 4) — "All alarms": the scope's active
 * alarms (info included, at most 50, newest first; `F4.359` U13: suppressed
 * ones dropped and counted, ADR 0131 decision 6), opened upward over the
 * page from the bar. Read through TanStack Query only while it is open (plan
 * Q1 ruling). A row opens `AlarmDetailsPanel`; the page does not change.
 */
export function AlarmBarList({ scope, scopeLabel, readOnly, onClose }: AlarmBarListProps) {
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["alarms", "alarm-bar", "active", alarmBarScopeKey(scope)],
    queryFn: () => fetchActiveAlarms(alarmReadScopeOf(scope), ALARM_BAR_LIST_LIMIT),
  });
  const read = query.data?.items ?? [];
  // F4.359 U13 (plan Q4): `state=active` keeps suppressed alarms; the bar's list drops them. How many it
  // says were dropped is the scope's summary count (the pill's), not what this 50-row read happened to hold.
  const items = read.filter((alarm) => !alarm.suppressed);
  const suppressedCount = useAlarmBarStore((state) => state.summary?.suppressed ?? 0);
  return (
    <section
      id="alarm-bar-list"
      data-wall-bar
      aria-label={`All alarms — ${scopeLabel}`}
      className="surface-overlay fixed bottom-[var(--alarm-bar-h)] right-4 z-40 flex max-h-[24rem] w-[min(32rem,calc(100%-2rem))] flex-col rounded-t-lg rounded-b-none border-b-0 text-xs text-ink"
    >
      {/* A div, not <header>: inside the shell or the wall a <header> is a banner landmark (U9). */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="font-semibold">{scopeLabel}</h2>
        <button type="button" onClick={onClose} className="rounded px-2 py-0.5 hover:bg-well">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <p className="px-3 py-2 text-ink-muted">Loading…</p>
        ) : query.isError ? (
          <p className="px-3 py-2 text-critical-ink">Could not load the alarms.</p>
        ) : read.length === 0 ? (
          <p className="px-3 py-2 text-ink-muted">No active alarms</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-ink-muted">The newest active alarms are all suppressed by maintenance — open the Alarm Centre</p>
        ) : (
          <ul>
            {items.map((alarm) => (
              <li key={alarm.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setDetailsId(alarm.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-well"
                >
                  <span className="font-semibold">{alarm.message}</span>
                  <span className="text-ink-muted">
                    {[alarm.severity, alarmSubjectName(alarm), alarmLocationLabel(alarm), new Date(alarm.raisedAt).toLocaleString()]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <Link to="/alarms" className="font-semibold text-accent hover:underline">
          Open the Alarm Centre
        </Link>
        {suppressedCount > 0 ? (
          <Link to="/alarms" className="text-ink-muted hover:underline">
            {`${suppressedCount} suppressed by maintenance`}
          </Link>
        ) : null}
      </div>
      {detailsId !== null
        ? createPortal(<AlarmDetailsPanel alarmId={detailsId} readOnly={readOnly} onClose={() => setDetailsId(null)} />, document.body)
        : null}
    </section>
  );
}
