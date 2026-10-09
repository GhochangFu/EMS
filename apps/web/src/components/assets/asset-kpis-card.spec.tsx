import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type { AssetKpisResponse, AssetKpiValue } from "@bms/shared";

import { inputAsOfSentence, KPI_STATE_SENTENCE } from "../../lib/asset-kpis-view";
import { AssetKpisCard } from "./asset-kpis-card";

/** `F2.33` (ADR 0097 decision 1) — the KPI card on the asset detail panel. */

const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const AS_OF = "2026-10-09T04:40:00.000Z";

function item(overrides: Partial<AssetKpiValue> & Pick<AssetKpiValue, "code" | "name">): AssetKpiValue {
  return { value: null, state: "ok", inputAsOf: null, excluded: 0, memberCount: 0, ...overrides };
}

function renderCard(items: AssetKpiValue[]) {
  const data: AssetKpisResponse = { assetId: ASSET_ID, windowMinutes: 15, items };
  return render(<AssetKpisCard data={data} />);
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

export function anOkItemShowsItsValueAndNoStateSentence(): void {
  renderCard([item({ code: "kw", name: "Incomer kW", unit: "kW", value: 12.5, inputAsOf: AS_OF })]);
  const li = row("Incomer kW");
  expect(within(li).getByText("12.5 kW")).toBeInTheDocument();
  expect(within(li).queryByText(KPI_STATE_SENTENCE.ok)).not.toBeInTheDocument();
}

export function aStaleItemShowsTheDashTheSentenceAndTheTime(): void {
  renderCard([item({ code: "kw", name: "Incomer kW", unit: "kW", state: "stale_input", inputAsOf: AS_OF })]);
  const li = row("Incomer kW");
  expect(within(li).getByText("—")).toBeInTheDocument();
  expect(within(li).getByText(KPI_STATE_SENTENCE.stale_input)).toBeInTheDocument();
  expect(within(li).getByText(inputAsOfSentence(AS_OF))).toBeInTheDocument();
}

export function aRefusedAggregateShowsTheExcludedCount(): void {
  renderCard([item({ code: "site", name: "Site kW", state: "missing_input", excluded: 1, memberCount: 3 })]);
  expect(within(row("Site kW")).getByText("1 of 3 members excluded")).toBeInTheDocument();
}

export function anUnvalidatedItemShowsItsSentenceAndNoCount(): void {
  renderCard([item({ code: "legacy", name: "Legacy", state: "unvalidated" })]);
  const li = row("Legacy");
  expect(within(li).getByText(KPI_STATE_SENTENCE.unvalidated)).toBeInTheDocument();
  expect(within(li).queryByText(/members/)).not.toBeInTheDocument();
}

export function noItemsSaysSo(): void {
  renderCard([]);
  expect(screen.getByRole("heading", { name: "KPIs" })).toBeInTheDocument();
  expect(screen.getByText("No KPIs on this asset's template.")).toBeInTheDocument();
}

export function itemsKeepTheirOrder(): void {
  renderCard([item({ code: "b", name: "Bravo", value: 1 }), item({ code: "a", name: "Alpha", value: 2 })]);
  const names = screen.getAllByRole("listitem").map((li) => li.querySelector("[data-kpi-name]")?.textContent);
  expect(names).toEqual(["Bravo", "Alpha"]);
}

/** A refusal before the member read carries `excluded: 0` for members nobody read — no freshness claim. */
export function aRefusalBeforeTheMemberReadClaimsNoFreshness(): void {
  renderCard([item({ code: "site", name: "Site kW", state: "stale_input", excluded: 0, memberCount: 3 })]);
  expect(within(row("Site kW")).queryByText(/members/)).not.toBeInTheDocument();
}

/** The positive beside it: an `ok` aggregate under a null ratio had every member fresh, and says so. */
export function anOkAggregateSaysEveryMemberWasFresh(): void {
  renderCard([item({ code: "site", name: "Site kW", value: 6, state: "ok", excluded: 0, memberCount: 3 })]);
  expect(within(row("Site kW")).getByText("All 3 members fresh")).toBeInTheDocument();
}
