// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aStoredFormatIsPreselected,
  eachDeviceShowsItsFormat,
  thePickerWritesTheRtuPayloadFormat,
  theSkippedReasonsAreNamed,
} from "./discovery-panel-formats.spec";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 / F4.335 — the drawer's payload formats (plan T5.3)", () => {
  it("D1 writes the RTU's payload format, removing it for the built-in", thePickerWritesTheRtuPayloadFormat);
  it("D2 pre-selects a stored format", aStoredFormatIsPreselected);
  it("D3 lists each discovered device with its format", eachDeviceShowsItsFormat);
  it("D4 names each skip reason with its count (F4.335)", theSkippedReasonsAreNamed);
});
