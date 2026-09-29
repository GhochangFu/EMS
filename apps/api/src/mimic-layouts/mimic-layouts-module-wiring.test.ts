import { describe, it } from "vitest";

import * as spec from "./mimic-layouts-module-wiring.spec";

/** `F3.32c` U2 — Vitest entry point for the `MimicLayoutsModule` graph. Assertions in the `.spec`. */
describe("F3.32c — MimicLayoutsModule wiring", () => {
  it("declares its controller, provides its service and the audit service, imports Database and Auth", () => {
    spec.assertModuleDeclaresItsMembers();
  });

  it("AppModule imports MimicLayoutsModule", () => {
    spec.assertAppModuleImportsTheModule();
  });

  it("MimicLayoutsController's dependencies resolve inside the module", () => {
    spec.assertControllerDepsResolve();
  });

  it("MimicLayoutsService's dependencies resolve inside the module", () => {
    spec.assertServiceDepsResolve();
  });
});
