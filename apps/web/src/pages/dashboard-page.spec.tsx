import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  DashboardKpis,
  DashboardSummaryDto,
  HealthSummaryResponse,
  LocationKpiSummary,
  UserRole,
} from "@bms/shared";

import * as assetHealthApi from "../api/asset-health";
import * as dashboardsApi from "../api/dashboards";
import * as locationsApi from "../api/locations";
import * as executiveDashboard from "../hooks/use-executive-dashboard";
import { WIDGET_ICON_PATH } from "../lib/widget-catalog";
import type { AuthUser } from "../stores/auth-store";
import { ORG_A, ORG_B, site } from "./control-room/organizations-page.spec";
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

function kpis(pueEstimate: number | null, overrides: Partial<DashboardKpis> = {}): DashboardKpis {
  return {
    totalKw: 1447.3,
    sitesOnline: 9,
    sitesTotal: 9,
    alarmsOpen: 0,
    alarmsCritical: 0,
    pueEstimate,
    asOf: "2026-09-05T12:00:00.000Z",
    // No prior value that yields a delta: every hint here is the fixed line,
    // which is what the `F2.8` PUE cases below assert. The `F3.28` cases pass
    // `overrides` to give a prior.
    prior: { asOf: "2026-09-04T12:00:00.000Z", totalKw: null, alarmsOpen: 0, pueEstimate: null },
    ...overrides,
  };
}

/**
 * The hook is stubbed whole rather than at its two fetches: it opens a Socket.IO
 * connection on mount, and a unit test has no business dialling one.
 */
function stubDashboard(
  pueEstimate: number | null,
  stale = false,
  overrides: Partial<DashboardKpis> = {},
  locations: LocationKpiSummary[] = [],
  dashboards: DashboardSummaryDto[] = [],
): void {
  vi.spyOn(executiveDashboard, "useExecutiveDashboard").mockReturnValue({
    kpiQuery: { data: kpis(pueEstimate, overrides), isLoading: false, isError: false },
    trendQuery: { data: { points: [] }, isLoading: false, isError: false },
    stale,
    displayTotalKw: 1447.3,
    chartPoints: [],
  } as unknown as ReturnType<typeof executiveDashboard.useExecutiveDashboard>);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: locations });
  // `F3.72` (plan D2) — the estate's "Dashboards" section reads the library list.
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: dashboards });
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
 * `ring-2` is the discriminating class. Since `F4.164` U1 the tile's
 * "Stale · no telemetry ~10s" line follows the same truthy `stale` the ring
 * does, but this suite still reads the ring rather than the caption text,
 * because it is the ring — not the caption — that this page's own
 * `stale && kpiStatus === "ready"` decision controls.
 */
const STALE_RING = "ring-2";

/**
 * **An unconfigured PUE tile carries no stale ring** (code review, finding F).
 *
 * The page passed `stale={stale && kpiStatus === "ready"}` to a tile whose own
 * status `pueTileProps` may have turned into `empty`. A stale estate with no
 * incomer configured therefore drew the amber ring around `—  Not configured …`
 * — an alarm colour on a tile that has nothing to be stale about, with no text
 * to explain it, because `KpiTile` gated the "Stale" line on `ready` at the
 * time (`F4.164` U1 removed that gate). The page now computes the props once
 * and reads the ring off the tile's real status.
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

/**
 * `F3.30` (ADR 0075 decision 2) — the Sites online hint states the freshness
 * window from `FRESH_MS`, not a hardcoded `~20s`.
 */
