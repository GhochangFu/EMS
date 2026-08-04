import { describe, it } from "vitest";

import { runCredentialCryptoTests } from "./credential-crypto.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("credential-crypto", () => {
  it("round-trips encrypted RTU credentials (ADR 0012)", () => {
    runCredentialCryptoTests();
  });
});
