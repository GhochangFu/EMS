// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  boundWidgetFetchesItsRef,
  cleanupCanvas,
  emptyDashboardShowsNoWidgetsLine,
  oneSocketWithTokenDisconnectsOnUnmount,
  oneWidgetRendersItsTile,
} from "./dashboard-live-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.69 U1 DashboardLiveCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupCanvas();
    vi.restoreAllMocks();
  });

  it("L1 shows the empty-state line and draws no tile for an empty dashboard", async () => {
    await emptyDashboardShowsNoWidgetsLine();
  });

  it("L2 renders one widget as a tile", async () => {
    await oneWidgetRendersItsTile();
  });

  it("L3 fetches recent telemetry for a bound widget's ref", async () => {
    await boundWidgetFetchesItsRef();
  });

  it("L4 opens one socket with the session token and disconnects on unmount", async () => {
    await oneSocketWithTokenDisconnectsOnUnmount();
  });
});
