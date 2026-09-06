import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardKpis, HealthSummaryResponse, UserRole } from "@bms/shared";

import * as assetHealthApi from "../api/asset-health";
import * as locationsApi from "../api/locations";
import * as executiveDashboard from "../hooks/use-executive-dashboard";
import type { AuthUser } from "../stores/auth-store";
import { DashboardPage } from "./dashboard-page";

/**
 * `F2.8` — the Executive Dashboard PUE tile, on a measured ratio and on a null.
 *
 * Assertions live here; `dashboard-page.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock, because that is the file
 * Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **What this file is for.** Before `F2.8` this page did not render the API's
 * `pueEstimate` at all when live telemetry was flowing: it recomputed a fitted
 * curve from `displayTotalKw` through `lib/pue-estimate.ts`, so the tile could
 * disagree with the CSV export of the same estate. Ruling 4 deletes the curve
 * and makes the field nullable, and the case that has to be right is the null
 * one — `KpiTile` renders `—` for `status === "empty"` only, so passing the
 * query's own `ready` through would paint a blank tile with no dash and no
 * reason. That is a rendering nobody would report as a bug and nobody could act
 * on, which is why it is asserted on the rendered strings rather than on
 * `pueTileProps` alone.
 */

const NOT_CONFIGURED = "Not configured — no incomer in scope computes site_kw and it_kw";
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

function kpis(pueEstimate: number | null): DashboardKpis {
  return {
    totalKw: 1447.3,
    sitesOnline: 9,
    sitesTotal: 9,
    alarmsOpen: 0,
    alarmsCritical: 0,
    pueEstimate,
    asOf: "2026-09-05T12:00:00.000Z",
  };
}

/**
 * The hook is stubbed whole rather than at its two fetches: it opens a Socket.IO
 * connection on mount, and a unit test has no business dialling one.
 */
function stubDashboard(pueEstimate: number | null, stale = false): void {
  vi.spyOn(executiveDashboard, "useExecutiveDashboard").mockReturnValue({
    kpiQuery: { data: kpis(pueEstimate), isLoading: false, isError: false },
    trendQuery: { data: { points: [] }, isLoading: false, isError: false },
    stale,
    displayTotalKw: 1447.3,
    chartPoints: [],
  } as unknown as ReturnType<typeof executiveDashboard.useExecutiveDashboard>);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [] });
  // `HealthSummarySection` is a child with its own query. Stubbed to an empty
  // scope so the page paints without a request leaving the test process.
  vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue({
    assetCount: 0,
  } as unknown as HealthSummaryResponse);
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage user={asUser("admin")} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The tile is found by its label and read inside its own card, so a `—` on the
 * neighbouring "Sites online" tile cannot satisfy the assertion.
 *
 * `KpiTile`'s label is a `span` inside a flex row inside the card, so the card
 * is the label's grandparent.
 */
function tileLabelled(label: string): HTMLElement {
  const card = screen.getByText(label).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** A measured ratio renders to two decimals, under the label the UI now uses. */
export async function aMeasuredRatioRendersOnTheDashboard(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  const tile = tileLabelled("PUE");
  expect(await within(tile).findByText("1.42")).toBeInTheDocument();
  expect(within(tile).getByText(MEASURED_HINT)).toBeInTheDocument();
}

/** Nothing configured: the dash, and the sentence that says what to configure. */
export async function anUnconfiguredEstateShowsTheDashAndTheReason(): Promise<void> {
  stubDashboard(null);
  renderPage();

  const tile = tileLabelled("PUE");
  expect(await within(tile).findByText("—")).toBeInTheDocument();
  expect(within(tile).getByText(NOT_CONFIGURED)).toBeInTheDocument();
  // The curve is gone: a live `displayTotalKw` of 1447.3 used to produce `1.34`
  // here regardless of what the API said.
  expect(within(tile).queryByText("1.34")).not.toBeInTheDocument();
}

/**
 * How `KpiTile` marks a tile stale: an amber ring on the card's own element.
 * `ring-2` is the discriminating class — the tile also renders a
 * "Stale · no telemetry ~10s" line, but only for `status === "ready"`, so on
 * the empty tile the ring is the *only* thing a reader would see and the only
 * thing an assertion can catch.
 */
const STALE_RING = "ring-2";

/**
 * **An unconfigured PUE tile carries no stale ring** (code review, finding F).
 *
 * The page passed `stale={stale && kpiStatus === "ready"}` to a tile whose own
 * status `pueTileProps` may have turned into `empty`. A stale estate with no
 * incomer configured therefore drew the amber ring around `—  Not configured …`
 * — an alarm colour on a tile that has nothing to be stale about, with no text
 * to explain it, because `KpiTile` gates the "Stale" line on `ready`. The page
 * now computes the props once and reads the ring off the tile's real status.
 *
 * The "Total load" tile is asserted in the same render as the anti-vacuity
 * half: it proves the `stale` flag reached the page at all, so a green run
 * cannot come from a stub that quietly said "live".
 */
export async function anUnconfiguredPueTileCarriesNoStaleRing(): Promise<void> {
  stubDashboard(null, true);
  renderPage();

  const pue = tileLabelled("PUE");
  expect(await within(pue).findByText("—")).toBeInTheDocument();
  expect(
    pue.className,
    "an empty PUE tile must not wear the amber stale ring: KpiTile draws no Stale text for a " +
      "non-ready status, so the ring would be an unexplained alarm colour on a dash",
  ).not.toContain(STALE_RING);

  const totalLoad = tileLabelled("Total load");
  expect(
    totalLoad.className,
    "the stale flag did not reach the page — every assertion above would pass vacuously",
  ).toContain(STALE_RING);
}

/** The other direction: a measured ratio on a stale estate still rings. */
export async function aMeasuredPueTileStillCarriesTheStaleRing(): Promise<void> {
  stubDashboard(1.42, true);
  renderPage();

  const pue = tileLabelled("PUE");
  expect(await within(pue).findByText("1.42")).toBeInTheDocument();
  expect(pue.className).toContain(STALE_RING);
}
