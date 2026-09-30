import { afterEach, describe, it, vi } from "vitest";

import { loadTrendSendsTheOrganizationId, loadTrendSendsTheWindowAlone } from "./dashboard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.72 U1 dashboard web client — the load trend organization filter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends ?window= alone when no organization is given", async () => {
    await loadTrendSendsTheWindowAlone();
  });

  it("sends ?window=&organizationId= when an organization is given", async () => {
    await loadTrendSendsTheOrganizationId();
  });
});
