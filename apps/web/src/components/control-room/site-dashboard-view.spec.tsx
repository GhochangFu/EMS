import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import { ApiError } from "../../lib/api-error";
import { SiteDashboardView } from "./site-dashboard-view";

/**
 * `F3.69` U2 — `SiteDashboardView`, the site page's inline dashboard (plan
 * decision D3, owner rulings OQ1 (a) and OQ2 (a)), rows S1–S8 of the plan's
 * U2 table.
 *
 * Assertions live here; `site-dashboard-view.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * `DashboardLiveCanvas` is mocked by module: it owns the socket and the widget
 * reads (`F3.69` U1 proves those), so this suite asserts only which DTO the
 * view hands it and when. `fetch` itself is a spy and `cleanupView` fails the
 * case if anything reached it — a throwing `fetch` alone proves nothing,
 * because react-query turns the throw into `isError`.
 */
vi.mock("../dashboards/dashboard-live-canvas", () => ({
  DashboardLiveCanvas: ({ dashboard }: { dashboard: DashboardDto }) => (
    <div data-testid="dashboard-live-canvas" data-dashboard-id={dashboard.id} />
  ),
}));

const ORG_PHE = { id: "org-phewb", code: "PHEWB", name: "PHE West Bengal" };
const SLUG = "phe-lotapata";
const LOCATION_ID = "p1";

/** The site page's resolve key (`site-page.tsx`), seeded so S7b can see it invalidated. */
const RESOLVE_KEY = ["control-room", "site-view", LOCATION_ID] as const;

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: ORG_PHE.id,
  slug: SLUG,
  name: "Lotapata Overview",
  description: null,
  locationId: LOCATION_ID,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [],
};

const RESOLVED: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "dashboard",
  dashboardId: DTO.id,
  dashboardSlug: SLUG,
  builtinKey: null,
  notice: null,
};

function notFound(): ApiError {
  return new ApiError('{"message":"Dashboard not found","statusCode":404}', 404);
}

let fetchSpy: Mock | null = null;

type Answer = DashboardDto | "reject" | "pending";

function stubRead(...answers: Answer[]): Mock {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  const read = vi.spyOn(dashboardsApi, "fetchDashboard");
  for (const answer of answers) {
    if (answer === "reject") {
      read.mockRejectedValueOnce(notFound());
    } else if (answer === "pending") {
      read.mockImplementationOnce(() => new Promise(() => undefined));
    } else {
      read.mockResolvedValueOnce(answer);
    }
  }
  return read as unknown as Mock;
}

function renderView(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): QueryClient {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SiteDashboardView slug={SLUG} organizationId={ORG_PHE.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** S1 — the read is addressed by the slug and the site's organization id. */
export async function readCarriesTheSiteOrganization(): Promise<void> {
  const read = stubRead(DTO);
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalledWith(SLUG, ORG_PHE.id));
}

/** S2 — the section title is the dashboard's name from the DTO. */
export async function titleIsTheDashboardName(): Promise<void> {
  stubRead(DTO);
  renderView();

  expect(await screen.findByRole("heading", { name: "Lotapata Overview" })).toBeInTheDocument();
}

/** S3 — `Open in Dashboards` targets the viewer with the organization id. */
export async function linkOpensTheViewer(): Promise<void> {
  stubRead(DTO);
  renderView();

  const link = await screen.findByRole("link", { name: "Open in Dashboards" });
  expect(link.getAttribute("href")).toBe(`/dashboards/${SLUG}?organizationId=${ORG_PHE.id}`);
}

/** S4a — a pending read shows the loading line. */
export async function pendingReadSaysLoading(): Promise<void> {
  const read = stubRead("pending");
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toMatch(/Loading dashboard/);
}

/** S4b — a pending read renders no canvas (after S4a's loading line). */
export async function pendingReadRendersNoCanvas(): Promise<void> {
  const read = stubRead("pending");
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-live-canvas")).toBeNull();
}

/** S5 — a resolved read hands its DTO to the canvas. */
export async function resolvedReadRendersTheCanvas(): Promise<void> {
  stubRead(DTO);
  renderView();

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect(canvas.getAttribute("data-dashboard-id")).toBe("dash-1");
}

/** S6a — a rejected read shows the API's message inside an alert. */
export async function rejectedReadShowsTheApiMessage(): Promise<void> {
  stubRead("reject");
  renderView();

  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Dashboard not found")).toBeInTheDocument();
}

/** S6b — a rejected read renders no canvas (after S6a's alert). */
export async function rejectedReadRendersNoCanvas(): Promise<void> {
  stubRead("reject");
  renderView();

  await screen.findByRole("alert");
  expect(screen.queryByTestId("dashboard-live-canvas")).toBeNull();
}

/** S7a — `Try again` re-reads the dashboard and renders the second answer. */
export async function tryAgainRereadsTheDashboard(): Promise<void> {
  const read = stubRead("reject", DTO);
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect([read.mock.calls.length, canvas.getAttribute("data-dashboard-id")]).toEqual([2, "dash-1"]);
}

/**
 * S7b — `Try again` also invalidates the site page's resolve read, so a
 * dashboard deleted between the two reads flips the page to the generated
 * view and the API's `dashboard_removed` notice. The seeded entry is not
 * invalidated before the click (the positive control).
 */
export async function tryAgainInvalidatesTheResolveRead(): Promise<void> {
  stubRead("reject", "pending");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData([...RESOLVE_KEY], RESOLVED);
  renderView(queryClient);

  const button = await screen.findByRole("button", { name: "Try again" });
  expect(queryClient.getQueryState([...RESOLVE_KEY])?.isInvalidated).toBe(false);
  fireEvent.click(button);

  await waitFor(() => expect(queryClient.getQueryState([...RESOLVE_KEY])?.isInvalidated).toBe(true));
}

/** S8 — no Edit link on the site view (OQ1 (a)); `Open in Dashboards` is the positive control. */
export async function noEditLink(): Promise<void> {
  stubRead(DTO);
  renderView();

  await screen.findByRole("link", { name: "Open in Dashboards" });
  await screen.findByTestId("dashboard-live-canvas");
  expect(screen.queryByRole("link", { name: /Edit dashboard/ })).toBeNull();
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupView(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
