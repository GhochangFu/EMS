import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import type { EnergyBill, LocationKpiSummary } from "@bms/shared";

import * as billApi from "../../api/energy-bill";
import { formatMoney } from "../../lib/money";
import { STATION_TOTAL_SENTENCE } from "../../lib/station-view";
import { site } from "../../pages/control-room/organizations-page.spec";
import { BILLED } from "./monthly-bill-card.spec";
import { StationBills } from "./station-bills";

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan D10, D11, Task 2.4) — `StationBills`: one card per
 * site under one month selector, and the station total, which is the site totals added. The real
 * `MonthlyBillCard` renders; `fetchEnergyBill` is spied per location and `fetch` fails the case.
 * Entry point: `station-bills.test.tsx` (ADR 0014, ADR 0042 decision 2).
 */

const ORG = { id: "org-phewb", code: "PHEWB", name: "PHEWB" };
const STATION = "st";
const SITES: LocationKpiSummary[] = [
  { ...site({ id: "st-1", name: "Lotapata I", organization: ORG }), parentId: STATION },
  { ...site({ id: "st-2", name: "Lotapata II", organization: ORG }), parentId: STATION },
];

function billOf(locationId: string, total: number, fields: Partial<EnergyBill> = {}): EnergyBill {
  return { ...BILLED, locationId, bill: { ...(BILLED.bill as NonNullable<EnergyBill["bill"]>), total }, ...fields };
}

const UNMAPPED: Partial<EnergyBill> = { reason: "no_mapping", bill: null, tariff: null, mapping: null, currency: null };

let fetchSpy: Mock | null = null;
let billRead: Mock | null = null;

type Answer = EnergyBill | "reject";

/** Per site id: its answer, the same for every month unless `byMonth` names one. */
function stubBills(answers: Record<string, Answer>, byMonth: Record<string, Record<string, Answer>> = {}): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  billRead = vi.spyOn(billApi, "fetchEnergyBill").mockImplementation((locationId: string, month?: string) => {
    const answer = (month === undefined ? undefined : byMonth[month]?.[locationId]) ?? answers[locationId];
    if (answer === undefined || answer === "reject") return Promise.reject(new Error("locations/energy-bill 500"));
    return Promise.resolve(month === undefined ? answer : { ...answer, month });
  }) as unknown as Mock;
}

let lastClient: QueryClient | null = null;

function renderBills(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <StationBills sites={SITES} />
    </QueryClientProvider>,
  );
}

async function totalLine(): Promise<HTMLElement> {
  const line = await screen.findByTestId("station-bill-total");
  await waitFor(() => expect(line.textContent).not.toMatch(/Loading/));
  return line;
}

const money = (n: number): string => formatMoney(n, "INR", 2) ?? "";

/** B1 — two cards titled by site, one month selector, each card reading its own site. */
export async function oneCardPerSiteAndOneSelector(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500) });
  renderBills();

  expect(await screen.findByRole("heading", { name: "Lotapata I" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Lotapata II" })).toBeTruthy();
  expect(await screen.findAllByLabelText("Billing month")).toHaveLength(1);
  expect(billRead?.mock.calls.map((call) => call[0]).sort()).toEqual(["st-1", "st-2"]);
}

/** B2 — "Station total" is the two totals added, by `formatMoney`, labelled as a sum. */
export async function theTotalIsTheSumOfTheSiteBills(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500) });
  renderBills();

  const line = await totalLine();
  expect(within(line).getByTestId("station-bill-total-amount").textContent).toBe(money(3500));
  expect(line.textContent).toContain("Station total");
  expect(line.textContent).toContain("sum of the site bills");
}

/** B3 — a currency mismatch reads "—" with the sentence. Mutation: show a total anyway => red. */
export async function aCurrencyMismatchShowsNoTotal(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500, { currency: "USD" }) });
  renderBills();

  const line = await totalLine();
  expect(line.textContent).toContain("—");
  expect(line.textContent).toContain(STATION_TOTAL_SENTENCE.currency("Lotapata II"));
  expect(within(line).queryByTestId("station-bill-total-amount")).toBeNull();
}

