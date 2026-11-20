import type { DashboardDto, EnergyBill } from "@bms/shared";
import { expect } from "vitest";

import { SITE_ASSETS_TAB, SITE_TRENDS_TAB } from "./smoc-pages";
import { STATION_TOTAL_SENTENCE, stationBillTotal, stationTabs, type StationBillRead } from "./station-view";

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8, Task 2.1) — `stationTabs`, the station's tab
 * chooser: the union of the sites' dashboard tab keys, first seen wins (sites in list order, then
 * each dashboard's `sortOrder`). Vitest entry point: `station-view.test.ts` (ADR 0014).
 */

type TabsOnly = Pick<DashboardDto, "tabs">;

function tab(key: string, label: string, sortOrder: number): DashboardDto["tabs"][number] {
  return {
    id: `tab-${key}-${sortOrder}`,
    dashboardId: "d",
    organizationId: "o",
    key,
    label,
    sortOrder,
    assetGroupId: null,
  };
}

function dashboard(...tabs: DashboardDto["tabs"]): TabsOnly {
  return { tabs };
}

/** ST-T1 — two dashboards with the same three keys give three entries, in `sortOrder`. */
export function runStationTabsSameKeys(): void {
  const first = dashboard(tab("c", "C", 2), tab("a", "A", 0), tab("b", "B", 1));
  const second = dashboard(tab("b", "B two", 0), tab("c", "C two", 1), tab("a", "A two", 2));
  expect(stationTabs([first, second])).toEqual([
    { key: "a", label: "A" },
    { key: "b", label: "B" },
    { key: "c", label: "C" },
  ]);
}

/** ST-T2 — a key only the second site holds comes after the first site's keys. */
export function runStationTabsSecondOnlyKeyComesAfter(): void {
  const first = dashboard(tab("a", "A", 0), tab("b", "B", 1));
  const second = dashboard(tab("x", "X", 0), tab("a", "A", 1));
  expect(stationTabs([first, second]).map((entry) => entry.key)).toEqual(["a", "b", "x"]);
}

/** ST-T3 — `assets` and `trends` keys are dropped: the page owns those segments. */
export function runStationTabsDropsPageSegments(): void {
  const first = dashboard(tab(SITE_ASSETS_TAB, "Assets", 0), tab("a", "A", 1), tab(SITE_TRENDS_TAB, "Trends", 2));
  expect(stationTabs([first])).toEqual([{ key: "a", label: "A" }]);
}

/** ST-T4 — an `undefined` entry (a pending or non-dashboard site) is skipped. */
export function runStationTabsSkipsUndefined(): void {
  const second = dashboard(tab("b", "B", 0));
  expect(stationTabs([undefined, second])).toEqual([{ key: "b", label: "B" }]);
}

/** ST-T5 — every entry `undefined` gives `[]`. */
export function runStationTabsAllUndefined(): void {
  expect(stationTabs([undefined, undefined])).toEqual([]);
}

/** ST-T6 — the cached DTO's tab order is never changed (the rule sorts a copy). */
export function runStationTabsLeavesTheDtoAlone(): void {
  const first = dashboard(tab("b", "B", 1), tab("a", "A", 0));
  stationTabs([first]);
  expect(first.tabs.map((entry) => entry.key)).toEqual(["b", "a"]);
}

/**
 * `stationBillTotal` (ADR 0140 decision 3f, plan D11). Each site's `total` differs from its
 * `energyCharge`, so summing the wrong field reddens SB1.
 */
