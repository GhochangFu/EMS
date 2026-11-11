// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { anEmptyHistorySaysSo, closeCallsBack, theDrawerLoadsAndListsTheHistory } from "./rtu-drop-history-drawer.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.16 RTU drop history drawer (ADR 0127)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("D1 loads and lists the 30-day history, keys as text", async () => {
    await theDrawerLoadsAndListsTheHistory();
  });

  it("D2 an empty history says so", async () => {
    await anEmptyHistorySaysSo();
  });

  it("D3 Close calls back", async () => {
    await closeCallsBack();
  });
});
