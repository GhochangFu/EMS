import type { AlarmListItem, AlarmSummaryResponse } from "@bms/shared";
import { create } from "zustand";

import type { AlarmBarScope } from "../lib/alarm-bar";

/**
 * `F4.357` (ADR 0130 decisions 13, 16, 21) — the alarm bar's state, per tab,
 * held at the app root so it outlives `AppShell`, which every page mounts
 * afresh. Not persisted: a reload starts empty, so every unacknowledged alarm
 * is unseen again (decision 21). Only `lib/alarm-bar-feed.ts` writes it.
 *
 * - `scope` — the page's scope (decision 5); the feed reads for it.
 * - `list` — the scope's unacknowledged alarms of popup rank, highest rank
 *   first (plan Q1); `null` until the first answer for this scope.
 * - `summary` — the scope's active counts per severity; `null` likewise.
 * - `feed` — `"stale"` after a failed read or a lost socket (plan D15).
 * - `seenIds` — the alarms this tab's popup has shown and the operator closed
 *   (U6, plan D5). Kept across pages and token renewals; a session end, a
 *   login or a reload starts it empty (decision 21).
 */
export type AlarmBarState = {
  readonly scope: AlarmBarScope;
  readonly list: readonly AlarmListItem[] | null;
  readonly summary: AlarmSummaryResponse | null;
  readonly feed: "live" | "stale";
  readonly seenIds: ReadonlySet<string>;
};

/** The state of a tab with no session, or a fresh one. */
export const INITIAL_ALARM_BAR_STATE: AlarmBarState = {
  scope: { kind: "all" },
  list: null,
  summary: null,
  feed: "live",
  seenIds: new Set<string>(),
};

export const useAlarmBarStore = create<AlarmBarState>()(() => INITIAL_ALARM_BAR_STATE);
