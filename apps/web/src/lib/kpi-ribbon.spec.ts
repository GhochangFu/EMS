import { expect } from "vitest";

import type { DashboardKpis } from "@bms/shared";

import { kpiRibbonHints } from "./kpi-ribbon";

/**
 * `F3.28` task 2.5 — the executive ribbon's hint and note lines.
 *
 * The expected strings are spelled here as literals, not imported from
 * `kpi-ribbon.ts`: an import would move with a mutated constant and turn every
 * text check into a tautology.
 */

function kpis(overrides: Partial<DashboardKpis> = {}): DashboardKpis {
  return {
    totalKw: 1100,
    sitesOnline: 9,
    sitesTotal: 9,
    alarmsOpen: 0,
    alarmsCritical: 0,
    pueEstimate: null,
    asOf: "2026-09-05T12:00:00.000Z",
    prior: { asOf: "2026-09-04T12:00:00.000Z", totalKw: 1000, alarmsOpen: 0, pueEstimate: null },
    ...overrides,
  };
}

/** A 10 % rise in the server's `totalKw` over its prior is an up-arrow 10.0 %. */
export function aTenPercentLoadRiseIsAnUpDelta(): void {
  expect(kpiRibbonHints(kpis()).totalLoadHint).toBe("↑ 10.0% vs yesterday");
}

/** No prior load: the fixed line from before `F3.28`. */
export function aNullLoadPriorKeepsTheFixedHint(): void {
  const kpi = kpis({ prior: { ...kpis().prior, totalKw: null } });
  expect(kpiRibbonHints(kpi).totalLoadHint).toBe("Sum of latest kW per asset");
}

/** OQ5: with no alarm delta the hint is the fixed "Active — not yet cleared". */
export function noAlarmDeltaReadsActiveNotYetCleared(): void {
  expect(kpiRibbonHints(kpis({ alarmsOpen: 3 })).openAlarmsHint).toBe("Active — not yet cleared");
}

/** OQ5: an alarm delta goes in the hint. */
export function anAlarmDeltaGoesInTheHint(): void {
  const kpi = kpis({ alarmsOpen: 6, prior: { ...kpis().prior, alarmsOpen: 4 } });
  expect(kpiRibbonHints(kpi).openAlarmsHint).toBe("↑ 50.0% vs yesterday");
}

/** OQ5: "N critical" is the note, not the hint. */
export function criticalCountIsTheNote(): void {
  expect(kpiRibbonHints(kpis({ alarmsOpen: 3, alarmsCritical: 2 })).openAlarmsNote).toBe(
    "2 critical",
  );
}

/** No critical alarm, no note line. */
export function noCriticalMeansNoNote(): void {
  expect(kpiRibbonHints(kpis({ alarmsOpen: 3 })).openAlarmsNote).toBeUndefined();
}

/** A PUE fall is a down-arrow delta. */
export function aPueFallIsADownDelta(): void {
  const kpi = kpis({ pueEstimate: 1.5, prior: { ...kpis().prior, pueEstimate: 2 } });
  expect(kpiRibbonHints(kpi).pueDeltaText).toBe("↓ 25.0% vs yesterday");
}

/** No prior PUE: no delta text, so the page keeps `pueTileProps`' hint. */
export function aNullPuePriorHasNoDeltaText(): void {
  const kpi = kpis({ pueEstimate: 1.5 });
  expect(kpiRibbonHints(kpi).pueDeltaText).toBeUndefined();
}

/** A query that has not settled: every tile shows its fixed line. */
export function anUnsettledQueryShowsTheFixedLines(): void {
  expect(kpiRibbonHints(undefined)).toEqual({
    totalLoadHint: "Sum of latest kW per asset",
    openAlarmsHint: "Active — not yet cleared",
    openAlarmsNote: undefined,
    pueDeltaText: undefined,
  });
}
