import { describe, it } from "vitest";

import {
  assertControllerIsBehindJwtAuthGuard,
  assertControllerPathIsSystem,
  assertGuardReadFindsTheNeighbourGuard,
  assertHandlerIsGetStatus,
  assertHandlerReturnsTheServiceBody,
  assertNoRoleGateRuns,
  assertScopeIsResolvedForTheCaller,
  assertScopedReaderPassesItsArrayByReference,
  assertUnrestrictedReaderPassesNull,
} from "./system-status.controller.spec";

/**
 * `F3.30` (ADR 0075 decision 4) — Vitest entry point for the
 * `GET /api/v1/system/status` controller checks. Assertions live in the
 * sibling `.spec` (§4.6 / ADR 0014); this file only runs them.
 */
describe("F3.30 — system status controller over stubs", () => {
  it("a scoped caller's readableAssetIds array reaches read() by reference", async () => {
    await assertScopedReaderPassesItsArrayByReference();
  });

  it("an unrestricted caller (readableAssetIds null) reaches read(null)", async () => {
    await assertUnrestrictedReaderPassesNull();
  });

  it("the handler returns the service's body unchanged", async () => {
    await assertHandlerReturnsTheServiceBody();
  });

  it("the scope is resolved once, for the request's user", async () => {
    await assertScopeIsResolvedForTheCaller();
  });

  it("no role gate runs: the route is open to every role", async () => {
    await assertNoRoleGateRuns();
  });
});

describe("F3.30 — system status controller decorator metadata", () => {
  it("the guard read finds JwtAuthGuard on MapController (positive control)", () => {
    assertGuardReadFindsTheNeighbourGuard();
  });

  it("the controller carries @UseGuards(JwtAuthGuard)", () => {
    assertControllerIsBehindJwtAuthGuard();
  });

  it("the controller path is system, not health", () => {
    assertControllerPathIsSystem();
  });

  it("the handler is GET status", () => {
    assertHandlerIsGetStatus();
  });
});
