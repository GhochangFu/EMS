import { describe, it } from "vitest";

import { anEmptyBodyHashesToTheBracesLiteral, theVectorHashesToTheSharedLiteral } from "./copilot-body-hash.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * No `@vitest-environment` docblock: the project's `node` default.
 */
describe("F3.85 — the copilot body hash, browser side (ADR 0099 drafter choice 5)", () => {
  it("hashes the fixed vector to the shared literal", () => theVectorHashesToTheSharedLiteral());
  it("hashes an empty body to the braces literal", () => anEmptyBodyHashesToTheBracesLiteral());
});
