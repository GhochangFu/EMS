import type { AlarmListItem, AlarmsListResponse, AlarmSummaryResponse } from "@bms/shared";
import { expect, vi } from "vitest";
import { create } from "zustand";

import type { AlarmReadScope } from "../api/alarms";
import { useAlarmBarStore } from "../stores/alarm-bar-store";
import { popupRows } from "./alarm-bar";
import { alarmItem } from "./alarm-bar.spec";
import {
  ALARM_BAR_READ_TIMEOUT_MS,
  ALARM_BAR_REFETCH_MS,
  ALARM_BAR_RETRY_MS,
  alarmBarFeed,
  type AlarmBarPorts,
  type AlarmBarSocketHandlers,
  installAlarmBarFeed,
} from "./alarm-bar-feed";

/**
 * `F4.357` U4 (ADR 0130 decisions 13, 16; plan D6, D7, D15) — the feed, on
 * fake ports and fake timers. The fakes are exported: the bar's component
 * specs install a feed over them. Vitest entry point: `alarm-bar-feed.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

/** A deferred answer, so a case can hold a read in flight. */
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const EMPTY_SUMMARY: AlarmSummaryResponse = {
  total: 0,
  items: [
    { code: "info", label: "Info", tone: "info", rank: 10, count: 0, unacknowledged: 0 },
    { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 0, unacknowledged: 0 },
    { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 0, unacknowledged: 0 },
  ],
};

/** Fake ports: a recorded socket and two reads that answer `answer.list` / `answer.summary`; `holdNext` holds the next list read only. */
export function fakeAlarmBarPorts(answer: { list?: readonly AlarmListItem[]; summary?: AlarmSummaryResponse } = {}) {
  const sockets: { token: string; on: AlarmBarSocketHandlers; closed: boolean }[] = [];
  const listCalls: AlarmReadScope[] = [];
  const summaryCalls: AlarmReadScope[] = [];
  const ackCalls: { id: string; reason: string }[] = [];
  const refuse = new Map<string, string>();
  let ackInFlight = 0;
  let ackOverlap = false;
  const current = { list: answer.list ?? [], summary: answer.summary ?? EMPTY_SUMMARY };
  let hold: Deferred<AlarmsListResponse> | null = null;
  let failNext = 0;
  const ports: AlarmBarPorts = {
    openSocket(token, on) {
      const entry = { token, on, closed: false };
      sockets.push(entry);
      return { close: () => void (entry.closed = true) };
    },
    fetchList(scope) {
      listCalls.push(scope);
      if (failNext > 0) {
        failNext -= 1;
        return Promise.reject(new Error("alarms 503"));
      }
      if (hold !== null) {
        const held = hold;
        hold = null;
        return held.promise;
      }
      return Promise.resolve({ items: [...current.list], nextCursor: null });
    },
    fetchSummary(scope) {
      summaryCalls.push(scope);
      return Promise.resolve(current.summary);
    },
    async acknowledge(id, reason) {
      ackCalls.push({ id, reason });
      ackInFlight += 1;
      if (ackInFlight > 1) ackOverlap = true;
      await Promise.resolve();
      ackInFlight -= 1;
      const refusal = refuse.get(id);
      if (refusal !== undefined) throw new Error(refusal);
      return alarmItem({ id, acknowledgedAt: "2026-11-12T12:00:00.000Z" });
    },
  };
  return {
    ports,
    sockets,
    listCalls,
    summaryCalls,
    ackCalls,
    /** True when two acknowledge calls ever ran at once. */
    ackOverlapped: () => ackOverlap,
    /** The acknowledge of `id` fails with `message`. */
    refuseAcknowledge(id: string, message: string) {
      refuse.set(id, message);
    },
    /** The next list answers: what the server holds now. */
    answer(next: { list?: readonly AlarmListItem[]; summary?: AlarmSummaryResponse }) {
      if (next.list) current.list = next.list;
      if (next.summary) current.summary = next.summary;
    },
    /** Holds the next list read until the returned deferred settles. */
    holdNext(): Deferred<AlarmsListResponse> {
      const held = deferred<AlarmsListResponse>();
      hold = held;
      return held;
    },
    failNext(n = 1) {
      failNext = n;
    },
    /** The open socket's handlers (the last one opened). */
    socket(): AlarmBarSocketHandlers {
      const open = sockets.filter((s) => !s.closed);
      const last = open[open.length - 1];
      if (!last) throw new Error("no open socket");
      return last.on;
    },
  };
}

