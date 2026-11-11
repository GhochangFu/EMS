// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  allSixStatesHaveDistinctClasses,
  nullMinutesReadsNoSla,
  theChipRendersTheMinutesInTheReferenceWording,
} from "./work-order-sla-chip.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order SLA chip (ADR 0122 decision 3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders 30 mins, 1h and 1d 4h", () => {
    theChipRendersTheMinutesInTheReferenceWording();
  });

  it("gives each of the six states its own class", () => {
    allSixStatesHaveDistinctClasses();
  });

  it("reads No SLA with null minutes", () => {
    nullMinutesReadsNoSla();
  });
});
