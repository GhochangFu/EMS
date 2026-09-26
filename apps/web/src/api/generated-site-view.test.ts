import { afterEach, describe, it, vi } from "vitest";

import {
  hitsTheGeneratedPath,
  resolvesAValidBody,
  sendsTheBearerToken,
  throwsOnAnOffShapeBody,
  throwsWithTheStatusOnNon2xx,
} from "./generated-site-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F3.68 generated site view web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A1a sends the read to /api/v1/control-room/sites/:locationId/generated", async () => {
    await hitsTheGeneratedPath();
  });

  it("A1b sends the bearer token from withAuth()", async () => {
    await sendsTheBearerToken();
  });

  it("A2 throws with the status on a non-2xx response", async () => {
    await throwsWithTheStatusOnNon2xx();
  });

  it("A3 throws when the body fails the contract", async () => {
    await throwsOnAnOffShapeBody();
  });

  it("A3 control: resolves a valid body", async () => {
    await resolvesAValidBody();
  });
});
