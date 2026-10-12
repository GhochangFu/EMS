import { describe, it } from "vitest";

import { registryAndLedgerStillNameTheBodies } from "./point-keys.schema.registry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.68 — the point-key admin bodies stay in the registry and the ledger", () => {
  it("keeps both bodies in the OpenAPI registry and the strict-body ledger", () => {
    registryAndLedgerStillNameTheBodies();
  });
});
