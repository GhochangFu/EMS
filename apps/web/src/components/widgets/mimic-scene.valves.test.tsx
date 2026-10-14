// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFlowingBreakerSymbolValveDrawsOpen,
  aFlowingValveSymbolUnitDrawsOpen,
  aShutBreakerSymbolValveDrawsShut,
  aShutValveSymbolUnitDrawsShut,
  aShutValvesStateIsInTheAccessibleName,
} from "./mimic-scene.valves.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.80 — MimicScene valves (ADR 0101 d10, d11)", () => {
  afterEach(() => {
    cleanup();
  });

  it("V1 valve_open 0 draws SHUT, the open frame and blade, and de-energises the pipe after it", () => {
    aShutBreakerSymbolValveDrawsShut();
  });

  it("V2 valve_open 1 draws OPEN, the closed blade, and energises the pipe after it", () => {
    aFlowingBreakerSymbolValveDrawsOpen();
  });

  it("V3 the accessible name says ': shut'", () => {
    aShutValvesStateIsInTheAccessibleName();
  });

  it("V4 a valve-symbol unit marked isSwitching: valve_open 0 draws SHUT and de-energises the pipe after it", () => {
    aShutValveSymbolUnitDrawsShut();
  });

  it("V5 a valve-symbol unit marked isSwitching: valve_open 1 draws OPEN and energises the pipe after it", () => {
    aFlowingValveSymbolUnitDrawsOpen();
  });
});
