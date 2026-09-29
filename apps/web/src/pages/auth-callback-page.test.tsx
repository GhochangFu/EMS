// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { readsTheWaitingSentence } from "./auth-callback-page.spec";

/**
 * `F3.33` U5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F3.33 the auth callback names IONSiTE NEXUS", () => {
  it("A1 reads the waiting sentence", () => {
    readsTheWaitingSentence();
  });
});
