import { describe, it } from "vitest";

import {
  assertEveryClassParamIsResolvable,
  assertEveryInjectedTokenIsResolvable,
  assertModuleStillDeclaresTheThreeControllers,
  assertScanFindsTheConfigToken,
} from "./notifications-module-wiring.spec";

/**
 * `F3.11` — Vitest entry point for the `NotificationsModule` carve guard.
 * Assertions live in the sibling `.spec` (ADR 0014).
 */
describe("F3.11 — NotificationsModule's controllers resolve after the provider-only carve (ADR 0064 Amendment 1 A1)", () => {
  it("the scan sees NOTIFICATIONS_CONFIG and the two service classes on NotificationsController (positive control)", () => {
    assertScanFindsTheConfigToken();
  });

  it("the module still declares exactly its three controllers", () => {
    assertModuleStillDeclaresTheThreeControllers();
  });

  it("every @Inject token a controller takes is exported by the core, provided beside it, or global", () => {
    assertEveryInjectedTokenIsResolvable();
  });

  it("every class-typed parameter a controller takes resolves the same way", () => {
    assertEveryClassParamIsResolvable();
  });
});
