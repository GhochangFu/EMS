import { describe, it } from "vitest";

import {
  aMissingOrGarbledEndIsRefused,
  aReversedEmptyOrOverLongWindowIsRefused,
  aWindowOfTwoOffsetInstantsParses,
  anUnknownKeyIsRefused,
} from "./ml.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4e — pastForecastQuerySchema (ADR 0135 Amendment 4)", () => {
  it("a window of two offset ISO instants parses, up to the span cap inclusive", () => aWindowOfTwoOffsetInstantsParses());
  it("a missing, garbled, offset-less or repeated end is refused", () => aMissingOrGarbledEndIsRefused());
  it("a reversed, empty or over-long window is refused with its message", () => aReversedEmptyOrOverLongWindowIsRefused());
  it("an unknown query key is refused (.strict())", () => anUnknownKeyIsRefused());
});
