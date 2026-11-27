import { describe, it } from "vitest";

import {
  aBadQueryIsA400BeforeNarrow,
  narrowReceivesExactlyTheScopeKeys,
  narrowsValueReachesTheServiceUnchanged,
} from "./findings-paragraph.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — GET /ml/findings/paragraph (ADR 0135 Amendment 8 decision 10)", () => {
  it("a bad kind or an unknown key is a 400 before narrow", () => aBadQueryIsA400BeforeNarrow());
  it("narrow's value reaches the service unchanged", () => narrowsValueReachesTheServiceUnchanged());
  it("narrow receives exactly the four scope keys", () => narrowReceivesExactlyTheScopeKeys());
});
