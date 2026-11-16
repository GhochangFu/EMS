import { describe, it } from "vitest";

import { aUuidListBecomesOneArrayLiteral, anElementThatIsNotAUuidIsRefused } from "./ml-forecasts.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the forecast list's uuid[] literal", () => {
  it("a uuid list becomes one array literal", () => aUuidListBecomesOneArrayLiteral());
  it("an element that is not a uuid is refused, so it cannot add elements", () => anElementThatIsNotAUuidIsRefused());
});
