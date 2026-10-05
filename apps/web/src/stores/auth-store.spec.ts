import { useAuthStore } from "./auth-store";

/**
 * `F4.203` — the auth store persists the session and nothing else. The
 * failure reason stays in memory, so a reload forgets it; the four session
 * keys the store persisted before `F4.203` must all still be written.
 *
 * Assertions live here; `auth-store.test.ts` is the Vitest entry point and
 * carries the jsdom docblock (`persist` writes to `localStorage`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** S1 — the persisted state holds exactly the four session keys, not the reason. */
export function runThePersistedKeysAreTheSessionOnly(): void {
  useAuthStore.getState().setSession(
    "token-abc",
    { id: "u1", email: "wc-admin@bms.local", displayName: "WC Admin", role: "location_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    "id-token",
  );
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  const raw = window.localStorage.getItem("bms-auth");
  assert(raw !== null, "control: the store persisted something");
  const keys = Object.keys((JSON.parse(raw ?? "{}") as { state: object }).state).sort();
  const expected = ["accessToken", "oidcIdToken", "scope", "user"];
  assert(
    JSON.stringify(keys) === JSON.stringify(expected),
    `persisted keys must be ${expected.join(",")}, got ${keys.join(",")}`,
  );
}
