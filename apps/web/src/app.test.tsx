// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "./stores/auth-store";
import { theMeEffectKeepsTheStoredIdToken } from "./app.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.156 App /me effect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    localStorage.clear();
  });

  it("M1 keeps the stored OIDC id token when /me re-sets the session", async () => {
    await theMeEffectKeepsTheStoredIdToken();
  });
});
