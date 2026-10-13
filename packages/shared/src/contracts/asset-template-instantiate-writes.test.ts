import { describe, it } from "vitest";

import { runInstantiateSchemaTests, runInstantiateTransformTests } from "./asset-template-instantiate-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("instantiateAssetsBodySchema (F2.2, ADR 0015 §6; moved by F4.254 PR 1)", () => {
  it("holds the exclusive target, the duplicate-code rule and the entry shape", () => {
    runInstantiateSchemaTests();
  });

  it("transforms the exclusive pair into a discriminated target", () => {
    runInstantiateTransformTests();
  });
});
