import type { AlarmListItem, AlarmsListResponse, AlarmSummaryResponse } from "@bms/shared";

import type { AlarmReadScope } from "../api/alarms";
import { INITIAL_ALARM_BAR_STATE, useAlarmBarStore } from "../stores/alarm-bar-store";
import {
  type AlarmBarScope,
  alarmBarScopeKey,
  alarmReadScopeOf,
  criticalUnacknowledgedIds,
  popupRows,
  toneWanted,
} from "./alarm-bar";
import type { AlarmTonePort } from "./alarm-tone";
import { apiErrorMessage } from "./api-error-message";
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
 *   later. A read that does not answer in 15 s is a failure.
 * - **The socket.** A lost or refused socket also reads `"stale"`, and a
 *   successful read does not hide it: only a (re)connect lets the next read
 *   say `"live"` again, because without the socket no event arrives.
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
/** Plan D8 (decision 10): the tone repeats this often while a critical alarm is unacknowledged and unmuted. */
export const ALARM_TONE_REPEAT_MS = 30_000;
/** A read that has not answered by now counts as failed (D15), so one hung request cannot stop the feed. */
export const ALARM_BAR_READ_TIMEOUT_MS = 15_000;

/** What the socket reports back to the feed (`disconnect` covers a refused connect too). */
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
  /** The existing `POST /api/v1/alarms/:id/ack` (U6; no bulk endpoint, decision 8). */
  readonly acknowledge: (id: string, reason: string) => Promise<AlarmListItem>;
  /** U8: the Web Audio tone (`alarm-tone.ts`). */
  readonly tone: AlarmTonePort;
};

