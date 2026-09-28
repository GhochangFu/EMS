import { expect } from "vitest";

import { requestMetaForCreate, requestMetaForUpdate } from "./location-seed-key";

/**
 * `F4.170` owner ruling 20 — `meta.seedKey` is seed-owned. Pure cases for the
 * one helper the location create, the location update and the onboarding
 * commit share; the write paths are `locations.seed-key.integration.spec.ts`
 * and `onboarding-commit.seed-key.integration.spec.ts`.
 */

/** K1 — a create drops `seedKey` from the request and keeps every other key. */
export function createDropsTheSeedKey(): void {
  expect(requestMetaForCreate({ seedKey: "rsmoc-western-cape", note: "kept" })).toEqual({ note: "kept" });
}

/** K2 — a create with no `meta` stores none. */
export function createWithoutMetaStoresNull(): void {
  expect(requestMetaForCreate(undefined)).toBeNull();
}

/** K3 — an update that replaces `meta` keeps the stored key. */
export function updateKeepsTheStoredKey(): void {
  expect(requestMetaForUpdate({ note: "new" }, { seedKey: "k", note: "old" })).toEqual({
    note: "new",
    seedKey: "k",
  });
}

/** K4 — an update that sends another key keeps the stored one. */
export function updateRefusesAnotherKey(): void {
  expect(requestMetaForUpdate({ seedKey: "x" }, { seedKey: "k" })).toEqual({ seedKey: "k" });
}

/** K5 — an update that sends a key onto a row with none stores none. */
export function updateDoesNotAddAKey(): void {
  expect(requestMetaForUpdate({ seedKey: "x", note: "n" }, null)).toEqual({ note: "n" });
  expect(requestMetaForUpdate({ seedKey: "x" }, { note: "old" })).toEqual({});
}
