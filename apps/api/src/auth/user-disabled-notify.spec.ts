import { expect } from "vitest";

import { flushListener, makeFakeListenerClient } from "../testing/fake-listener-client";
import {
  closeSocketsOfDisabledUsers,
  createUserDisabledListener,
  decodeUserDisabledNotification,
  handleUserDisabledNotification,
  USER_DISABLED_NOTIFY_CHANNEL,
} from "./user-disabled-notify";

/**
 * `F3.78` / ADR 0089 decision 8 — the `bms_user_disabled` payload is the bare
 * `bms.users.id`. `NOTIFY` needs no table privilege, so the payload is data of
 * unknown provenance: a non-uuid is dropped with one fixed warn that never
 * quotes it.
 */

const ID = "00000000-0000-4000-8000-0000000000a9";
const OTHER_ID = "00000000-0000-4000-8000-0000000000aa";

type Recorder = { closed: string[]; warns: string[]; logs: string[] };

function recorder(): Recorder & Parameters<typeof handleUserDisabledNotification>[1] {
  const r: Recorder = { closed: [], warns: [], logs: [] };
  return {
    ...r,
    disconnectUser: (id: string) => {
      r.closed.push(id);
      return 2;
    },
    logger: {
      log: (m: string) => r.logs.push(m),
      warn: (m: string) => r.warns.push(m),
      error: (m: string) => r.warns.push(m),
    },
  };
}

export function assertTheChannelName(): void {
  expect(USER_DISABLED_NOTIFY_CHANNEL).toBe("bms_user_disabled");
}

export function assertDecodesAUuid(): void {
  expect(decodeUserDisabledNotification(ID)).toBe(ID);
}

export function assertAUuidDisconnectsThatUser(): void {
  const r = recorder();
  handleUserDisabledNotification(ID, r);
  expect(r.closed).toEqual([ID]);
  expect(r.warns).toEqual([]);
}

export function assertANonUuidIsDroppedWithOneWarn(): void {
  const r = recorder();
  handleUserDisabledNotification("'; DROP TABLE x; --", r);
  expect(r.closed).toEqual([]);
  expect(r.warns).toEqual(["Dropped an undecodable bms_user_disabled payload"]);
}

export function assertAnEmptyPayloadIsDropped(): void {
  const r = recorder();
  handleUserDisabledNotification(undefined, r);
  expect(r.closed).toEqual([]);
  expect(r.warns).toHaveLength(1);
}

/**
 * The catch-up on connect. `NOTIFY` is not queued for a session that is not
 * listening, so a deactivation committed while this process's `LISTEN`
 * connection is down — or before the first `LISTEN` after boot — never
 * arrives. On every transition to `connected` the listener therefore reads
 * which of the users holding a socket here are deactivated now, and closes
 * theirs.
 */
type CatchUp = {
  closed: string[];
  reads: string[][];
  warns: string[];
  open: Set<string>;
  disabled: Set<string>;
};

function catchUpDeps(c: CatchUp) {
  return {
    connectedUserIds: () => [...c.open],
    readDisabledUserIds: async (ids: readonly string[]) => {
      c.reads.push([...ids]);
      return ids.filter((id) => c.disabled.has(id));
    },
    disconnectUser: (id: string) => {
      c.closed.push(id);
      c.open.delete(id);
      return 1;
    },
    logger: {
      log: () => undefined,
      warn: (m: string) => c.warns.push(m),
      error: (m: string) => c.warns.push(m),
    },
  };
}

function catchUpState(open: string[], disabled: string[] = []): CatchUp {
  return { closed: [], reads: [], warns: [], open: new Set(open), disabled: new Set(disabled) };
}

export async function assertTheCatchUpClosesOnlyTheDisabledUsers(): Promise<void> {
  const c = catchUpState([ID, OTHER_ID], [ID]);
  const closed = await closeSocketsOfDisabledUsers(catchUpDeps(c));
  expect(c.reads).toEqual([[ID, OTHER_ID]]);
  expect(c.closed).toEqual([ID]);
  expect(closed).toBe(1);
}

export async function assertTheCatchUpReadsNothingWithNoSocketOpen(): Promise<void> {
  const c = catchUpState([], [ID]);
  expect(await closeSocketsOfDisabledUsers(catchUpDeps(c))).toBe(0);
  expect(c.reads).toEqual([]);
}

/** A NOTIFY lost while the connection was down is made good by the reconnect. */
export async function assertAReconnectClosesASocketWhoseNotifyWasLost(): Promise<void> {
  const first = makeFakeListenerClient();
  const second = makeFakeListenerClient();
  const fakes = [first, second];
  let index = 0;
  const c = catchUpState([ID]);
  const states: string[] = [];
  const listener = createUserDisabledListener({
    ...catchUpDeps(c),
    createClient: () => fakes[Math.min(index++, fakes.length - 1)]!.client,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    random: () => 0.5,
    now: () => 0,
    onStateChange: (state) => states.push(state),
  });
  listener.start();
  await flushListener();
  // Positive control: the first connect read the open user, who was enabled then.
  expect(c.reads).toEqual([[ID]]);
  expect(c.closed).toEqual([]);

  // The connection drops; the user is deactivated meanwhile, and the NOTIFY
  // that the deactivate transaction sent reaches no listener on this process.
  first.emitEnd();
  c.disabled.add(ID);
  await flushListener();

  expect(second.queries).toEqual(["LISTEN bms_user_disabled"]);
  expect(c.closed).toEqual([ID]);
  // The caller's own state hook is still called on every transition.
  expect(states).toEqual(["connected", "disconnected", "connected"]);
  await listener.stop();
}

export async function assertAFailedCatchUpReadIsOneWarnNotARejection(): Promise<void> {
  const fake = makeFakeListenerClient();
  const c = catchUpState([ID], [ID]);
  const listener = createUserDisabledListener({
    ...catchUpDeps(c),
    readDisabledUserIds: async () => {
      throw new Error("pool exhausted");
    },
    createClient: () => fake.client,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
  listener.start();
  await flushListener();
  expect(c.closed).toEqual([]);
  expect(c.warns).toEqual(["bms_user_disabled: catch-up on connect failed: pool exhausted"]);
  expect(listener.connected()).toBe(true);
  await listener.stop();
}
