import { describe, it } from "vitest";

import {
  aListedPlainRtuIsQueued,
  aPlainRtuWithoutExpectedTlsIs409,
  aTlsRtuBindsItsTlsChoice,
  anUnlistedPlainRtuIsRefused,
} from "./onboarding-discovery-plaintext.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — the discovery route and plain MQTT (ADR 0114 decision 4, R6)", () => {
  it("R1 refuses an unlisted plain RTU with the fixed message and a refuse row", anUnlistedPlainRtuIsRefused);
  it("R2 queues a listed plain RTU whose card said TLS off", aListedPlainRtuIsQueued);
  it("R3 answers 409 when a plain RTU's body omits expected.tls", aPlainRtuWithoutExpectedTlsIs409);
  it("R4 binds a TLS RTU's choice: absent is on", aTlsRtuBindsItsTlsChoice);
});
