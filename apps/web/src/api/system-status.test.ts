import { afterEach, describe, it, vi } from "vitest";

import {
  fetchSystemStatusAbortsAfterTenSeconds,
  fetchSystemStatusClearsTheSessionOn401,
  fetchSystemStatusForwardsTheQuerySignal,
  fetchSystemStatusHitsTheStatusPath,
  fetchSystemStatusSendsTheBearerToken,
  fetchSystemStatusThrowsOnNon2xx,
  fetchSystemStatusThrowsOnSchemaMismatch,
} from "./system-status.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.30 system status web client — what the footer's fetcher sends", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the status read to /api/v1/system/status", async () => {
    await fetchSystemStatusHitsTheStatusPath();
  });

  it("sends the bearer token from withAuth()", async () => {
    await fetchSystemStatusSendsTheBearerToken();
  });

  it("throws on a non-2xx response", async () => {
    await fetchSystemStatusThrowsOnNon2xx();
  });

  it("throws when the body fails the contract", async () => {
    await fetchSystemStatusThrowsOnSchemaMismatch();
  });

  it("aborts the request 10 s after it starts, and not before", async () => {
    await fetchSystemStatusAbortsAfterTenSeconds();
  });

  it("aborts the request when the query signal aborts", async () => {
    await fetchSystemStatusForwardsTheQuerySignal();
  });

  it("clears the session on a 401", async () => {
    await fetchSystemStatusClearsTheSessionOn401();
  });
});