function bill(fields: Partial<EnergyBill> = {}, priced: Partial<NonNullable<EnergyBill["bill"]>> = {}): EnergyBill {
  return {
    locationId: "11111111-1111-4111-8111-111111111111",
    month: "2026-10",
    timeZone: "Asia/Kolkata",
    from: "2026-09-30T18:30:00.000Z",
    to: "2026-10-31T18:30:00.000Z",
    complete: true,
    currency: "INR",
    reason: null,
    dataStatus: "official",
    tariff: null,
    mapping: null,
    bill: {
      units: 100,
      unitType: "kwh",
      estimated: false,
      metersBilled: [],
      metersMissing: [],
      overflowUnits: 0,
      slabLines: [],
      energyCharge: 800,
      highestSlabNo: 1,
      fixedRate: 0,
      fixedCharge: 150,
      wheelingCharge: 50,
      total: 1000,
      ...priced,
    },
    ...fields,
  };
}

function read(siteName: string, answer: EnergyBill | "failed" | "pending"): StationBillRead {
  return {
    siteName,
    bill: answer === "failed" || answer === "pending" ? undefined : answer,
    failed: answer === "failed",
  };
}

const UNMAPPED = bill({ reason: "no_mapping", bill: null, currency: null, tariff: null });

/** SB1 — two priced bills, same month and currency: the totals added; complete and estimated folded. */
export function runStationBillTotalSums(): void {
  expect(stationBillTotal([read("I", bill()), read("II", bill({}, { total: 2500, energyCharge: 2000 }))])).toEqual({
    kind: "total",
    total: 3500,
    currency: "INR",
    month: "2026-10",
    complete: true,
    estimated: false,
  });
  const folded = stationBillTotal([read("I", bill({ complete: false })), read("II", bill({}, { estimated: true }))]);
  expect(folded).toMatchObject({ kind: "total", complete: false, estimated: true });
}

/** SB2 — a rejected read: no total, the sentence names the site. */
export function runStationBillTotalFailedRead(): void {
  expect(stationBillTotal([read("I", bill()), read("II", "failed")])).toEqual({
    kind: "none",
    sentence: STATION_TOTAL_SENTENCE.failed("II"),
  });
}

/** SB3 — a bill with a reason (one site unmapped, or unpriced): no total. */
export function runStationBillTotalReason(): void {
  for (const other of [UNMAPPED, bill({ reason: "meter_no_reading", bill: null })]) {
    expect(stationBillTotal([read("I", bill()), read("II", other)])).toEqual({
      kind: "none",
      sentence: STATION_TOTAL_SENTENCE.unpriced("II"),
    });
  }
}

/** SB4 — two months: no total. Mutation: skip the month test => a sum => red. */
export function runStationBillTotalTwoMonths(): void {
  expect(stationBillTotal([read("I", bill()), read("II", bill({ month: "2026-09" }))])).toEqual({
    kind: "none",
    sentence: STATION_TOTAL_SENTENCE.month("II"),
  });
}

/** SB5 — two currencies: no total. Mutation: skip the currency test => a sum => red. */
export function runStationBillTotalTwoCurrencies(): void {
  expect(stationBillTotal([read("I", bill()), read("II", bill({ currency: "USD" }))])).toEqual({
    kind: "none",
    sentence: STATION_TOTAL_SENTENCE.currency("II"),
  });
}

/** SB6 — a `null` currency on a priced bill: no total. */
export function runStationBillTotalNullCurrency(): void {
  expect(stationBillTotal([read("I", bill({ currency: null })), read("II", bill())])).toEqual({
    kind: "none",
    sentence: STATION_TOTAL_SENTENCE.noCurrency("I"),
  });
}

/** SB7 — every site `no_mapping`: nothing to show. */
export function runStationBillTotalNothing(): void {
  expect(stationBillTotal([read("I", UNMAPPED), read("II", UNMAPPED)])).toEqual({ kind: "nothing" });
  expect(stationBillTotal([])).toEqual({ kind: "nothing" });
}

/** SB8 — a pending read: pending, even beside a failed one. */
export function runStationBillTotalPending(): void {
  expect(stationBillTotal([read("I", bill()), read("II", "pending")])).toEqual({ kind: "pending" });
  expect(stationBillTotal([read("I", "failed"), read("II", "pending")])).toEqual({ kind: "pending" });
}
