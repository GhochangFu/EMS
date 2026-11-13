import type { AlarmListItem } from "@bms/shared";
import { alarmAckBodySchema } from "@bms/shared/contracts";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { ALARM_CRITICAL_MIN_RANK, alarmLocationLabel, moreActiveCount, popupRows } from "../../lib/alarm-bar";
import type { AlarmBarFeed } from "../../lib/alarm-bar-feed";
import { alarmSubjectName } from "../../lib/alarm-source";
import { useAlarmBarStore } from "../../stores/alarm-bar-store";
import { AlarmDetailsPanel } from "../alarm-details-panel";

type AlarmBarPopupProps = {
  feed: AlarmBarFeed;
  /** A viewer (no `operational` write class) sees Close only (decision 8). */
  readOnly: boolean;
};

type Run = { readonly done: number; readonly total: number; readonly errors: ReadonlyMap<string, string> };

/**
 * `F4.357` U6 (ADR 0130 decisions 6–8, 18, 21) — the one popup for new alarms.
 *
 * It lists every unacknowledged alarm of rank >= 20 in the page's scope that
 * this tab has not seen (`popupRows`): critical first, newest first in a rank,
 * at most 50, and "and N more active alarms" beyond. An alarm that arrives
 * while it is open joins it. It sits fixed above the bar at the bottom centre,
 * `z-40`, a region and not a dialog (the page stays usable; the e2e suite
 * selects dialogs by name).
 *
 * **Close** marks the shown rows seen; they stay unacknowledged on the bar.
 * **Acknowledge** on a row, or **Acknowledge all**, asks for one reason
 * (`alarmAckBodySchema`: 3 to 2,000 characters, trimmed) and calls the
 * existing route once per alarm (no bulk endpoint); a row whose call fails
 * stays with its error, and the line reads "N of M acknowledged". Rows leave
 * when the refetch drops them — an acknowledge here or by another operator,
 * or a clear.
 */
export function AlarmBarPopup({ feed, readOnly }: AlarmBarPopupProps) {
  const list = useAlarmBarStore((state) => state.list);
  const summary = useAlarmBarStore((state) => state.summary);
  const seenIds = useAlarmBarStore((state) => state.seenIds);
  const rows = list === null ? [] : popupRows(list, seenIds);
  if (rows.length === 0) return null;
  const more = summary === null || list === null ? 0 : moreActiveCount(summary, list);
  // The body holds the form, the run line and the details panel, and mounts only while there are
  // rows: a popup that hides and returns for a new alarm opens clean (code review, PR 3).
  return <PopupBody feed={feed} readOnly={readOnly} rows={rows} more={more} />;
}

