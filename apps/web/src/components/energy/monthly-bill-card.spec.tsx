import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { EnergyBill } from "@bms/shared";

import * as billApi from "../../api/energy-bill";
import { formatMoney } from "../../lib/money";
import { BILL_FOOTNOTE, BILL_REASON_TEXT, MonthlyBillCard, monthOptions } from "./monthly-bill-card";
import { TARIFF_VERIFY_TITLE } from "./tariff-verify-badge";

/**
 * `F4.365` U10 (ADR 0134 decisions 6, 7, 9; Amendment 1) — the monthly bill card. The api client
 * is stubbed (an unstubbed fetch reaches `:4000`). Entry point: `monthly-bill-card.test.tsx`.
 */

const LOC = "11111111-1111-4111-8111-111111111111";

const BILLED: EnergyBill = {
  locationId: LOC,
  month: "2026-10",
  timeZone: "Asia/Kolkata",
  from: "2026-09-30T18:30:00.000Z",
  to: "2026-10-31T18:30:00.000Z",
  complete: true,
  currency: "INR",
  reason: null,
  dataStatus: "official",
  tariff: {
    key: "KL/LT-IV",
    versionId: "33333333-3333-4333-8333-333333333333",
    source: "catalog",
    name: "LT-IV Industrial",
    state: "Kerala",
    energyUnit: "kwh",
    fixedBasis: "per_kw_month",
    effectiveFrom: "2025-04-01",
    tariffOrder: null,
    sourceUrl: "https://example.org/order",
  },
  mapping: {
    id: "44444444-4444-4444-8444-444444444444",
    billingMeterAssetId: "55555555-5555-4555-8555-555555555555",
    sanctionedLoad: 10,
    sanctionedLoadUnit: "kw",
  },
  bill: {
    units: 1500,
    unitType: "kwh",
    estimated: false,
    overflowUnits: 0,
    slabLines: [
      { slabNo: 1, fromUnits: 0, toUnits: 1000, units: 1000, energyRate: 5, energyCharge: 5000, wheelingRate: 0, wheelingCharge: 0 },
      { slabNo: 2, fromUnits: 1000, toUnits: null, units: 500, energyRate: 6, energyCharge: 3000, wheelingRate: 0, wheelingCharge: 0 },
    ],
    energyCharge: 8000,
    highestSlabNo: 2,
    fixedRate: 100,
    fixedCharge: 1000,
    wheelingCharge: 250,
    total: 9250,
  },
};

function stubBill(answer: EnergyBill | Error) {
  const spy = vi.spyOn(billApi, "fetchEnergyBill");
  if (answer instanceof Error) {
    spy.mockRejectedValue(answer);
  } else {
    spy.mockResolvedValue(answer);
  }
  return spy;
}

function renderCard(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MonthlyBillCard locationId={LOC} />
    </QueryClientProvider>,
  );
}

const money = (n: number, digits = 2): string => formatMoney(n, "INR", digits) ?? "";

export async function aBilledMonthShowsUnitsSlabLinesChargesAndTotal(): Promise<void> {
  stubBill(BILLED);
  renderCard();
  expect(await screen.findByRole("heading", { name: "Monthly bill" })).toBeTruthy();
  expect(screen.getByText(/1,500 kWh/)).toBeTruthy();
  expect(screen.getByText(`1,000 × ${money(5, 4)}`)).toBeTruthy();
  expect(screen.getByText(`500 × ${money(6, 4)}`)).toBeTruthy();
  expect(screen.getByText(money(5000))).toBeTruthy();
  expect(screen.getByText(money(8000))).toBeTruthy();
  expect(screen.getByText(money(1000))).toBeTruthy();
  expect(screen.getByText(money(250))).toBeTruthy();
  // The total is in the heading figure and the table's total row.
  expect(screen.getAllByText(money(9250))).toHaveLength(2);
  expect(screen.getByText(BILL_FOOTNOTE)).toBeTruthy();
  expect(screen.getByText(/Excludes electricity duty, FPPAS\/FAC and subsidies\./)).toBeTruthy();
}

export async function aKvahBillNamesItsUnitType(): Promise<void> {
  stubBill({ ...BILLED, bill: { ...BILLED.bill!, unitType: "kvah" } });
  renderCard();
  expect(await screen.findByText(/1,500 kVAh/)).toBeTruthy();
}

export async function theTariffNameStateDateAndSafeSourceLinkShow(): Promise<void> {
  stubBill(BILLED);
  renderCard();
  expect(await screen.findByText(/LT-IV Industrial · Kerala · effective 2025-04-01/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "Source" });
  expect(link.getAttribute("href")).toBe("https://example.org/order");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
}

export async function aNonHttpSourceUrlIsNotALink(): Promise<void> {
  stubBill({ ...BILLED, tariff: { ...BILLED.tariff!, sourceUrl: "javascript:alert(1)" } });
  renderCard();
  await screen.findByRole("heading", { name: "Monthly bill" });
  expect(screen.queryByRole("link", { name: "Source" })).toBeNull();
}

export async function anIncompleteMonthSaysMonthToDate(): Promise<void> {
  stubBill({ ...BILLED, complete: false });
  renderCard();
  expect(await screen.findByText("Month to date")).toBeTruthy();
}

export async function aCompleteMonthDoesNotSayMonthToDate(): Promise<void> {
  stubBill(BILLED);
  renderCard();
  await screen.findByRole("heading", { name: "Monthly bill" });
  expect(screen.queryByText("Month to date")).toBeNull();
}

