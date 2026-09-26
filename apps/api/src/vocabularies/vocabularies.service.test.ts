import { describe, it } from "vitest";

import {
  assertLocationTypeRefusesAnUnknownCode,
  assertUnknownCodeEchoIsBounded,
} from "./vocabularies.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("VocabulariesService.unknownCodeMessage", () => {
  it("cuts an over-long echoed code and leaves a short one byte-identical", async () => {
    await assertUnknownCodeEchoIsBounded();
  });

  it("F4.157 V1 — refuses an unknown location type with a 400 that lists the live codes", async () => {
    await assertLocationTypeRefusesAnUnknownCode();
  });
});