/** What one Acknowledge or Acknowledge all did: how many succeeded, and each failure's message. */
export type AlarmBarAcknowledgeResult = {
  readonly done: number;
  readonly failed: readonly { readonly id: string; readonly message: string }[];
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
  /** U6 (decision 8): Close — the popup's current rows are seen; they stay on the bar, unacknowledged. */
  closePopup(): void;
  /**
   * U6 (decisions 8, 18): one acknowledge per id, in order, one at a time, with the same reason;
   * a failure is kept with its message and the rest go on; then a read. A run stops sending when
   * its session ends, and reports the rest as not sent.
   */
  acknowledge(ids: readonly string[], reason: string): Promise<AlarmBarAcknowledgeResult>;
  /** U8 (decision 11): silences the critical alarms that exist now — never the next one. */
  mute(): void;
  /** U8 (decision 11): "Sound blocked — click to enable": resumes audio inside the click, then plays if still wanted. */
  unlockSound(): Promise<void>;
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
  // Set by a disconnect or a refused connect, cleared by a connect: the bar is "live" only with a socket.
  let socketDown = false;
  // U8 (plan D8): the 30 s repeat, or null while no cycle runs.
  let toneTimer: ReturnType<typeof setInterval> | null = null;
  // Bumped by every session end: a run started in one session never sends in the next.
  let generation = 0;

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
    let timeout: Timer | null = null;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("alarm bar read timed out")), ALARM_BAR_READ_TIMEOUT_MS);
    });
    Promise.race([Promise.all([ports.fetchList(readScope), ports.fetchSummary(readScope)]), timedOut])
      .then(([list, summary]) => {
        if (number !== request || key !== alarmBarScopeKey(store.getState().scope)) return;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        store.setState({ list: list.items, summary, feed: socketDown ? "stale" : "live" });
        evaluateTone();
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
        if (timeout !== null) clearTimeout(timeout);
        inFlight -= 1;
        if (inFlight === 0 && pendingAfterFlight) {
          pendingAfterFlight = false;
          read();
        }
      });
  }

  /**
   * U8: plays once. "Sound blocked — click to enable" follows the latest answer, so a tone that
   * plays (a click elsewhere unlocked audio) clears it. A tone that throws (no audio device, a
   * restricted browser) counts as blocked; it must never reach the read's failure path.
   */
  function playTone(): void {
    let answer: "played" | "blocked";
    try {
      answer = ports.tone.play();
    } catch {
      answer = "blocked";
    }
    if (store.getState().soundBlocked !== (answer === "blocked")) store.setState({ soundBlocked: answer === "blocked" });
  }

  function stopTone(): void {
    if (toneTimer !== null) clearInterval(toneTimer);
    toneTimer = null;
  }

  /**
   * Plan D8, after every list update and on every tick: wanted and no cycle — play now and repeat
   * every 30 s; a cycle already running — nothing extra (more critical alarms add no tones); not
   * wanted — stop. A tick with no list yet (a scope change in flight) plays nothing and keeps the
   * cycle, so a scope change keeps the cadence.
   */
  function evaluateTone(): void {
    const { list, mutedIds } = store.getState();
    if (list === null) return;
    if (!toneWanted(list, mutedIds)) {
      stopTone();
      return;
    }
    if (toneTimer !== null) return;
    playTone();
    toneTimer = setInterval(() => {
      const now = store.getState();
      if (now.list === null) return;
      if (toneWanted(now.list, now.mutedIds)) playTone();
      else stopTone();
    }, ALARM_TONE_REPEAT_MS);
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
      connect: () => {
        socketDown = false;
        schedule();
      },
      disconnect: () => {
        socketDown = true;
        store.setState({ feed: "stale" });
      },
    });
  }

  function close(): void {
    socket?.close();
    socket = null;
  }

  /**
   * A session ended or changed hands: nothing of the last one survives but the page's scope, which
   * belongs to the page the bar is on, not to the session (a mounted bar re-sends it only when its
   * path changes).
   */
  function endSession(): void {
    close();
    clearTimers();
    stopTone();
    token = null;
    generation += 1;
    socketDown = false;
    request += 1;
    pendingAfterFlight = false;
    // `seenIds` goes with the session: a login treats every unacknowledged alarm as unseen (decision 21).
    store.setState(
      {
        ...INITIAL_ALARM_BAR_STATE,
        seenIds: new Set<string>(),
        mutedIds: new Set<string>(),
        soundBlocked: false,
        scope: store.getState().scope,
      },
      true,
    );
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
    closePopup() {
      const state = store.getState();
      if (state.list === null) return;
      const shown = popupRows(state.list, state.seenIds).map((alarm) => alarm.id);
      store.setState({ seenIds: new Set([...state.seenIds, ...shown]) });
    },
    // Mutes the critical alarms in the list — at most 50 (Q1). In a storm of more than 50
    // unacknowledged critical alarms at once, one beyond the list is not muted and sounds when it
    // enters the list (a consequence of D9 and the 50-row read, recorded in the build record).
    mute() {
      const { list, mutedIds } = store.getState();
      if (list === null) return;
      store.setState({ mutedIds: new Set([...mutedIds, ...criticalUnacknowledgedIds(list)]) });
      evaluateTone();
    },
    async unlockSound() {
      await ports.tone.unlock();
      store.setState({ soundBlocked: false });
      // Play now and restart the 30 s cadence from this tone, so no second tone follows at once.
      stopTone();
      evaluateTone();
    },
    async acknowledge(ids, reason) {
      let done = 0;
      const failed: { id: string; message: string }[] = [];
      const started = generation;
      for (const id of ids) {
        // Security review (PR 3): the requests read the current token, so a run must not outlive
        // its session — the rest would be sent, and audited, as the next user.
        if (generation !== started || token === null) {
          failed.push({ id, message: "Not sent: the session ended." });
          continue;
        }
        try {
          await ports.acknowledge(id, reason);
          done += 1;
        } catch (cause) {
          failed.push({ id, message: apiErrorMessage(cause) });
        }
      }
      read();
      return { done, failed };
    },
  };

  return () => {
    unsubscribe();
    endSession();
    store.setState(INITIAL_ALARM_BAR_STATE, true);
    installed = null;
  };
}
