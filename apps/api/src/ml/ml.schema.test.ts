import { describe, it } from "vitest";

import {
  aMissingOrGarbledEndIsRefused,
  aReversedEmptyOrOverLongWindowIsRefused,
  aWindowOfTwoOffsetInstantsParses,
  anUnknownKeyIsRefused,
  theAnomalyWindowParsesUpToItsCap,
  theAnomalyWindowRefusesAnUnknownKeyAMissingToAReversalAndA32DaySpan,
  theListQueryTakesAnOptionalSinceOnly,
} from "./ml.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4e — pastForecastQuerySchema (ADR 0135 Amendment 4)", () => {
  it("a window of two offset ISO instants parses, up to the span cap inclusive", () => aWindowOfTwoOffsetInstantsParses());
  it("a missing, garbled, offset-less or repeated end is refused", () => aMissingOrGarbledEndIsRefused());
  it("a reversed, empty or over-long window is refused with its message", () => aReversedEmptyOrOverLongWindowIsRefused());
  it("an unknown query key is refused (.strict())", () => anUnknownKeyIsRefused());
});

describe("E1.2b — the anomaly query schemas (ADR 0135 Amendment 5 A-e)", () => {
  it("the one-asset window parses up to 31 days inclusive", () => theAnomalyWindowParsesUpToItsCap());
  it("an unknown key, a missing to, from after to and a 32-day span are refused", () =>
    theAnomalyWindowRefusesAnUnknownKeyAMissingToAReversalAndA32DaySpan());
  it("the list takes an optional offset-instant since and nothing else", () => theListQueryTakesAnOptionalSinceOnly());
});
