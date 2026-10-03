import { describe, it } from "vitest";

import {
  assertAMalformedIdIs400,
  assertGuardReadFindsTheNeighbourGuard,
  assertHandlersPassThroughToTheService,
  assertUsersControllerIsBehindJwtAuthGuard,
  assertUsersControllerPathIsAdminUsers,
} from "./users.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — UsersAdminController (ADR 0089 decision 1)", () => {
  it("the guard read finds JwtAuthGuard on AssetGroupsAdminController (positive control)", () => {
    assertGuardReadFindsTheNeighbourGuard();
  });

  it("the controller carries @UseGuards(JwtAuthGuard)", () => {
    assertUsersControllerIsBehindJwtAuthGuard();
  });

  it("the controller path is admin/users", () => {
    assertUsersControllerPathIsAdminUsers();
  });

  it("every handler passes the caller, the id and the raw body through to the service", async () => {
    await assertHandlersPassThroughToTheService();
  });

  it("a malformed :id is a 400 before the service runs", async () => {
    await assertAMalformedIdIs400();
  });
});
