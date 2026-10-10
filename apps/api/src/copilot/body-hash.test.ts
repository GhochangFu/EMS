import { describe, it } from "vitest";

import {
  aNonObjectBodyIsHashedWhole,
  anEmptyBodyHashesToTheBracesLiteral,
  clientOnlyKeysAreStripped,
  theVectorHashesToTheSharedLiteral,
} from "./body-hash.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the copilot body hash, API side (ADR 0099 drafter choice 5)", () => {
  it("hashes the fixed vector to the shared literal", () => theVectorHashesToTheSharedLiteral());
  it("hashes an empty body to the braces literal", () => anEmptyBodyHashesToTheBracesLiteral());
  it("strips clientOnly keys before hashing", () => clientOnlyKeysAreStripped());
  it("hashes a non-object body whole", () => aNonObjectBodyIsHashedWhole());
});
