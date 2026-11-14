import { describe, it } from "vitest";

import * as spec from "./rules-list.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 U5 — GET /rules' four filters (ADR 0132 decisions 4 and 5)", () => {
  it("no query narrows by nothing and lists that scope", () => spec.assertNoQueryNarrowsByNothing());
  it("each key reaches narrow, lower-cased", () => spec.assertEachKeyReachesNarrow());
  it("an unknown key or a non-uuid id is a 400 that runs nothing", () => spec.assertABadQueryIsA400RunningNothing());
  it("an empty narrowing stays [] on the list", () => spec.assertAnEmptyNarrowingStaysEmpty());
});
