import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, SiteTrendPointsDto, UserRole } from "@bms/shared";

import { appendTrendStripWidgets, fetchDashboard } from "../../api/dashboards";
import { fetchSiteWidgets } from "../../api/dashboard-site-widgets";
import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { fetchVocabularies } from "../../api/vocabularies";
import { SiteDashboardView } from "./site-dashboard-view";

/**
 * `F4.306` PR 2 U13 (ADR 0108 Amendment 7 item 5; owner OQ5 and PR 2 Q1) — the site view's
 * "Set up trend strips" button. It shows for every `canAuthorDashboards` role on a dashboard with a
 * site, never on the wall, and the wizard runs in `append` mode: Finish posts once through the
 * trend arm, then the dashboard read refetches and the dialog closes.
 *
 * Every api module the view and the real wizard import is mocked; `fetch` is a rejecting spy and
 * {@link cleanupSiteViewWizard} fails the case if a read reached it. The canvas is a stand-in
 * (`site-dashboard-view.spec.tsx` proves what the view hands it). Assertions live here;
 * `site-dashboard-view-wizard.test.tsx` is the Vitest entry point (jsdom).
 */

vi.mock("../dashboards/dashboard-live-canvas", () => ({
  DashboardLiveCanvas: () => <div data-testid="dashboard-live-canvas" />,
}));
// Partial mocks: a module's query keys and pure helpers stay real; every read is a spy.
vi.mock("../../api/dashboards", async (original) => ({
  ...(await original<typeof import("../../api/dashboards")>()),
  fetchDashboard: vi.fn(),
  appendTrendStripWidgets: vi.fn(),
}));
vi.mock("../../api/dashboard-site-widgets", async (original) => ({
  ...(await original<typeof import("../../api/dashboard-site-widgets")>()),
  fetchSiteWidgets: vi.fn(),
}));
vi.mock("../../api/vocabularies", async (original) => ({
  ...(await original<typeof import("../../api/vocabularies")>()),
  fetchVocabularies: vi.fn(),
}));
vi.mock("../../api/site-trend-points", () => ({ fetchSiteTrendPoints: vi.fn() }));
vi.mock("../../api/trend-strip", async (original) => ({
  ...(await original<typeof import("../../api/trend-strip")>()),
  fetchSiteTrendStrip: vi.fn(),
}));
vi.mock("../../api/view-exports", () => ({ downloadTrendStripExport: vi.fn() }));

const readDashboard = vi.mocked(fetchDashboard);
const appendStrips = vi.mocked(appendTrendStripWidgets);
const readLists = vi.mocked(fetchSiteTrendPoints);
const readStrip = vi.mocked(fetchSiteTrendStrip);
let fetchSpy: Mock = vi.fn();

const BUTTON = "Set up trend strips";
const SITE_NAME = "Site View Test Site";
const SLUG = "phe-lotapata";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

const DTO: DashboardDto = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: ORG_ID,
  slug: SLUG,
  name: "Lotapata Overview",
  description: null,
  locationId: LOCATION_ID,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  templateId: null,
  tabs: [],
  widgets: [],
};