type Session = { accessToken: string | null; user: { id: string } | null };

/** A session store of the auth store's shape, signed in as `user-1`. */
export function fakeSession(initial: Session = { accessToken: "token-1", user: { id: "user-1" } }) {
  return create<Session>()(() => initial);
}

/** Lets the microtasks of resolved reads run (fake timers do not). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** Installs a feed on fakes; returns them with the uninstall. The caller uninstalls in `finally`. */
export function installOnFakes(answer?: Parameters<typeof fakeAlarmBarPorts>[0], session = fakeSession()) {
  const fake = fakeAlarmBarPorts(answer);
  const uninstall = installAlarmBarFeed(session, fake.ports);
  return { ...fake, session, uninstall };
}

async function withFeed(run: (f: ReturnType<typeof installOnFakes>) => Promise<void>, answer?: Parameters<typeof fakeAlarmBarPorts>[0]) {
  vi.useFakeTimers();
  const f = installOnFakes(answer);
  try {
    await run(f);
  } finally {
    f.uninstall();
    vi.useRealTimers();
  }
}

/** A token opens one socket with it, and reads the list and the summary once, in the all scope. */
export async function aTokenOpensOneSocketAndReadsOnce(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    expect(f.sockets.map((s) => s.token)).toEqual(["token-1"]);
    expect({ list: f.listCalls, summary: f.summaryCalls }).toEqual({ list: [[]], summary: [[]] });
    expect(useAlarmBarStore.getState().summary).toEqual(EMPTY_SUMMARY);
  });
}

/** `setScope` reads the new scope at once; the old scope's late answer does not replace the new list. */
export async function aScopeChangeReadsAtOnceAndDropsALateAnswer(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    const late = f.holdNext();
    alarmBarFeed()?.refreshNow();
    f.answer({ list: [alarmItem({ id: "org-alarm" })] });
    alarmBarFeed()?.setScope({ kind: "organization", organizationId: ORG });
    expect(f.listCalls.at(-1)).toEqual({ organizationId: ORG });
    expect(f.summaryCalls.at(-1)).toEqual({ organizationId: ORG });
    await flush();
    late.resolve({ items: [alarmItem({ id: "old-scope" })], nextCursor: null });
    await flush();
    expect(useAlarmBarStore.getState().list?.map((a) => a.id)).toEqual(["org-alarm"]);
    const reads = f.listCalls.length;
    alarmBarFeed()?.setScope({ kind: "organization", organizationId: ORG });
    expect(f.listCalls.length, "the same scope reads nothing").toBe(reads);
  });
}

/** D6 — five events inside 300 ms: nothing at 999 ms, one read of each at 1,000 ms. */
export async function aBurstReadsOnceAfterOneSecond(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    const before = f.listCalls.length;
    for (let i = 0; i < 5; i += 1) {
      f.socket().event();
      await vi.advanceTimersByTimeAsync(60);
    }
    await vi.advanceTimersByTimeAsync(ALARM_BAR_REFETCH_MS - 1 - 300);
    expect(f.listCalls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect({ list: f.listCalls.length - before, summary: f.summaryCalls.length - before }).toEqual({ list: 1, summary: 1 });
  });
}

/** D6 — an event every 400 ms: the window does not re-arm, so reads keep coming (three by 3.5 s). */
export async function aStormStillReadsEverySecond(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    const before = f.listCalls.length;
    for (let t = 0; t < 3_500; t += 400) {
      f.socket().event();
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(f.listCalls.length - before).toBeGreaterThanOrEqual(3);
  });
}

/** A (re)connect reads; an event whose window ends during a read in flight gives exactly one more read. */
export async function aConnectReadsAndAnInFlightEventReadsOnceMore(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    const before = f.listCalls.length;
    f.socket().connect();
    await vi.advanceTimersByTimeAsync(ALARM_BAR_REFETCH_MS);
    expect(f.listCalls.length - before, "connect reads").toBe(1);
    const held = f.holdNext();
    alarmBarFeed()?.refreshNow();
    f.socket().event();
    await vi.advanceTimersByTimeAsync(ALARM_BAR_REFETCH_MS);
    expect(f.listCalls.length - before, "no read while one is in flight").toBe(2);
    held.resolve({ items: [], nextCursor: null });
    await flush();
    expect(f.listCalls.length - before, "one more after it").toBe(3);
  });
}

