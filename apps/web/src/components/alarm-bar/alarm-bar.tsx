import type { AlarmListItem, AlarmSeverityCount } from "@bms/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

import { canAcknowledgeAlarms } from "../../lib/admin-access";
import {
  alarmBarScopeKey,
  alarmBarScopeLabel,
  alarmBarScopeOf,
  alarmLocationLabel,
  countsByRankDescending,
  newestUnacknowledged,
} from "../../lib/alarm-bar";
import { alarmBarFeed } from "../../lib/alarm-bar-feed";
import { alarmSubjectName } from "../../lib/alarm-source";
import { useAlarmBarStore } from "../../stores/alarm-bar-store";
import { useAuthStore } from "../../stores/auth-store";
import { AlarmAckWizard } from "../alarm-ack-wizard";
import { AlarmBarList } from "./alarm-bar-list";
import { AlarmBarPopup } from "./alarm-bar-popup";

/** The colour of one count, from the summary row's own `tone` (ADR 0110 roles; no vocabulary read). */
const COUNT_TONE: Record<AlarmSeverityCount["tone"], string> = {
  critical: "border-critical-line bg-critical-wash-strong text-critical-ink-strong",
  warning: "border-warning-line bg-warning-wash-strong text-warning-ink",
  info: "border-info-line bg-info-wash text-info-ink",
  offline: "border-line bg-well-deep text-neutral-ink",
  ok: "border-ok/20 bg-ok/10 text-ok-ink",
};

/**
 * `F4.357` U5 (ADR 0130 decisions 1–5, 14, 19) — the alarm bar, fixed to the
 * bottom edge of every authenticated page. `AppShell` mounts it.
 *
 * Left to right: one count per severity in the page's scope (rank descending),
 * the newest unacknowledged alarm of the highest rank, **Acknowledge** for it
 * (an operator, not a viewer), and **All alarms**, which opens the scoped list
 * upward. It has no hide control (decision 3); a modal at `z-50` covers it
 * while open (plan Q5).
 *
 * The state lives in the root store and the installed feed (plan D4), not
 * here: every page mounts `AppShell` afresh. With no feed installed — every
 * spec that renders the shell — it renders nothing and starts nothing.
 */
export function AlarmBar() {
  const feed = alarmBarFeed();
  const { pathname } = useLocation();
  const scope = alarmBarScopeOf(pathname);
  const scopeKey = alarmBarScopeKey(scope);
  const list = useAlarmBarStore((state) => state.list);
  const summary = useAlarmBarStore((state) => state.summary);
  const status = useAlarmBarStore((state) => state.feed);
  const role = useAuthStore((state) => state.user?.role);
  const [listOpen, setListOpen] = useState(false);
  const [acknowledging, setAcknowledging] = useState<AlarmListItem | null>(null);

  useEffect(() => {
    feed?.setScope(scope);
    // The key names the scope; the object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, scopeKey]);

  if (feed === null) return null;

  const newest = list === null ? null : newestUnacknowledged(list);
  const counts = summary === null ? [] : countsByRankDescending(summary);
  const mayAcknowledge = role !== undefined && canAcknowledgeAlarms(role);

  return (
    <>
      <div
        role="region"
        aria-label="Alarms"
        className="surface-raised fixed inset-x-0 bottom-0 z-40 flex h-[var(--alarm-bar-h)] items-center gap-3 overflow-hidden px-4 text-xs text-ink"
      >
        <ul className="flex shrink-0 items-center gap-1.5" aria-label="Active alarms by severity">
          {counts.map((row) => (
            <li
              key={row.code}
              className={`surface-pill inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold ${COUNT_TONE[row.tone]}`}
            >
              <span>{row.label}</span>
              <span className="tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {status === "stale" ? (
            <span className="font-semibold text-warning-ink">Alarms not updating</span>
          ) : summary !== null && summary.total === 0 ? (
            <span className="text-ink-muted">No active alarms</span>
          ) : newest !== null ? (
            <span className="hidden md:inline">
              <span className="font-semibold">{newest.message}</span>
              {" · "}
              {[alarmSubjectName(newest), alarmLocationLabel(newest), new Date(newest.raisedAt).toLocaleString()]
                .filter((part) => part !== null && part !== "")
                .join(" · ")}
            </span>
          ) : null}
        </span>
        {newest !== null && mayAcknowledge ? (
          <button
            type="button"
            onClick={() => setAcknowledging(newest)}
            className="surface-button shrink-0 rounded px-2 py-1 font-semibold"
          >
            Acknowledge
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls="alarm-bar-list"
          onClick={() => setListOpen((open) => !open)}
          className="surface-button shrink-0 rounded px-2 py-1 font-semibold"
        >
          All alarms
        </button>
      </div>
      {/* U6 (decisions 6-8): renders nothing while no unseen alarm of popup rank is unacknowledged. */}
      <AlarmBarPopup feed={feed} readOnly={!mayAcknowledge} />
      {listOpen ? (
        <AlarmBarList
          scope={scope}
          scopeLabel={alarmBarScopeLabel(scope, pathname)}
          readOnly={!mayAcknowledge}
          onClose={() => setListOpen(false)}
        />
      ) : null}
      {acknowledging !== null
        ? createPortal(
            <AlarmAckWizard
              alarm={acknowledging}
              onCancel={() => setAcknowledging(null)}
              onDone={() => {
                setAcknowledging(null);
                feed.refreshNow();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}
