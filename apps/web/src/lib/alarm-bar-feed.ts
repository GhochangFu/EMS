import type { AlarmsListResponse, AlarmSummaryResponse } from "@bms/shared";

import type { AlarmReadScope } from "../api/alarms";
import { INITIAL_ALARM_BAR_STATE, useAlarmBarStore } from "../stores/alarm-bar-store";
import { type AlarmBarScope, alarmBarScopeKey, alarmReadScopeOf } from "./alarm-bar";
import { sessionChanged } from "./query-cache-session";

/**
 * `F4.357` U4 (ADR 0130 decisions 13 and 16) — the alarm bar's feed: one
 * `/ws/alarms` socket per tab, and the scoped reads it triggers.
 *
 * The server decides scope; the browser never filters events (decision 16).
 * Every socket event and every (re)connect refetches the scope's unacknowledged
 * list and its summary, so descendant locations need no client lookup and a
 * reconnect catches an event missed while disconnected.
 *
 * - **D6, the refetch.** The first event arms a 1 s timer; later events do not
 *   re-arm it, so an alarm storm still refetches once a second (a pure debounce
 *   would never fire). An event whose timer fires while a read is in flight is
 *   answered by one more read when that one ends.
 * - **D7, the drop.** Every read carries its request number and scope key; an
 *   answer that is not the latest, or is for another scope, is dropped.
 * - **D15, a failure.** The last list and summary stay, the feed reads
 *   `"stale"` (the bar says "Alarms not updating"), and one retry runs 30 s
 *   later.
 *
 * Installed once at module level in `main.tsx` (plan D4), beside
 * `bindSessionStores`. Not installed — in every spec that renders `AppShell` —
 * `AlarmBar` renders nothing and nothing opens.
 *
 * The browser half is `alarm-bar-ports.ts`; this file holds no socket, no
 * fetch and no timer source other than the global one, so its spec runs on
 * fake ports and `vi.useFakeTimers()`.
 */

/** Plan D6: the refetch window. */
export const ALARM_BAR_REFETCH_MS = 1_000;
/** Plan D15: the wait before a failed read is retried. */
export const ALARM_BAR_RETRY_MS = 30_000;

/** What the socket reports back to the feed. */
export type AlarmBarSocketHandlers = {
  readonly event: () => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
};

/** The feed's outside world: a socket and the two reads (`alarm-bar-ports.ts` in the browser). */
export type AlarmBarPorts = {
  readonly openSocket: (token: string, on: AlarmBarSocketHandlers) => { close(): void };
  readonly fetchList: (scope: AlarmReadScope) => Promise<AlarmsListResponse>;
  readonly fetchSummary: (scope: AlarmReadScope) => Promise<AlarmSummaryResponse>;
};

/** The session store the feed follows (`useAuthStore`'s shape). */
export type AlarmBarSessionStore = {
  getState(): AlarmBarSession;
  subscribe(listener: (state: AlarmBarSession, prev: AlarmBarSession) => void): () => void;
};

type AlarmBarSession = { readonly accessToken: string | null; readonly user: { readonly id: string } | null };

/** What the bar calls on the installed feed. */
export type AlarmBarFeed = {
  /** Decision 5: the page's scope. The same key is a no-op; another clears the list and reads at once. */
  setScope(scope: AlarmBarScope): void;
  /** Reads now — after an acknowledge, say. */
  refreshNow(): void;
};

let installed: AlarmBarFeed | null = null;

/** The installed feed, or `null` (every spec that renders `AppShell` without installing one). */
export function alarmBarFeed(): AlarmBarFeed | null {
  return installed;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Installs the tab's one feed on `session` and returns the uninstall. A
 * second install while one is installed is refused: it opens nothing and
 * returns a no-op (one socket per tab).
 */
export function installAlarmBarFeed(session: AlarmBarSessionStore, ports: AlarmBarPorts): () => void {
  if (installed !== null) return () => undefined;

  let socket: { close(): void } | null = null;
  let token: string | null = null;
  let request = 0;
  let inFlight = 0;
  let pendingAfterFlight = false;
  let refetchTimer: Timer | null = null;
  let retryTimer: Timer | null = null;

  const store = useAlarmBarStore;

  function clearTimers(): void {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    refetchTimer = null;
    retryTimer = null;
  }

  function read(): void {
    if (token === null) return;
    const number = ++request;
    const scope = store.getState().scope;
    const key = alarmBarScopeKey(scope);
    const readScope = alarmReadScopeOf(scope);
    inFlight += 1;
    Promise.all([ports.fetchList(readScope), ports.fetchSummary(readScope)])
      .then(([list, summary]) => {
        if (number !== request || key !== alarmBarScopeKey(store.getState().scope)) return;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        store.setState({ list: list.items, summary, feed: "live" });
      })
      .catch(() => {
        if (number !== request) return;
        store.setState({ feed: "stale" });
        if (retryTimer === null) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            read();
          }, ALARM_BAR_RETRY_MS);
        }
      })
      .finally(() => {
        inFlight -= 1;
        if (inFlight === 0 && pendingAfterFlight) {
          pendingAfterFlight = false;
          read();
        }
      });
  }

  /** D6: arm once; a later event inside the window does not re-arm. */
  function schedule(): void {
    if (refetchTimer !== null) return;
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      if (inFlight > 0) {
        pendingAfterFlight = true;
        return;
      }
      read();
    }, ALARM_BAR_REFETCH_MS);
  }

  function open(nextToken: string): void {
    token = nextToken;
    socket = ports.openSocket(nextToken, {
      event: schedule,
      connect: schedule,
      disconnect: () => store.setState({ feed: "stale" }),
    });
  }

  function close(): void {
    socket?.close();
    socket = null;
  }

  /** A session ended or changed hands: nothing of the last one survives. */
  function endSession(): void {
    close();
    clearTimers();
    token = null;
    request += 1;
    pendingAfterFlight = false;
    store.setState(INITIAL_ALARM_BAR_STATE, true);
  }

  function follow(state: AlarmBarSession, prev: AlarmBarSession): void {
    if (sessionChanged(state, prev)) endSession();
    if (state.accessToken === null) return;
    if (socket === null) {
      open(state.accessToken);
      read();
    } else if (state.accessToken !== token) {
      // The same user's renewed token: the handshake needs it, the state stays.
      close();
      open(state.accessToken);
    }
  }

  const unsubscribe = session.subscribe(follow);
  const initial = session.getState();
  if (initial.accessToken !== null) {
    open(initial.accessToken);
    read();
  }

  installed = {
    setScope(scope) {
      if (alarmBarScopeKey(scope) === alarmBarScopeKey(store.getState().scope)) return;
      store.setState({ scope, list: null, summary: null });
      read();
    },
    refreshNow: read,
  };

  return () => {
    unsubscribe();
    endSession();
    installed = null;
  };
}