/** D15 — a failed read: stale, the list kept, one retry at 30 s, then live. */
export async function aFailedReadIsStaleAndRetries(): Promise<void> {
  await withFeed(
    async (f) => {
      await flush();
      expect(useAlarmBarStore.getState().list?.map((a) => a.id)).toEqual(["kept"]);
      f.failNext();
      alarmBarFeed()?.refreshNow();
      await flush();
      expect(useAlarmBarStore.getState().feed).toBe("stale");
      expect(useAlarmBarStore.getState().list?.map((a) => a.id)).toEqual(["kept"]);
      const before = f.listCalls.length;
      await vi.advanceTimersByTimeAsync(ALARM_BAR_RETRY_MS - 1);
      expect(f.listCalls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.listCalls.length).toBe(before + 1);
      expect(useAlarmBarStore.getState().feed).toBe("live");
    },
    { list: [alarmItem({ id: "kept" })] },
  );
}

/** A lost socket marks the feed stale. */
export async function aDisconnectMarksTheFeedStale(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    f.socket().disconnect();
    expect(useAlarmBarStore.getState().feed).toBe("stale");
  });
}

/** The same user's renewed token: the socket closes and reopens with it; the list stays. */
export async function aRenewedTokenReopensTheSocketAndKeepsTheList(): Promise<void> {
  await withFeed(
    async (f) => {
      await flush();
      f.session.setState({ accessToken: "token-2", user: { id: "user-1" } });
      expect(f.sockets.map((s) => [s.token, s.closed])).toEqual([
        ["token-1", true],
        ["token-2", false],
      ]);
      expect(useAlarmBarStore.getState().list?.map((a) => a.id)).toEqual(["a1"]);
    },
    { list: [alarmItem({ id: "a1" })] },
  );
}

/** A session end: the socket closes, no timer is left, the store is reset but for the page's scope. */
export async function aSessionEndLeavesNothing(): Promise<void> {
  await withFeed(
    async (f) => {
      await flush();
      alarmBarFeed()?.setScope({ kind: "organization", organizationId: ORG });
      await flush();
      f.socket().event();
      f.failNext();
      alarmBarFeed()?.refreshNow();
      await flush();
      f.session.setState({ accessToken: null, user: null });
      expect(f.sockets.every((s) => s.closed)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(useAlarmBarStore.getState()).toMatchObject({
        list: null,
        summary: null,
        feed: "live",
        scope: { kind: "organization", organizationId: ORG },
      });
      f.session.setState({ accessToken: "token-2", user: { id: "user-2" } });
      expect(f.listCalls.at(-1), "the next session reads the page's scope").toEqual({ organizationId: ORG });
    },
    { list: [alarmItem()] },
  );
}

/** A second install opens no second socket. */
export async function aSecondInstallOpensNothing(): Promise<void> {
  await withFeed(async (f) => {
    const second = fakeAlarmBarPorts();
    const undo = installAlarmBarFeed(fakeSession(), second.ports);
    undo();
    expect({ first: f.sockets.length, second: second.sockets.length }).toEqual({ first: 1, second: 0 });
    expect(alarmBarFeed(), "the first feed is still installed").not.toBeNull();
  });
}

/** Signed out at install: nothing opens until a sign-in, which opens and reads. */
export async function aSignInOpensTheSocket(): Promise<void> {
  vi.useFakeTimers();
  const f = installOnFakes(undefined, fakeSession({ accessToken: null, user: null }));
  try {
    expect(f.sockets.length).toBe(0);
    f.session.setState({ accessToken: "token-9", user: { id: "user-9" } });
    expect(f.sockets.map((s) => s.token)).toEqual(["token-9"]);
    expect(f.listCalls.length).toBe(1);
  } finally {
    f.uninstall();
    vi.useRealTimers();
  }
}

/** D7 — within one scope, an older read that answers after a newer one is dropped, and its failure too. */
export async function anOlderReadOfTheSameScopeIsDropped(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    const older = f.holdNext();
    alarmBarFeed()?.refreshNow();
    f.answer({ list: [] });
    alarmBarFeed()?.refreshNow();
    await flush();
    older.resolve({ items: [alarmItem({ id: "acknowledged-since" })], nextCursor: null });
    await flush();
    expect(useAlarmBarStore.getState().list).toEqual([]);
    const failing = f.holdNext();
    alarmBarFeed()?.refreshNow();
    alarmBarFeed()?.refreshNow();
    await flush();
    failing.reject(new Error("alarms 503"));
    await flush();
    expect(useAlarmBarStore.getState().feed, "an older read's failure marks nothing").toBe("live");
    expect(vi.getTimerCount(), "and arms no retry").toBe(0);
  });
}

