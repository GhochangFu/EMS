import { describe, it } from "vitest";

import {
  runConstantsTest,
  runNoRunFieldsTest,
  runNotStrictTest,
  runPointKeyBoundTest,
  runScoreBoundsTest,
  runUnknownDetectorTest,
} from "./ml-anomalies.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2b — the anomaly read contracts (ADR 0135 Amendment 5 A-e)", () => {
  it("the read-time line, the caps, the model name and the detectors", () => runConstantsTest());
  it("a score outside 0..1 (1.01) is refused; 0, 0.99 and 1 parse", () => runScoreBoundsTest());
  it("an unknown detector name parses; one over 64 characters does not", () => runUnknownDetectorTest());
  it("a 129-character contributing point key is refused", () => runPointKeyBoundTest());
  it("an unknown extra key parses (responses are not strict)", () => runNotStrictTest());
  it("no run field (model, version, error, hash, rows) is on the wire; the row's keys are exact", () =>
    runNoRunFieldsTest());
});
