import { describe, it } from "vitest";

import {
  aBadQueryIs400BeforeNarrow,
  listHandsNarrowsValueToTheService,
  narrowGetsExactlyTheParsedKeys,
} from "./degradation.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — DegradationController (ADR 0138)", () => {
  it("list hands narrow's value (an array, [] or null) to the service unchanged, with one clock", () =>
    listHandsNarrowsValueToTheService());
  it("narrow receives exactly the parsed keys", () => narrowGetsExactlyTheParsedKeys());
  it("a bad query is a 400 and narrow is never called", () => aBadQueryIs400BeforeNarrow());
});
