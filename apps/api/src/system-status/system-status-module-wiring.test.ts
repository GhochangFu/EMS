import { describe, it } from "vitest";

import {
  assertAppModuleImportsSystemStatusModule,
  assertEveryClassParamIsResolvable,
  assertEveryInjectedTokenIsResolvable,
  assertModuleDeclaresTheController,
  assertModuleProvidesTheService,
  assertScanFindsStorageHealthServiceOnTheService,
  assertScanFindsTheTwoInjectedTokensOnTheService,
} from "./system-status-module-wiring.spec";

/**
 * `F3.30` — Vitest entry point for the `SystemStatusModule` wiring guard.
 * Assertions live in the sibling `.spec` (ADR 0014).
 */
describe("F3.30 — SystemStatusModule resolves at boot and is loaded by AppModule (ADR 0075 decision 4)", () => {
  it("the scan sees QueueHealthService and StorageHealthService on the service (positive control)", () => {
    assertScanFindsStorageHealthServiceOnTheService();
  });

  it("the scan sees the two @Inject pool tokens on the service (positive control)", () => {
    assertScanFindsTheTwoInjectedTokensOnTheService();
  });

  it("the module declares SystemStatusController", () => {
    assertModuleDeclaresTheController();
  });

  it("the module provides SystemStatusService", () => {
    assertModuleProvidesTheService();
  });

  it("every @Inject token resolves against the module's providers or a global module's exports", () => {
    assertEveryInjectedTokenIsResolvable();
  });

  it("every class-typed parameter resolves the same way", () => {
    assertEveryClassParamIsResolvable();
  });

  it("AppModule imports SystemStatusModule", () => {
    assertAppModuleImportsSystemStatusModule();
  });
});