/** B4 — a rejected site bill reads "—" and names the site. */
export async function aRejectedSiteBillShowsNoTotal(): Promise<void> {
  stubBills({ "st-1": "reject", "st-2": billOf("st-2", 2500) });
  renderBills();

  const line = await totalLine();
  expect(line.textContent).toContain("—");
  expect(line.textContent).toContain(STATION_TOTAL_SENTENCE.failed("Lotapata I"));
}

/** B5 — choosing a month re-reads both sites for that month, and the total follows. */
export async function choosingAMonthRereadsBothSites(): Promise<void> {
  stubBills(
    { "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500) },
    { "2026-09": { "st-1": billOf("st-1", 100), "st-2": billOf("st-2", 200) } },
  );
  renderBills();

  const select = (await screen.findByLabelText("Billing month")) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "2026-09" } });
  await waitFor(() =>
    expect(within(screen.getByTestId("station-bill-total")).queryByTestId("station-bill-total-amount")?.textContent).toBe(
      money(300),
    ),
  );
  const septCalls = billRead?.mock.calls.filter((call) => call[1] === "2026-09").map((call) => call[0]);
  expect(septCalls?.sort()).toEqual(["st-1", "st-2"]);
}

/**
 * B6 — every bill read names a site, never the station, and each site is read once per month: the
 * total shares the cards' cache entries. Mutation: sum from a third read at the station => red.
 */
export async function theTotalAddsNoRead(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500) });
  renderBills();

  await totalLine();
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(billRead?.mock.calls.map((call) => [call[0], call[1]]).sort()).toEqual([
    ["st-1", undefined],
    ["st-2", undefined],
  ]);
}

/** B7 — every site `no_mapping` for the current month: the block renders nothing. */
export async function everySiteUnmappedRendersNothing(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 0, UNMAPPED), "st-2": billOf("st-2", 0, UNMAPPED) });
  const { container } = renderBills();

  await waitFor(() => expect(billRead).toHaveBeenCalledTimes(2));
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(container.innerHTML).toBe("");
}

/**
 * B8 — a background refetch that fails keeps TanStack's old `data` and sets `isError`; the card
 * then shows its error, so the total must not add that old amount. Mutation: read `data` whenever
 * it is set (`own = query.data`) => red.
 */
export async function aFailedRefetchStopsTheTotal(): Promise<void> {
  stubBills({ "st-1": billOf("st-1", 1000), "st-2": billOf("st-2", 2500) });
  renderBills();
  const line = await totalLine();
  expect(within(line).getByTestId("station-bill-total-amount").textContent).toBe(money(3500));

  billRead?.mockImplementation((locationId: string) =>
    locationId === "st-1"
      ? Promise.reject(new Error("locations/energy-bill 500"))
      : Promise.resolve(billOf("st-2", 2500)),
  );
  await act(async () => {
    await lastClient?.refetchQueries({ queryKey: ["energy", "bill", "st-1"] });
  });
  await waitFor(() => expect(line.textContent).toContain(STATION_TOTAL_SENTENCE.failed("Lotapata I")));
  expect(within(line).queryByTestId("station-bill-total-amount")).toBeNull();
}

/**
 * B9 — the first site's default read fails and the second answers: the month selector still
 * appears, from the first site that answered. Mutation: take the month from `reads[0]` only => red.
 */
export async function theSelectorSurvivesAFailedFirstSite(): Promise<void> {
  stubBills({ "st-1": "reject", "st-2": billOf("st-2", 2500) });
  renderBills();

  expect(await screen.findByLabelText("Billing month")).toBeTruthy();
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupBills(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  billRead = null;
  lastClient = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
