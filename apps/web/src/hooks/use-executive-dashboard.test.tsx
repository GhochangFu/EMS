// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import { aNullServerFigureStaysNull, theTileShowsTheServerFigureNotTheSocketSum } from "./use-executive-dashboard.spec";

/** `F4.375` — `useExecutiveDashboard`'s Total load figure (ADR 0133 Amendment 2, plan Q1). */
describe("F4.375 — useExecutiveDashboard shows the server's Total load", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("H1 — a socket frame does not replace the server figure; the chart tail takes it", async () => {
    await theTileShowsTheServerFigureNotTheSocketSum();
  });

  it("H2 — a null server figure stays null", async () => {
    await aNullServerFigureStaysNull();
  });
});
