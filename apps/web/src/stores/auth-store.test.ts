// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import { useAuthStore } from "./auth-store";
import { runThePersistedKeysAreTheSessionOnly } from "./auth-store.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom
 * because `persist` writes to `localStorage` (ADR 0042 decision 2).
 */
describe("F4.203 auth store persistence", () => {
  afterEach(() => {
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ authFailureReason: null });
    window.localStorage.clear();
  });

  it("S1 persists exactly the four session keys, never the failure reason", () => {
    runThePersistedKeysAreTheSessionOnly();
  });
});
