import { describe, it } from "vitest";

import {
  runSecondsParseToTheSharedBound,
  runStoredValuesReadAsSeconds,
  runTheWarningStartsAbove360Seconds,
} from "./poll-interval-input.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the poll interval seconds field (plan P4)", () => {
  it("S1 — seconds parse to the shared 1 s to 1 h bound; empty is null", () => runSecondsParseToTheSharedBound());
  it("S2 — the warning starts above 360 s", () => runTheWarningStartsAbove360Seconds());
  it("S3 — stored values read as seconds", () => runStoredValuesReadAsSeconds());
});
