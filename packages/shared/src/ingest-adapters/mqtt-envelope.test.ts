import { describe, it } from "vitest";

import {
  aFlatPayloadIsItsOwnValueBag,
  aMissingTsLeavesAtUnset,
  aNonNumericTsLeavesAtUnset,
  aNullValuesFallsBackToTheBody,
  aTopLevelReadingBesideValuesIsReachable,
  theEnvelopeFieldsAreNeverReadings,
  theNestedBlockWinsACollision,
  theNestedValuesObjectIsUsed,
} from "./mqtt-envelope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b — the shared MQTT envelope parse", () => {
  it("uses the nested values object and the numeric ts", () => theNestedValuesObjectIsUsed());
  it("reads a flat payload as its own value bag", () => aFlatPayloadIsItsOwnValueBag());
  it("leaves at unset when ts is missing", () => aMissingTsLeavesAtUnset());
  it("leaves at unset when ts is not numeric", () => aNonNumericTsLeavesAtUnset());
  it("falls back to the body when values is null", () => aNullValuesFallsBackToTheBody());
  it("reaches a reading published beside values", () => aTopLevelReadingBesideValuesIsReachable());
  it("never lets dev_id or ts become a reading", () => theEnvelopeFieldsAreNeverReadings());
  it("lets the nested block win a key collision", () => theNestedBlockWinsACollision());
});
