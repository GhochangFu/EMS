import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { EnergyFilterOptions, EnergyView, EnergyViewPeriod, UserRole } from "@bms/shared";

import * as energyApi from "../api/energy-view";
import type { AuthUser } from "../stores/auth-store";
import { EnergyPage } from "./energy-page";
import * as copilotApi from "../api/copilot";

/**
 * The Energy Centre page on `GET /reports/energy/view` (`F4.298` U6, ADR 0108
 * decision 2), and the `F2.8` PUE and `E4.1c` cost claims kept on the new shape.
 *
 * Assertions live here; `energy-page.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * The PUE tile once read `s.pueEstimate.toFixed(2)` directly, so a nullable
 * contract made it a `TypeError` on the first unconfigured tenant rather than a
 * dash.
 */

const NOT_CONFIGURED = "Not configured — no incomer in scope computes site_kw and it_kw";
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";
const ORG = "6f1d2a3b-0000-4000-8000-000000000001";

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

function period(overrides: Partial<EnergyViewPeriod> = {}): EnergyViewPeriod {
  return {
    from: "2026-10-30T11:00:00.000Z",
    to: "2026-10-31T11:00:00.000Z",
    durationHours: 24,
    hasData: true,
    totalKwh: 2250,
    peakKw: 414.66,
    peakAt: "2026-10-31T11:12:00.000Z",
    avgPf: 0.934,
    pueEstimate: 1.25,
    // `E4.1c` — nullable, currency-neutral; `ZAR` here is the fixture's
    // organization, not a field name.
    indicativeCost: 5042.12,
    tariffPerKwh: 2.15,
    currency: "ZAR",
    sourceTotals: { gridKwh: 2000, solarKwh: 200, dgKwh: 50 },
    series: [],
    ...overrides,
  };
}

function view(overrides: Partial<EnergyView> = {}): EnergyView {
  return {
    organizationId: ORG,
    timeZone: "America/New_York",
    generatedAt: "2026-10-31T11:30:00.000Z",
    level: "1h",
    bucket: "1d",
    current: period(),
    compare: null,
    topConsumers: [],
    partial: null,
    ...overrides,
  };
}

function options(organizationCount: 0 | 1): EnergyFilterOptions {
  return {
    organizations: organizationCount === 1 ? [{ id: ORG, code: "ESKOM", name: "Eskom" }] : [],
    locations: [],
  };
}

/** Both of the page's fetches, because an unstubbed one dials `localhost:4000`. */
function stubEnergyApi(served: EnergyView = view(), organizationCount: 0 | 1 = 1) {
  const optionsSpy = vi.spyOn(energyApi, "fetchEnergyFilterOptions").mockResolvedValue(options(organizationCount));
  const viewSpy = vi.spyOn(energyApi, "fetchEnergyView").mockResolvedValue(served);
  return { viewSpy, optionsSpy };
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EnergyPage user={asUser("admin")} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `KpiTile`'s label is a `span` in a flex row in the card, so the card is its grandparent. */
async function tileLabelled(label: string): Promise<HTMLElement> {
  const card = (await screen.findByText(label)).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** The tile once the view has answered (the tile renders its label while loading too). */
async function readyTile(label: string, text: string): Promise<HTMLElement> {
  const tile = await tileLabelled(label);
  await waitFor(() => expect(tile.textContent).toContain(text));
  return tile;
}

/** A measured ratio renders to two decimals. */
export async function aMeasuredRatioRendersOnTheEnergyPage(): Promise<void> {
  stubEnergyApi(view({ current: period({ pueEstimate: 3.26 }) }));
  renderPage();

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("3.26")).toBeInTheDocument();
  expect(within(tile).getByText(MEASURED_HINT)).toBeInTheDocument();
}

/** Nothing configured: the dash and the reason, not a crash and not a zero. */
export async function anUnconfiguredWindowShowsTheDashAndTheReason(): Promise<void> {
  stubEnergyApi(view({ current: period({ pueEstimate: null }) }));
  renderPage();

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText(NOT_CONFIGURED)).toBeInTheDocument();
  expect(within(tile).getByText("—")).toBeInTheDocument();
}

