import { describe, it } from "vitest";

import {
  aBadQueryIsA400BeforeNarrow,
  bothRoutesHandNarrowsValueToTheService,
  narrowGetsTheParsedKeysAndNarrowedFollowsThem,
} from "./ml-findings.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the two findings summary routes (ADR 0135 Amendment 8 decision 10)", () => {
  it("narrow's value (array, [], null) reaches the service unchanged; the answer is the service's", () =>
    bothRoutesHandNarrowsValueToTheService());
  it("narrow receives exactly the parsed keys; `narrowed` follows a location, group or asset", () =>
    narrowGetsTheParsedKeysAndNarrowedFollowsThem());
  it("a bad query is a 400 and neither narrow nor the service runs", () => aBadQueryIsA400BeforeNarrow());
});
