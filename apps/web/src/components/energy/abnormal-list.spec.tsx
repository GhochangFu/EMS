import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { EnergyAbnormalEntry, EnergyOrganizationViews } from "@bms/shared";

import { baselineSentence } from "../../lib/energy-organization-views";
import { AbnormalList } from "./abnormal-list";

/** `F4.299` U6 — the advisory abnormal list. Entry point: `abnormal-list.test.tsx`. */

type Abnormal = EnergyOrganizationViews["abnormal"];

function entry(overrides: Partial<EnergyAbnormalEntry>): EnergyAbnormalEntry {
  return {
    kind: "asset",
    id: "6f1d2a3b-0000-4000-8000-0000000000e1",
    code: "CH-01",
    name: "Chiller 1",
    siteName: "Alpha",
    currentKwh: 150,
    baselineKwh: 100,
    ratio: 1.5,
    verdict: "above",
    baselineWindows: 4,
    ...overrides,
  };
}

const BASELINE = { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5 };

function abnormal(overrides: Partial<Abnormal> = {}): Abnormal {
  return {
    baseline: BASELINE,
    entries: [
      entry({}),
      entry({
        kind: "site",
        id: "6f1d2a3b-0000-4000-8000-0000000000e2",
        code: null,
        name: "Bravo",
        siteName: "Bravo",
        baselineKwh: null,
        ratio: null,
        verdict: "not_enough_history",
        baselineWindows: 2,
      }),
    ],
    normalCount: { sites: 3, assets: 12 },
    truncated: false,
    ...overrides,
  };
}

function rowOf(name: string): HTMLElement {
  const row = screen.getAllByTestId("abnormal-row").find((r) => r.textContent?.includes(name));
  if (!row) throw new Error(`no abnormal row names ${name}`);
  return row;
}

export function anAboveRowShowsTheRatio(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(rowOf("Chiller 1").textContent).toContain("1.50×");
}

export function aShortHistoryRowSaysNotEnoughHistory(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(rowOf("Bravo").textContent).toContain("not enough history");
  expect(rowOf("Chiller 1").textContent).not.toContain("not enough history");
}

export function theFooterCountsTheNormalEntities(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(screen.getByText("3 sites and 12 assets within their normal range")).toBeInTheDocument();
}

export function theExplanationIsTheBaselineSentence(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(document.body.textContent).toContain(baselineSentence(BASELINE));
}

export function aTruncatedListSaysSo(): void {
  render(<AbnormalList abnormal={abnormal({ truncated: true })} status="ready" />);
  expect(screen.getByText("list truncated to 100")).toBeInTheDocument();
}

/** The negative pair: a whole list carries no truncation line. */
export function aWholeListHasNoTruncationLine(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(screen.queryByText("list truncated to 100")).toBeNull();
}

/** Advisory only (ruling 4.7): rows render, and there is no button and no link, to alarms or anywhere. */
export function theListOffersNoActionAndNoAlarmLink(): void {
  render(<AbnormalList abnormal={abnormal()} status="ready" />);
  expect(screen.getAllByTestId("abnormal-row")).toHaveLength(2);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
}
