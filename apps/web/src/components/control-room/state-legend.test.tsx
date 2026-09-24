// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  omitsAnInactiveSeverity,
  rendersInRankOrderWithNormalFirstAndOfflineLast,
  rendersNoStandbyPill,
} from "./state-legend.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 state legend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Normal first, the severities by rank, then Offline last", async () => {
    await rendersInRankOrderWithNormalFirstAndOfflineLast();
  });

  it("renders no Standby pill", async () => {
    await rendersNoStandbyPill();
  });

  it("omits an inactive severity, beside an active one", async () => {
    await omitsAnInactiveSeverity();
  });
});
