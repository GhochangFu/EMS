import { describe, it } from "vitest";

import { theHeatmapWindowIsTheHourlyRung } from "./heatmap-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.322 — the heatmap window is the read's hourly rung", () => {
  it("7 and 30 days read hourly; 30 days and a minute does not", () => theHeatmapWindowIsTheHourlyRung());
});