export async function sitesOnlineHintReadsTheFreshnessWindow(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  const tile = tileLabelled("Sites online");
  expect(await within(tile).findByText("Sites with fresh telemetry (~25s)")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.28` task 2.5 — vs-yesterday deltas, the OQ5 alarm hint, and the icons.
//
// Expected strings are literals here, never imported from `kpi-ribbon.ts`, so
// a mutated constant cannot carry its assertion with it.
// ---------------------------------------------------------------------------

const PRIOR = { asOf: "2026-09-04T12:00:00.000Z", totalKw: null, alarmsOpen: 0, pueEstimate: null };

/**
 * A 10 % rise in the **server's** `totalKw` over its prior renders in the Total
 * load tile. `displayTotalKw` stays 1447.3 in the stub, so a delta computed from
 * the displayed socket sum would print 44.7 % — this case also holds plan
 * decision 5 (server against server).
 */
export async function aTenPercentLoadRiseRendersInTheTotalLoadTile(): Promise<void> {
  stubDashboard(null, false, { totalKw: 1100, prior: { ...PRIOR, totalKw: 1000 } });
  renderPage();

  const tile = tileLabelled("Total load");
  expect(await within(tile).findByText("↑ 10.0% vs yesterday")).toBeInTheDocument();
}

/** A null prior: the Total load tile keeps its fixed line. */
export async function aNullLoadPriorRendersTheFixedHint(): Promise<void> {
  stubDashboard(null, false, { totalKw: 1100 });
  renderPage();

  const tile = tileLabelled("Total load");
  expect(await within(tile).findByText("Sum of latest kW per asset")).toBeInTheDocument();
}

/** OQ5: with no alarm delta the Open alarms hint reads "Active — not yet cleared". */
export async function openAlarmsWithoutADeltaReadActiveNotYetCleared(): Promise<void> {
  stubDashboard(null, false, { alarmsOpen: 3 });
  renderPage();

  const tile = tileLabelled("Open alarms");
  expect(await within(tile).findByText("Active — not yet cleared")).toBeInTheDocument();
}

/**
 * OQ5: the old "Unacknowledged rows" literal is gone. The positive control is
 * the alarm count — data the stub produces and that the literal cannot change —
 * awaited first, so the absence check runs against a rendered tile.
 */
export async function theUnacknowledgedRowsLiteralIsGone(): Promise<void> {
  stubDashboard(null, false, { alarmsOpen: 3 });
  renderPage();

  const tile = tileLabelled("Open alarms");
  expect(await within(tile).findByText("3")).toBeInTheDocument();
  expect(within(tile).queryByText("Unacknowledged rows")).not.toBeInTheDocument();
}

/**
 * OQ5: "N critical" renders on `KpiTile`'s note line — the amber
 * `text-warning-ink` paragraph — not in the muted hint slot.
 */
export async function theCriticalCountRendersInTheNote(): Promise<void> {
  stubDashboard(null, false, { alarmsOpen: 3, alarmsCritical: 2 });
  renderPage();

  const tile = tileLabelled("Open alarms");
  const note = await within(tile).findByText("2 critical");
  expect(note.className, "the critical count is not on the note line").toContain("text-warning-ink");
}

/**
 * A PUE delta replaces `pueTileProps`' hint on the page. The page chooses
 * between the two itself, so the pure `kpi-ribbon` spec cannot hold this.
 */
export async function aPueFallRendersInThePueTile(): Promise<void> {
  stubDashboard(1.5, false, { prior: { ...PRIOR, pueEstimate: 2 } });
  renderPage();

  const tile = tileLabelled("PUE");
  expect(await within(tile).findByText("↓ 25.0% vs yesterday")).toBeInTheDocument();
}

/**
 * The icon cases wait on the Sites online value: data the stub produces that no
 * hint or note change can alter, so an icon case reddens only on its icon.
 */
async function ribbonSettled(): Promise<void> {
  await within(tileLabelled("Sites online")).findByText("9 / 9");
}

/** The `d` of the one icon path inside a tile, or `null` when the tile has no icon. */
function iconPathOf(tile: HTMLElement): string | null {
  const svg = tile.querySelector("svg");
  return svg ? (svg.querySelector("path")?.getAttribute("d") ?? "") : null;
}

/** Plan decision 8: Total load wears `bolt`. */
export async function totalLoadWearsTheBoltIcon(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  await ribbonSettled();
  const tile = tileLabelled("Total load");
  expect(iconPathOf(tile)).toBe(WIDGET_ICON_PATH.bolt);
}

/** Plan decision 8: Open alarms wears `alert`. */
export async function openAlarmsWearsTheAlertIcon(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  await ribbonSettled();
  const tile = tileLabelled("Open alarms");
  expect(iconPathOf(tile)).toBe(WIDGET_ICON_PATH.alert);
}

/** Plan decision 8: PUE wears `gauge`. */
export async function pueWearsTheGaugeIcon(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  await ribbonSettled();
  const tile = tileLabelled("PUE");
  expect(iconPathOf(tile)).toBe(WIDGET_ICON_PATH.gauge);
}

/**
 * Plan decision 8: Sites online wears no icon. The PUE tile in the same render
 * is the positive control — it proves the query below can find an icon at all.
 */
export async function sitesOnlineWearsNoIcon(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  const sites = tileLabelled("Sites online");
  expect(await within(sites).findByText("9 / 9")).toBeInTheDocument();
  expect(iconPathOf(tileLabelled("PUE")), "no icon rendered anywhere — the check is vacuous").not.toBeNull();
  expect(iconPathOf(sites)).toBeNull();
}

// ---------------------------------------------------------------------------
// `F3.72` (ADR 0087 decisions 1–3, plan D2) — `/` is the Control Room's
// estate level: the organization cards, the location accordion kept by OQ3,
// and the library dashboards of the whole read scope.
// ---------------------------------------------------------------------------

const TWO_ORGANIZATIONS = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
];

/** The `SectionCard` whose `h2` reads `title`. */
function sectionTitled(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: title });
  const section = heading.closest("section");
  expect(section, `no SectionCard is titled ${JSON.stringify(title)}`).not.toBeNull();
  return section as HTMLElement;
}

/**
 * One card per organization, inside an "Organizations" section, each opening
 * that organization's Control Room level. Three sites of two organizations
 * give two cards, so a grid of one card per site reddens.
 */
export async function theEstateShowsOneCardPerOrganization(): Promise<void> {
  stubDashboard(1.42, false, {}, TWO_ORGANIZATIONS);
  renderPage();

  const grid = await screen.findByTestId("control-room-organizations");
  expect(within(sectionTitled("Organizations")).getByTestId("control-room-organizations")).toBe(grid);
  const hrefs = Array.from(grid.querySelectorAll("a")).map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/control-room/org/org-a", "/control-room/org/org-b"]);
}

/**
 * OQ3 — the "Location performance" section stays: its organization filter
 * tabs, and the accordion whose location cards open the Control Room site
 * view (OQ7, `LocationKpiCard`'s default). A regression control: it held
 * before this row too, and it must still hold beside the new cards.
 */
export async function theEstateKeepsTheLocationAccordion(): Promise<void> {
  stubDashboard(1.42, false, {}, TWO_ORGANIZATIONS);
  renderPage();

  const tabs = await screen.findByRole("tablist", { name: "Filter locations by organization" });
  const section = sectionTitled("Location performance");
  expect(section.contains(tabs), "the filter tabs left the Location performance section").toBe(true);
  expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["All", "AAA", "BBB"]);
  const siteHrefs = Array.from(section.querySelectorAll('a[href^="/control-room/site/"]')).map((a) =>
    a.getAttribute("href"),
  );
  expect(siteHrefs).toEqual([
    "/control-room/site/a1",
    "/control-room/site/a2",
    "/control-room/site/b1",
  ]);
}

/**
 * OQ4 — the title reads "Control Room · Estate" twice, in the KPI ribbon and
 * in the page header, under the "Control Room" eyebrow. The old title is gone.
 */
export async function theEstateTitleIsControlRoomEstate(): Promise<void> {
  stubDashboard(1.42);
  renderPage();

  await ribbonSettled();
  expect(screen.getAllByText("Control Room · Estate")).toHaveLength(2);
  const heading = screen.getByRole("heading", { level: 1, name: "Control Room · Estate" });
  expect(within(heading.parentElement as HTMLElement).getByText("Control Room")).toBeInTheDocument();
  expect(screen.queryByText(/Executive Summary/)).toBeNull();
}

/**
 * D7 — the estate lists the library dashboards of the whole read scope: the
 * list is read with no organization and no location, and each row opens the
 * viewer.
 */
export async function theEstateListsTheDashboards(): Promise<void> {
  stubDashboard(1.42, false, {}, [], [
    {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      slug: "plant-overview",
      name: "Plant Overview",
      description: null,
      locationId: null,
      assetGroupId: null,
      assetId: null,
      assetTemplateId: null,
      assetCode: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      widgetCount: 1,
    },
  ]);
  renderPage();

  expect(await screen.findByText("Plant Overview")).toBeInTheDocument();
  const section = sectionTitled("Dashboards");
  expect(within(section).getByRole("link", { name: /Open/ })).toHaveAttribute(
    "href",
    "/dashboards/plant-overview?organizationId=22222222-2222-4222-8222-222222222222",
  );
  expect(dashboardsApi.fetchDashboards).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
}