const LISTS: SiteTrendPointsDto = {
  locationId: LOCATION_ID,
  organizationId: ORG_ID,
  segments: [
    {
      domain: "seg_a",
      label: "Segment A",
      source: "organization",
      points: [1, 2, 3].map((n) => ({ code: `pt_${n}`, name: `Segment A point ${n}`, unit: null, active: true })),
      catalogDefaults: [],
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

function renderView({ role, wall = false, dto = DTO }: { role?: UserRole; wall?: boolean; dto?: DashboardDto }): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("site view wizard spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  readDashboard.mockResolvedValue(dto);
  readLists.mockResolvedValue(LISTS);
  readStrip.mockImplementation(() => new Promise(() => undefined));
  vi.mocked(fetchSiteWidgets).mockImplementation(() => new Promise(() => undefined));
  vi.mocked(fetchVocabularies).mockImplementation(() => new Promise(() => undefined));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SiteDashboardView
          slug={SLUG}
          organizationId={ORG_ID}
          locationId={LOCATION_ID}
          tab={undefined}
          wall={wall}
          siteName={SITE_NAME}
          {...(role === undefined ? {} : { role })}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Unmounts, restores `fetch`, resets the mocks, and fails the case if a read reached `fetch`. */
export function cleanupSiteViewWizard(): void {
  cleanup();
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

/** The canvas is drawn: the adjacent positive every absence case below waits on first. */
async function canvasShown(): Promise<void> {
  expect(await screen.findByTestId("dashboard-live-canvas")).toBeInTheDocument();
}

/** An `admin` on a dashboard with a site sees the button. */
export async function theButtonShowsForAnAdmin(): Promise<void> {
  renderView({ role: "admin" });
  expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
}

/** An `operator` cannot author dashboards: no button. */
export async function theButtonIsAbsentForAnOperator(): Promise<void> {
  renderView({ role: "operator" });
  await canvasShown();
  expect(screen.getByRole("link", { name: "Open in Dashboards" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
}

/** No role handed in (the wall mount passes none): no button. */
export async function theButtonIsAbsentWithNoRole(): Promise<void> {
  renderView({});
  await canvasShown();
  expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
}

/** A dashboard without a site (an organization or group dashboard) has nothing to read: no button. */
export async function theButtonIsAbsentWithoutASite(): Promise<void> {
  renderView({ role: "admin", dto: { ...DTO, locationId: null } });
  await canvasShown();
  expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
}

/** The wall draws no actions: no button, even for an `admin`. */
export async function theButtonIsAbsentOnTheWall(): Promise<void> {
  renderView({ role: "admin", wall: true });
  await canvasShown();
  expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
}

/** A click opens the wizard, and the button says so with `aria-expanded`. */
export async function clickingTheButtonOpensTheWizard(): Promise<void> {
  renderView({ role: "admin" });
  const button = await screen.findByRole("button", { name: BUTTON });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(button);
  expect(screen.getByRole("dialog", { name: "Trend strip setup" })).toBeInTheDocument();
  expect(button.getAttribute("aria-expanded")).toBe("true");
}

/** The wizard's Site step names the site the page passes. */
export async function theSiteStepNamesTheSite(): Promise<void> {
  renderView({ role: "admin" });
  await userEvent.click(await screen.findByRole("button", { name: BUTTON }));
  expect(screen.getByText(`The strips draw the trend points of ${SITE_NAME}.`)).toBeInTheDocument();
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** Opens the wizard and walks it to Finish over the single canvas and Segment A. */
async function runTheWizard(): Promise<void> {
  appendStrips.mockResolvedValue({ widgets: [], updatedAt: "2026-11-04T10:00:00.000+00:00" } as never);
  await userEvent.click(await screen.findByRole("button", { name: BUTTON }));
  await next();
  await userEvent.click(screen.getByRole("checkbox", { name: "Dashboard" }));
  await next();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Segment A" }));
  await next();
  await next();
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
}

/** Finish posts one body through the trend arm, for this dashboard. */
export async function finishPostsOnce(): Promise<void> {
  renderView({ role: "admin" });
  await runTheWizard();
  await waitFor(() => expect(appendStrips).toHaveBeenCalledTimes(1));
  expect(appendStrips.mock.calls[0]?.[0]).toBe(DTO.id);
}

/** After Finish the dashboard read runs again, so the canvas draws the stored strip. */
export async function finishRefetchesTheDashboard(): Promise<void> {
  renderView({ role: "admin" });
  await canvasShown();
  expect(readDashboard).toHaveBeenCalledTimes(1);
  await runTheWizard();
  await waitFor(() => expect(readDashboard).toHaveBeenCalledTimes(2));
  expect(readDashboard).toHaveBeenLastCalledWith(SLUG, ORG_ID);
}

/** After Finish the dialog closes. */
export async function finishClosesTheWizard(): Promise<void> {
  renderView({ role: "admin" });
  await runTheWizard();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Trend strip setup" })).toBeNull());
  expect(screen.getByRole("button", { name: BUTTON }).getAttribute("aria-expanded")).toBe("false");
}