export async function aNonOfficialTariffShowsTheVerifyBadge(): Promise<void> {
  stubBill({ ...BILLED, dataStatus: "secondary" });
  renderCard();
  await screen.findByRole("heading", { name: "Monthly bill" });
  expect(screen.getByText("Verify")).toBeTruthy();
  expect(screen.getByLabelText(`Verify: ${TARIFF_VERIFY_TITLE}`)).toBeTruthy();
}

export async function anOfficialTariffShowsNoVerifyBadge(): Promise<void> {
  stubBill(BILLED);
  renderCard();
  await screen.findByRole("heading", { name: "Monthly bill" });
  expect(screen.queryByText("Verify")).toBeNull();
}

export async function anEstimatedBillSaysEstimated(): Promise<void> {
  stubBill({ ...BILLED, bill: { ...BILLED.bill!, estimated: true } });
  renderCard();
  expect(await screen.findByText("Estimated")).toBeTruthy();
}

export async function overflowUnitsShowTheLastSlabWarning(): Promise<void> {
  stubBill({ ...BILLED, bill: { ...BILLED.bill!, overflowUnits: 250 } });
  renderCard();
  expect(
    await screen.findByText("250 units above the tariff's last slab are charged at its last slab's rate"),
  ).toBeTruthy();
}

export async function noOverflowShowsNoWarning(): Promise<void> {
  stubBill(BILLED);
  renderCard();
  await screen.findByRole("heading", { name: "Monthly bill" });
  expect(screen.queryByText(/above the tariff's last slab/)).toBeNull();
}

export async function noMappingRendersNothing(): Promise<void> {
  const spy = stubBill({ ...BILLED, reason: "no_mapping", tariff: null, mapping: null, bill: null, dataStatus: null });
  const { container } = renderCard();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelector("section")).toBeNull());
  expect(screen.queryByText("Monthly bill")).toBeNull();
}

export async function eachOtherReasonShowsItsOwnSentence(): Promise<void> {
  for (const reason of ["no_version_in_force", "meter_no_reading", "meter_decreasing", "kvah_unavailable", "load_unit_mismatch", "version_invalid"] as const) {
    stubBill({ ...BILLED, reason, bill: null, dataStatus: null });
    const view = renderCard();
    expect(await screen.findByText(BILL_REASON_TEXT[reason])).toBeTruthy();
    expect(screen.queryByText(money(9250))).toBeNull();
    view.unmount();
    vi.restoreAllMocks();
  }
}

export async function theSelectorOffersTheCurrentMonthAnd24Back(): Promise<void> {
  const options = monthOptions("2026-11");
  expect(monthOptions("2026-01")[1]!.value).toBe("2025-12");
  expect(options).toHaveLength(25);
  expect(options[0]).toMatchObject({ value: "" });
  expect(options[1]!.value).toBe("2026-10");
  expect(options[12]!.value).toBe("2025-11");
  expect(options[24]!.value).toBe("2024-11");
  expect(options.map((o) => o.value).filter((v) => v > "2026-11")).toEqual([]);
}

export async function choosingAMonthRefetchesThatMonth(): Promise<void> {
  const spy = stubBill(BILLED);
  renderCard();
  const select = (await screen.findByLabelText("Billing month")) as HTMLSelectElement;
  expect(spy).toHaveBeenLastCalledWith(LOC, undefined);
  fireEvent.change(select, { target: { value: "2026-09" } });
  await waitFor(() => expect(spy).toHaveBeenLastCalledWith(LOC, "2026-09"));
}

export async function aFailedReadIsAFixedSentence(): Promise<void> {
  stubBill(new Error("locations/energy-bill 500"));
  renderCard();
  expect(await screen.findByText("Could not load the monthly bill.")).toBeTruthy();
}

/** While the chosen month loads, the previous bill and the selector stay on screen. */
export async function theSelectorStaysWhileTheNextMonthLoads(): Promise<void> {
  const spy = vi.spyOn(billApi, "fetchEnergyBill");
  spy.mockResolvedValueOnce(BILLED);
  // The next month never answers: the card must not drop to nothing meanwhile.
  spy.mockReturnValueOnce(new Promise<EnergyBill>(() => undefined));
  renderCard();
  const select = (await screen.findByLabelText("Billing month")) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "2026-09" } });
  await waitFor(() => expect(spy).toHaveBeenLastCalledWith(LOC, "2026-09"));
  const still = screen.getByLabelText("Billing month") as HTMLSelectElement;
  expect(still.value).toBe("2026-09");
  expect(screen.getAllByText(money(9250))).toHaveLength(2);
}

/** A month whose read fails keeps the selector, so the reader can go back. */
export async function aFailedMonthKeepsTheSelector(): Promise<void> {
  const spy = vi.spyOn(billApi, "fetchEnergyBill");
  spy.mockImplementation(async (_location, month) => {
    if (month === "2026-09") throw new Error("locations/energy-bill 500");
    return BILLED;
  });
  renderCard();
  const select = (await screen.findByLabelText("Billing month")) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "2026-09" } });
  expect(await screen.findByText("Could not load the monthly bill.")).toBeTruthy();
  const back = screen.getByLabelText("Billing month") as HTMLSelectElement;
  expect(back.value).toBe("2026-09");
  fireEvent.change(back, { target: { value: "" } });
  await waitFor(() => expect(screen.getAllByText(money(9250))).toHaveLength(2));
  expect(screen.queryByText("Could not load the monthly bill.")).toBeNull();
}
