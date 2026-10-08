import { describe, it } from "vitest";

import {
  runCreateBodyTests,
  runEditDiffTests,
  runEditRtuTests,
  runFormSeedTests,
} from "./asset-point-form.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.31 / F2.27 — the Add/Edit mapping body (ADR 0056 Amendment 3 part A)", () => {
  it("sends only the fields that differ from the loaded row", () => {
    runEditDiffTests();
  });

  it("reads the RTU as untouched, blank (unwire) or chosen", () => {
    runEditRtuTests();
  });

  it("seeds the form from the row's own values, not the effective ones", () => {
    runFormSeedTests();
  });

  it("omits every empty box on a create", () => {
    runCreateBodyTests();
  });
});
