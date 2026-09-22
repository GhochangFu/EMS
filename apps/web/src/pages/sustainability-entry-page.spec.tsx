import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardsListResponse, DashboardSummaryDto, UserRole } from "@bms/shared";

import * as dashboardsApi from "../api/dashboards";
import type { AuthUser } from "../stores/auth-store";
import { SustainabilityEntryPage } from "./sustainability-entry-page";

/**
 * `E4.2` U11, ADR 0072 decision 1 — the Sustainability sidebar entry.
 *
 * Assertions live here; `sustainability-entry-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock, because that is
 * the file Vitest collects (ADR 0042 decision 2).
 *
 * **Every case asserts the LANDING, never a spy on `useNavigate`.** The claim is
 * that the SPA moves, and only a rendered landing route proves the router
 * actually moved — the shape `dashboard-template-detail-page.spec.tsx` uses for
 * its delete. It also means the query string is asserted the way the browser
 * would see it, which a navigate spy would leave to the reader.
 *
 * And the wait is on what the DATA produces, never on a shell element: the page
 * renders `AppShell` while the query is pending, so a `findBy` on anything in
 * the shell resolves at once and would assert nothing about the redirect.
 */

function asUser(role: UserRole = "operator"): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function summary(
  slug: string,
  createdAt: string,
  organizationId = ORG_ID,
): DashboardSummaryDto {
  return {
    id: `id-${slug}`,
    organizationId,
    slug,
    name: slug,
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt,
    updatedAt: createdAt,
    widgetCount: 18,
  } as DashboardSummaryDto;
}

const VIEWER_LANDING = "landed on the dashboard viewer";
const LIST_LANDING = "landed on the dashboards list";

function renderEntry(response: DashboardsListResponse): void {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(response);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sustainability"]}>
        <Routes>
          <Route path="/sustainability" element={<SustainabilityEntryPage user={asUser()} />} />
          <Route
            path="/dashboards/:slug"
            element={<SlugLanding />}
          />
          <Route path="/dashboards" element={<ListLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Reads the landed path and query string out of the ROUTER, never
 * `window.location`: `MemoryRouter` keeps its history in memory and never
 * touches the document location, so a `window.location` assertion would read
 * jsdom's unchanged "/" and pass or fail for reasons unrelated to the redirect.
 */
function SlugLanding() {
  const location = useLocation();
  return (
    <div>
      {VIEWER_LANDING}: {location.pathname}
      {location.search}
    </div>
  );
}

function ListLanding() {
  const location = useLocation();
  return (
    <div>
      {LIST_LANDING}: {location.pathname}
      {location.search}
    </div>
  );
}

/**
 * Two instances: the entry opens the NEWER one.
 *
 * The fixture is ordered **oldest first**, which is the whole point of the case.
 * `list()` orders by slug, and an implementation that took `items[0]` would be
 * green against a newest-first fixture for free; against this one it opens the
 * 2026-01 instance and fails.
 */
export async function opensTheNewestInstanceBySlug(): Promise<void> {
  renderEntry({
    items: [
      summary("sustainability-2026-01", "2026-01-01T00:00:00.000Z"),
      summary("sustainability-2026-09", "2026-09-01T00:00:00.000Z"),
    ],
  });

  await waitFor(() => {
    expect(screen.getByText(/landed on the dashboard viewer/)).toHaveTextContent(
      "/dashboards/sustainability-2026-09",
    );
  });
}

/** …and carries `organizationId`, because on the fleet pool a slug can match more
 * than one organization's dashboard and the viewer answers a 400 rather than
 * guessing (D5). */
export async function theRedirectCarriesTheOrganizationId(): Promise<void> {
  renderEntry({ items: [summary("sustainability-2026-09", "2026-09-01T00:00:00.000Z")] });

  await waitFor(() => {
    expect(screen.getByText(/landed on the dashboard viewer/)).toHaveTextContent(
      `?organizationId=${ORG_ID}`,
    );
  });
}

/** No instance: the entry opens the FILTERED list, so an admin sees the import
 * action rather than a 404. */
export async function noInstanceOpensTheFilteredList(): Promise<void> {
  renderEntry({ items: [] });

  await waitFor(() => {
    expect(screen.getByText(/landed on the dashboards list/)).toHaveTextContent(
      "/dashboards?section=sustainability",
    );
  });
}

/** The read is the section-filtered one — the page must not fetch every
 * dashboard and filter client-side. */
export async function theEntryAsksTheApiForTheSection(): Promise<void> {
  renderEntry({ items: [] });

  await waitFor(() => {
    expect(dashboardsApi.fetchDashboards).toHaveBeenCalledWith(
      undefined,
      undefined,
      "sustainability",
    );
  });
}

/**
 * While the list is pending the entry renders the shell with its own wording —
 * it does not flash the dashboards list and then jump.
 *
 * `fetchDashboards` is stubbed with a promise that never settles, so the pending
 * state is the whole render rather than a race the assertion might lose.
 */
export function theLoadingStateNamesWhatItIsOpening(): void {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockReturnValue(new Promise(() => {}));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sustainability"]}>
        <Routes>
          <Route path="/sustainability" element={<SustainabilityEntryPage user={asUser()} />} />
          <Route path="/dashboards/:slug" element={<SlugLanding />} />
          <Route path="/dashboards" element={<ListLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(screen.getByText("Opening Sustainability…")).toBeInTheDocument();
  expect(
    screen.queryByText(/landed on/),
    "nothing may have navigated while the query is still pending",
  ).not.toBeInTheDocument();
}

/**
 * A failed read shows the API's own message, not a redirect.
 *
 * Redirecting to the filtered list on an error would tell the operator the
 * section is empty when the truth is that the read failed — the two conditions
 * look identical on the landing page and only one of them is theirs to act on.
 */
export async function theErrorStateShowsTheApiMessage(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockRejectedValue(new Error("dashboards 503"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sustainability"]}>
        <Routes>
          <Route path="/sustainability" element={<SustainabilityEntryPage user={asUser()} />} />
          <Route path="/dashboards/:slug" element={<SlugLanding />} />
          <Route path="/dashboards" element={<ListLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText(/dashboards 503/)).toBeInTheDocument();
  });
  expect(
    screen.queryByText(/landed on/),
    "a failed read must not be reported as an empty section",
  ).not.toBeInTheDocument();
}
