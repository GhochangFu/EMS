import { expect } from "vitest";

import {
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