/** `E4.1c` E1 — the cost tile is the `Intl` string for the organization's currency, and the ribbon names the tariff. */
export async function aCostRendersInTheOrganizationsCurrency(): Promise<void> {
  stubEnergyApi();
  renderPage();

  const expected = new Intl.NumberFormat(undefined, { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(
    5042.12,
  );
  const tile = await tileLabelled("Indicative cost");
  // Raw `textContent`, not `findByText`: `Intl` separates the symbol and the
  // digits with U+00A0, which the default matcher's whitespace normaliser
  // would collapse to a space and then fail to match.
  await waitFor(() => expect(tile.textContent).toContain(expected));
  const tariff = new Intl.NumberFormat(undefined, { style: "currency", currency: "ZAR", maximumFractionDigits: 2 }).format(2.15);
  expect(document.body.textContent).toContain(`Tariff ${tariff}/kWh`);
}

/**
 * `E4.1c` E2 — the owed guard. No tariff in scope (or two currencies): the page
 * renders without throwing, the tile is the dash, and the ribbon has no
 * `Tariff` text. (The old field name is not spelled: `tests/adr-0070` part (f)
 * scans specs too.)
 */
export async function aNullCostRendersTheDashWithoutThrowing(): Promise<void> {
  stubEnergyApi(view({ current: period({ indicativeCost: null, tariffPerKwh: null, currency: null }) }));
  renderPage();

  const tile = await tileLabelled("Indicative cost");
  expect(await within(tile).findByText(/No tariff/)).toBeInTheDocument();
  expect(within(tile).getByText("—")).toBeInTheDocument();
  expect(screen.queryByText(/^Tariff /)).toBeNull();
}

/**
 * The peak tile names the peak's time in the view's zone. `America/New_York`
 * is neither UTC (CI) nor `Asia/Kolkata` (the dev machines), so a time
 * formatted in the browser's zone prints `11:12` or `16:42` and fails here.
 */
export async function thePeakTimeIsFormattedInTheViewsZone(): Promise<void> {
  stubEnergyApi();
  renderPage();

  const tile = await readyTile("Peak demand", "Peak at");
  expect(tile.textContent).toContain("Peak at 31 Oct, 07:12");
}

/** The total tile's hint carries the change against the previous period. */
export async function theTotalTileShowsTheChangeAgainstThePreviousPeriod(): Promise<void> {
  stubEnergyApi(view({ compare: period({ totalKwh: 2000 }) }));
  renderPage();

  const tile = await readyTile("Total energy", "vs previous");
  expect(within(tile).getByText("+12.5 % vs previous")).toBeInTheDocument();
}

/** A compare period without data names that, and no percent appears. */
export async function anEmptyPreviousPeriodSaysSo(): Promise<void> {
  stubEnergyApi(view({ compare: period({ hasData: false, totalKwh: 0, peakKw: 0, peakAt: null, avgPf: null }) }));
  renderPage();

  const tile = await readyTile("Total energy", "previous period");
  expect(within(tile).getByText("no data for the previous period")).toBeInTheDocument();
  expect(tile.textContent).not.toContain("%");
}

/**
 * A previous period with kW data but no pf samples: the PF tile says the
 * previous figure is missing, never that it is zero.
 */
export async function aMissingPreviousPowerFactorIsNotCalledZero(): Promise<void> {
  stubEnergyApi(view({ compare: period({ avgPf: null }) }));
  renderPage();

  const tile = await readyTile("Average PF", "previous period");
  expect(within(tile).getByText("no figure for the previous period")).toBeInTheDocument();
  expect(tile.textContent).not.toContain("zero");
}

/** The rollup tile names the level, the bucket and the zone (decision 2.12). */
export async function theRollupTileNamesLevelBucketAndZone(): Promise<void> {
  stubEnergyApi(view({ timeZone: "Asia/Kolkata", level: "1h", bucket: "1d" }));
  renderPage();

  const tile = await readyTile("Rollup", "buckets");
  expect(within(tile).getByText("1h rollup · 1 day buckets · Asia/Kolkata")).toBeInTheDocument();
}

/** A partial scope renders the note. */
export async function aPartialScopeRendersTheNote(): Promise<void> {
  stubEnergyApi(view({ partial: { readableSites: 2, selectedSites: 3 } }));
  renderPage();

  expect(await screen.findByText("partial — your access covers 2 of 3 sites")).toBeInTheDocument();
}

/** The negative pair of {@link aPartialScopeRendersTheNote}: `partial: null` renders no note once the view is in. */
export async function aFullScopeRendersNoNote(): Promise<void> {
  stubEnergyApi(view({ partial: null }));
  renderPage();

  await readyTile("Rollup", "buckets");
  expect(screen.queryByText(/^partial — /)).toBeNull();
}

/** No `pf` point in scope: the dash and the reason, never `0.00`. */
export async function aNullPfRendersTheDashAndTheReason(): Promise<void> {
  stubEnergyApi(view({ current: period({ avgPf: null }) }));
  renderPage();

  const tile = await tileLabelled("Average PF");
  expect(await within(tile).findByText("No pf point in scope")).toBeInTheDocument();
  expect(within(tile).getByText("—")).toBeInTheDocument();
}

/** The positive pair: a sample average renders to two decimals. */
export async function aPfRendersToTwoDecimals(): Promise<void> {
  stubEnergyApi();
  renderPage();

  const tile = await tileLabelled("Average PF");
  expect(await within(tile).findByText("0.93")).toBeInTheDocument();
}

/**
 * No organization, no view: there is no fleet-wide view (owner answer Q3), so a
 * caller whose filter options list no organization never asks for one. The
 * page's message waits for the options read, so the absence is not checked
 * too early.
 */
export async function noViewIsFetchedWithoutAnOrganization(): Promise<void> {
  const { viewSpy, optionsSpy } = stubEnergyApi(view(), 0);
  renderPage();

  expect(await screen.findByText("No organization is in your access.")).toBeInTheDocument();
  expect(optionsSpy).toHaveBeenCalled();
  expect(viewSpy).not.toHaveBeenCalled();
}

/** The positive pair: the one organization is preselected and the view is asked for it. */
export async function theOnlyOrganizationIsPreselectedAndFetched(): Promise<void> {
  const { viewSpy } = stubEnergyApi(view(), 1);
  renderPage();

  await waitFor(() => expect(viewSpy).toHaveBeenCalled());
  expect(viewSpy.mock.calls[0]?.[0]).toEqual({ range: "24h", organizationId: ORG });
}