function PopupBody({
  feed,
  readOnly,
  rows,
  more,
}: AlarmBarPopupProps & { rows: readonly AlarmListItem[]; more: number }) {
  const [asking, setAsking] = useState<readonly string[] | null>(null);
  // Which button opened the reason form, so its label names the action (2026-11-13).
  const [askingAll, setAskingAll] = useState(false);
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  // A form whose rows all left (acknowledged elsewhere, cleared) is gone; Confirm sends only rows shown.
  const shown = new Set(rows.map((row) => row.id));
  const askingShown = asking === null ? null : asking.filter((id) => shown.has(id));
  const formOpen = askingShown !== null && askingShown.length > 0;
  // U7 (decision 9): the header blinks while a row is critical (every row is unseen by definition).
  const blink = rows.some((row) => row.severityRank >= ALARM_CRITICAL_MIN_RANK);
  const trimmed = reason.trim();
  const valid = alarmAckBodySchema.safeParse({ reason: trimmed }).success;

  const confirm = async (): Promise<void> => {
    if (!formOpen || !valid) return;
    const ids = askingShown;
    setRunning(true);
    const result = await feed.acknowledge(ids, trimmed);
    setRunning(false);
    setRun({ done: result.done, total: ids.length, errors: new Map(result.failed.map((f) => [f.id, f.message])) });
    setAsking(null);
    setReason("");
  };

  return (
    <section
      role="region"
      aria-label="New alarms"
      data-wall-bar
      className="surface-raised fixed bottom-[calc(var(--alarm-bar-h)+0.5rem)] left-1/2 z-40 flex max-h-[28rem] w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col rounded-lg text-xs text-ink"
    >
      {/* A div, not <header>: inside the shell or the wall a <header> is a banner landmark (U9). */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 data-blink={blink ? "true" : undefined} className={`font-semibold${blink ? " alarm-bar-blink" : ""}`}>
          {rows.length} new {rows.length === 1 ? "alarm" : "alarms"}
        </h2>
        <div className="flex items-center gap-2">
          {readOnly ? null : (
            <button
              type="button"
              disabled={running}
              onClick={() => {
                setAskingAll(true);
                setAsking(rows.map((row) => row.id));
              }}
              className="surface-button rounded px-2 py-1 font-semibold"
            >
              Acknowledge all
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={() => feed.closePopup()}
            className="surface-button rounded px-2 py-1 font-semibold"
          >
            Close
          </button>
        </div>
      </div>
      {run === null ? null : (
        <p role="status" className="border-b border-line px-3 py-1">
          {run.done} of {run.total} acknowledged
        </p>
      )}
      {!formOpen ? null : (
        <form
          className="space-y-1 border-b border-line px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label htmlFor="alarm-bar-reason" className="block font-semibold">
            {askingAll
              ? `Reason to acknowledge all ${askingShown.length} listed ${askingShown.length === 1 ? "alarm" : "alarms"}`
              : "Reason for this alarm"}
          </label>
          <textarea
            id="alarm-bar-reason"
            value={reason}
            maxLength={2000}
            rows={2}
            onChange={(event) => setReason(event.target.value)}
            className="surface-field w-full rounded px-2 py-1"
          />
          <p className="text-ink-muted">This cannot be undone.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={!valid || running} className="surface-button rounded px-2 py-1 font-semibold">
              Confirm
            </button>
            <button type="button" onClick={() => setAsking(null)} className="surface-button rounded px-2 py-1">
              Cancel
            </button>
          </div>
        </form>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((alarm) => (
          <PopupRow
            key={alarm.id}
            alarm={alarm}
            error={run?.errors.get(alarm.id) ?? null}
            readOnly={readOnly || running}
            onOpen={() => setDetailsId(alarm.id)}
            onAcknowledge={() => {
              setAskingAll(false);
              setAsking([alarm.id]);
            }}
          />
        ))}
      </ul>
      {more > 0 ? (
        <div className="border-t border-line px-3 py-2">
          <Link to="/alarms" className="font-semibold text-accent hover:underline">
            and {more} more active alarms
          </Link>
        </div>
      ) : null}
      {detailsId !== null
        ? createPortal(<AlarmDetailsPanel alarmId={detailsId} readOnly={readOnly} onClose={() => setDetailsId(null)} />, document.body)
        : null}
    </section>
  );
}

function PopupRow({
  alarm,
  error,
  readOnly,
  onOpen,
  onAcknowledge,
}: {
  alarm: AlarmListItem;
  error: string | null;
  readOnly: boolean;
  onOpen: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="font-semibold">{alarm.message}</span>
        <span className="text-ink-muted">
          {[alarm.severity, alarmSubjectName(alarm), alarmLocationLabel(alarm), new Date(alarm.raisedAt).toLocaleString()]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </span>
        {error === null ? null : <span className="text-critical-ink">{error}</span>}
      </button>
      {readOnly ? null : (
        <button type="button" onClick={onAcknowledge} className="surface-button shrink-0 rounded px-2 py-1 font-semibold">
          Acknowledge
        </button>
      )}
    </li>
  );
}
