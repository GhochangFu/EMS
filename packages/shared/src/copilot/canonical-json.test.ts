import { describe, it } from "vitest";

import {
  keyOrderDoesNotChangeTheForm,
  nestedObjectsAreSortedToo,
  theEmptyBodyIsBraces,
  theFixedVectorIsCanonical,
  theJsonImageIsTakenFirst,
} from "./canonical-json.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — canonicalJson, the copilot body-hash form (ADR 0099 drafter choice 5)", () => {
  it("writes the fixed vector in canonical form", () => theFixedVectorIsCanonical());
  it("sorts object keys and keeps array order", () => keyOrderDoesNotChangeTheForm());
  it("writes an empty body as {}", () => theEmptyBodyIsBraces());
  it("takes the JSON image first", () => theJsonImageIsTakenFirst());
  it("sorts nested objects", () => nestedObjectsAreSortedToo());
});
