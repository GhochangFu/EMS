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

  it("F3.32f MimicSymbolLibrariesModule declares its members, imports Database and Auth, exports nothing", () => {
    spec.assertSymbolLibrariesModuleDeclaresItsMembers();
  });

  it("F3.32f AppModule imports MimicSymbolLibrariesModule", () => {
    spec.assertAppModuleImportsTheSymbolLibrariesModule();
  });

  it("F3.32f MimicSymbolLibrariesService's dependencies resolve inside its module", () => {
    spec.assertSymbolLibrariesServiceDepsResolve();
  });

  it("F3.32f MimicSymbolLibrariesController's dependencies resolve inside its module", () => {
    spec.assertSymbolLibrariesControllerDepsResolve();
  });
});
