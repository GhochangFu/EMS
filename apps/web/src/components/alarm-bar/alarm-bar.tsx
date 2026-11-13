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
  blinkingSeverityCodes,
  countsByRankDescending,
  criticalUnacknowledgedIds,
  newestUnacknowledged,
  toneWanted,
} from "../../lib/alarm-bar";
import { alarmBarFeed } from "../../lib/alarm-bar-feed";
import { alarmSubjectName } from "../../lib/alarm-source";
import { useAlarmBarStore } from "../../stores/alarm-bar-store";
import { useAuthStore } from "../../stores/auth-store";
import { AlarmAckWizard } from "../alarm-ack-wizard";
import { AlarmBarList } from "./alarm-bar-list";
import { AlarmBarMaintenance } from "./alarm-bar-maintenance";
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
  const seenIds = useAlarmBarStore((state) => state.seenIds);
  const mutedIds = useAlarmBarStore((state) => state.mutedIds);
  const soundBlocked = useAlarmBarStore((state) => state.soundBlocked);
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
  const blinking = list === null ? new Set<string>() : blinkingSeverityCodes(list, seenIds);
  // U8 (decisions 10, 11): the tone sounds while a critical alarm is unacknowledged and not muted.
  const sounding = list !== null && toneWanted(list, mutedIds);
  const muted = list !== null && !sounding && criticalUnacknowledgedIds(list).length > 0;
  const mayAcknowledge = role !== undefined && canAcknowledgeAlarms(role);

  return (
    <>
      <div
        role="region"
        aria-label="Alarms"
        // Plan Q6: on the wall, a pointer on the bar's controls does not pause the rotation.
        data-wall-bar
        className="surface-raised fixed inset-x-0 bottom-0 z-40 flex h-[var(--alarm-bar-h)] items-center gap-3 overflow-hidden px-4 text-xs text-ink"
      >
        <ul className="flex shrink-0 items-center gap-1.5" aria-label="Active alarms by severity">
          {counts.map((row) => (
            <li
              key={row.code}
              // Amendment 1: the active count, then the unacknowledged one (acknowledging lowers only it).
              aria-label={`${row.label}: ${row.count} active, ${row.unacknowledged} unacknowledged`}
              // U7 (decision 9): the one uniform blink, identical in every design system (index.css).
              data-blink={blinking.has(row.code) ? "true" : undefined}
              className={`surface-pill inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold ${COUNT_TONE[row.tone]}${blinking.has(row.code) ? " alarm-bar-blink" : ""}`}
            >
              <span>{row.label}</span>
              <span className="tabular-nums">{row.count}</span>
              <span className="font-normal tabular-nums">{` · ${row.unacknowledged} unacked`}</span>
            </li>
          ))}
        </ul>
        {/*
          F4.359 U13 (ADR 0131 decision 15): "Maintenance N" beside the counts, while a window touches
          the scope. Below the early return, so its windows read runs only with a feed installed.
        */}
        <AlarmBarMaintenance scope={scope} suppressed={summary === null ? null : summary.suppressed} />
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
        {soundBlocked && sounding ? (
          <button
            type="button"
            // A refused resume leaves the button up; nothing else to do with it.
            onClick={() => void feed.unlockSound().catch(() => undefined)}
            className="surface-button shrink-0 rounded px-2 py-1 font-semibold text-critical-ink"
          >
            Sound blocked — click to enable
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={muted}
          disabled={!sounding}
          onClick={() => feed.mute()}
          className="surface-button shrink-0 rounded px-2 py-1 font-semibold"
        >
          {muted ? "Muted" : "Mute"}
        </button>
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
      {listOpen ? (
        <AlarmBarList
          scope={scope}
          scopeLabel={alarmBarScopeLabel(scope, pathname)}
          readOnly={!mayAcknowledge}
          onClose={() => setListOpen(false)}
        />
      ) : null}
      {/*
        U6 (decisions 6-8): renders nothing while no unseen alarm of popup rank is unacknowledged.
        After the list, so it paints above an open All alarms list and Close stays reachable.
      */}
      <AlarmBarPopup feed={feed} readOnly={!mayAcknowledge} />
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