/** A lost socket stays stale through a successful read; a reconnect's read is live again. */
export async function aReadDoesNotHideALostSocket(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    f.socket().disconnect();
    alarmBarFeed()?.refreshNow();
    await flush();
    expect(useAlarmBarStore.getState().feed).toBe("stale");
    f.socket().connect();
    await vi.advanceTimersByTimeAsync(ALARM_BAR_REFETCH_MS);
    expect(useAlarmBarStore.getState().feed).toBe("live");
  });
}

/** A read that never answers fails at 15 s: stale, then the 30 s retry, and events read again. */
export async function aHungReadFailsAndTheFeedRecovers(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    f.holdNext();
    alarmBarFeed()?.refreshNow();
    await vi.advanceTimersByTimeAsync(ALARM_BAR_READ_TIMEOUT_MS);
    expect(useAlarmBarStore.getState().feed).toBe("stale");
    const before = f.listCalls.length;
    f.socket().event();
    await vi.advanceTimersByTimeAsync(ALARM_BAR_REFETCH_MS);
    expect(f.listCalls.length, "an event reads again once the hung read has failed").toBe(before + 1);
    expect(useAlarmBarStore.getState().feed).toBe("live");
  });
}

const popupIds = (): string[] => {
  const state = useAlarmBarStore.getState();
  return state.list === null ? [] : popupRows(state.list, state.seenIds).map((alarm) => alarm.id);
};

/** U6 — Close marks the shown rows seen; a later list's new id is the only popup row. */
export async function closeMarksTheShownRowsSeen(): Promise<void> {
  await withFeed(
    async (f) => {
      await flush();
      expect(popupIds()).toEqual(["a1"]);
      alarmBarFeed()?.closePopup();
      expect(popupIds()).toEqual([]);
      expect(useAlarmBarStore.getState().list?.map((a) => a.id), "the alarm stays on the bar").toEqual(["a1"]);
      f.answer({ list: [alarmItem({ id: "a1" }), alarmItem({ id: "a2" })] });
      alarmBarFeed()?.refreshNow();
      await flush();
      expect(popupIds()).toEqual(["a2"]);
    },
    { list: [alarmItem({ id: "a1" })] },
  );
}

/** U6 (decision 21) — "seen" survives a scope change and a token renewal; a session end clears it. */
export async function seenLastsForTheTabsSession(): Promise<void> {
  await withFeed(
    async (f) => {
      await flush();
      alarmBarFeed()?.closePopup();
      alarmBarFeed()?.setScope({ kind: "organization", organizationId: ORG });
      await flush();
      f.session.setState({ accessToken: "token-2", user: { id: "user-1" } });
      await flush();
      expect(popupIds(), "a navigation and a renewal keep it").toEqual([]);
      f.session.setState({ accessToken: null, user: null });
      f.session.setState({ accessToken: "token-3", user: { id: "user-1" } });
      await flush();
      expect(popupIds(), "a sign-in after a session end treats it as unseen").toEqual(["a1"]);
    },
    { list: [alarmItem({ id: "a1" })] },
  );
}

/** U6 (decisions 8, 18) — one call per id, in order, one at a time, the same reason; failures kept; then a read. */
export async function acknowledgeCallsOncePerAlarmInOrder(): Promise<void> {
  await withFeed(async (f) => {
    await flush();
    f.refuseAcknowledge("b", '{"statusCode":409,"message":"Alarm already acknowledged"}');
    const reads = f.listCalls.length;
    const result = await alarmBarFeed()!.acknowledge(["a", "b", "c"], "Checked on site");
    expect(f.ackCalls).toEqual([
      { id: "a", reason: "Checked on site" },
      { id: "b", reason: "Checked on site" },
      { id: "c", reason: "Checked on site" },
    ]);
    expect(f.ackOverlapped(), "one at a time").toBe(false);
    expect(result).toEqual({ done: 2, failed: [{ id: "b", message: "Alarm already acknowledged" }] });
    expect(f.listCalls.length, "a read follows").toBe(reads + 1);
  });
}
