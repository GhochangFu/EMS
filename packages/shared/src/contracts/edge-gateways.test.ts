import { describe, it } from "vitest";

import {
  theDtoCarriesNoSecret,
  theTokenResponseIsItsOwnSchema,
  theVocabulariesAreClosed,
  theWriteBodiesAreStrict,
} from "./edge-gateways.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — edge gateway admin contracts (ADR 0123 decisions 5, 12)", () => {
  it("C1 the DTO carries no hash or token field", () => theDtoCarriesNoSecret());
  it("C2 status and clockState are closed vocabularies", () => theVocabulariesAreClosed());
  it("C3 the token response is its own schema, on the uplink token pattern", () => theTokenResponseIsItsOwnSchema());
  it("C4 the write bodies are strict and bounded", () => theWriteBodiesAreStrict());
});
