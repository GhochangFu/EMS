import { expect } from "vitest";

import { excludedSentence, formatKpiValue, inputAsOfSentence, KPI_STATE_SENTENCE } from "./asset-kpis-view";

/** `F2.33` (ADR 0097) — the KPI card's words, as pure functions. */

export function valueCarriesItsUnit(): void {
  expect(formatKpiValue(12.5, "kW")).toBe("12.5 kW");
}

export function valueWithoutAUnitIsTheNumber(): void {
  expect(formatKpiValue(4, undefined)).toBe("4");
}

export function aNullValueIsTheEmDash(): void {
  expect(formatKpiValue(null, "kW")).toBe("—");
}

/** Excluded first, members second — a swapped pair reads "3 of 1". */
export function excludedSentenceNamesExcludedOfMembers(): void {
  expect(excludedSentence(1, 3)).toBe("1 of 3 members excluded");
}

export function noExcludedMemberSaysSo(): void {
  expect(excludedSentence(0, 3)).toBe("All 3 members fresh");
}

export function inputAsOfSentenceNamesTheTime(): void {
  const iso = "2026-10-09T05:00:00.000Z";
  expect(inputAsOfSentence(iso)).toBe(`Inputs as of ${new Date(iso).toLocaleString()}`);
}

export function everyStateHasASentence(): void {
  for (const [state, sentence] of Object.entries(KPI_STATE_SENTENCE)) {
    expect(sentence.length, `state ${state} needs a sentence`).toBeGreaterThan(0);
  }
  expect(KPI_STATE_SENTENCE.stale_input).toMatch(/stale/i);
}
