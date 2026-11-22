import { describe, it } from "vitest";

import {
  assertAPushEndpointIsUntouched,
  assertAnOutOfBoundsIntervalRefusesTheFileByPath,
  assertNoIntervalIsNull,
  assertTheEdgePlanCarriesTheInterval,
  assertTheIntervalIsReadAndStripped,
} from "./edge-config-poll-interval.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the edge reads the poll interval from its file (ADR 0016 Amendment 10 (a))", () => {
  it("E1 reads the interval and strips it before the adapter schema", () => assertTheIntervalIsReadAndStripped());
  it("E2 no interval is null", () => assertNoIntervalIsNull());
  it("E3 an out-of-bounds interval refuses the file by path, never by value", () =>
    assertAnOutOfBoundsIntervalRefusesTheFileByPath());
  it("E4 the edge plan carries the interval", () => assertTheEdgePlanCarriesTheInterval());
  it("E5 a push endpoint is untouched", () => assertAPushEndpointIsUntouched());
});
