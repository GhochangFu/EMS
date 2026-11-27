// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedReadDrawsNothing,
  aPendingReadDrawsNothing,
  noCrossingDrawsNothing,
  noShownLineWhenAllWereConsidered,
  roleClassesOnlyNoSeverityColour,
  tenRowsInTheServersOrder,
  theFilterReachesTheClientAsTheTwoKeys,
} from "./degradation-trend-card.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.5b — the control-room Trending toward a limit card", () => {
  it("12 assets with a crossing draw 10 rows in the server's order", () => tenRowsInTheServersOrder());
  it("no Showing line when every candidate was considered", () => noShownLineWhenAllWereConsidered());
  it("the filter reaches the client as the two keys", () => theFilterReachesTheClientAsTheTwoKeys());
  it("role classes only, the info pill, no severity colour", () => roleClassesOnlyNoSeverityColour());
  it("no crossing draws nothing", () => noCrossingDrawsNothing());
  it("a pending read draws nothing", () => aPendingReadDrawsNothing());
  it("a failed read draws nothing", () => aFailedReadDrawsNothing());
});
