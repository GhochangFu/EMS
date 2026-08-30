import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, DashboardSummaryDto, DashboardWidgetDto, UserRole } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as dashboardsApi from "../../api/dashboards";
import { DuplicateDashboardDialog } from "./duplicate-dashboard-dialog";

/**
 * `F3.1d` Unit 9 — the duplicate-dashboard dialog (ADR 0047 Amendment 2 ruling 3).
 *
 * Assertions live here; `duplicate-dashboard-dialog.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * The dialog composes `lib/dashboard-duplicate.ts`'s `freeSlug`/`duplicatePayload`
 * (already specced by `dashboard-duplicate.spec.ts`) with the two live calls —
 * this file does not re-check the id-dropping rule, only that the dialog wires
 * it and behaves correctly when the second call fails.
 */

const SOURCE_ORG = "22222222-2222-4222-8222-222222222222";

/** `fetchAdminLocations`'s real response shape — `AdminLocationDto`, not the narrower
 * `ScopeLocationOption` `DashboardScopeFields` itself accepts (`dashboard-scope-fields.spec.tsx`'s
 * own fixture is that narrower shape precisely because it renders the component directly rather
 * than mocking this client). */
const LOCATIONS = [
  {
    id: "loc-1",
    organizationId: SOURCE_ORG,
    organizationCode: "IONX",
    organizationName: "Ion Exchange",
    code: "S1",
    slug: "site-1",
    name: "Site 1",
    type: "smoc_campus" as const,
    province: null,
    capital: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

function point(): DashboardDto["widgets"][number]["points"][number] {
  return {
    id: "point-row-1",
    pointId: "point-1",
    role: "primary",
    sortOrder: 0,
    assetId: "asset-1",
    pointKey: "power_kw",
    unit: "kW",
  };
}

function widgetDto(): DashboardWidgetDto {
  return {
    id: "widget-1",
    dashboardId: "source-dash-id",
    organizationId: SOURCE_ORG,
    title: "Feed pump power",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    points: [point()],
    // `F3.35` Stage C. Required by the DTO; the `as DashboardWidgetDto` cast below hides
    // an omission from the compiler, so a missing key surfaces as a TypeError at run time.
    sources: [],
    widgetType: "value_tile",
    config: { unit: "kW", decimals: 1 },
  } as DashboardWidgetDto;
}

const SOURCE: DashboardDto = {
  id: "source-dash-id",
  organizationId: SOURCE_ORG,
  slug: "feed-pumps",
  name: "Feed pumps",
  description: "Original description",
  locationId: "loc-1",
  assetGroupId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [widgetDto()],
};

function summaryFor(dto: DashboardDto, overrides: Partial<DashboardSummaryDto> = {}): DashboardSummaryDto {
  return {
    id: dto.id,
    organizationId: dto.organizationId,
    slug: dto.slug,
    name: dto.name,
    description: dto.description,
    locationId: dto.locationId,
    assetGroupId: dto.assetGroupId,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    widgetCount: dto.widgets.length,
    ...overrides,
  };
}

function stubLoads(siblings: DashboardSummaryDto[] = []): void {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(SOURCE);
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: siblings });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: LOCATIONS });
}

/** Renders wherever `navigate()` sent us, so a real route change is observable
 * (`admin-route.spec.tsx`'s own idiom). */
function Elsewhere() {
  const location = useLocation();
  return (
    <p>
      landed on {location.pathname}
      {location.search}
    </p>
  );
}

function renderDialog(role: UserRole, onClose: () => void = () => {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboards"]}>
        <Routes>
          <Route
            path="/dashboards"
            element={
              <DuplicateDashboardDialog
                sourceSlug="feed-pumps"
                sourceOrganizationId={SOURCE_ORG}
                role={role}
                onClose={onClose}
              />
            }
          />
          <Route path="*" element={<Elsewhere />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Plan §8 Unit 9's second "state rather than hide" behaviour: a copy carries the
 * source's bindings, and the dialog must say so in visible text. */
export async function showsTheBindingsCarryOverWarning(): Promise<void> {
  stubLoads();
  renderDialog("admin");

  expect(
    await screen.findByText(/keeps every point binding from the source dashboard/i),
  ).toBeInTheDocument();
}

/** `DashboardScopeFields` is reused rather than restated — a `location_admin` gets
 * no organization-wide option here either, the same "forms, not buttons" rule
 * `dashboard-scope-fields.spec.tsx` pins directly. */
export async function locationAdminGetsNoOrganizationWideOption(): Promise<void> {
  stubLoads();
  renderDialog("location_admin");

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** `freeSlug` is fed the already-fetched sibling list (Task 0.2) and skips a taken candidate. */
export async function prefillsNameAndSlugSkippingATakenCandidate(): Promise<void> {
  stubLoads([summaryFor(SOURCE), summaryFor(SOURCE, { id: "sibling", slug: "feed-pumps-copy" })]);
  renderDialog("admin");

  expect(await screen.findByDisplayValue("Feed pumps (copy)")).toBeInTheDocument();
  expect(await screen.findByDisplayValue("feed-pumps-copy-2")).toBeInTheDocument();
}

/**
 * The full happy path: `POST /dashboards` then `PUT /:id/widgets`, in order, with every
 * source widget id dropped (plan §9's load-bearing assertion, exercised here through the
 * live composition rather than `duplicatePayload` directly), then a real navigate into the
 * new dashboard's builder.
 */
export async function duplicatesAndNavigatesIntoTheNewDashboardsBuilder(): Promise<void> {
  stubLoads();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    ...SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
    widgets: [],
  });
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({
    ...SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
  });
  const deleteSpy = vi.spyOn(dashboardsApi, "deleteDashboard");
  const onClose = vi.fn();

  renderDialog("admin", onClose);
  await screen.findByDisplayValue("Feed pumps (copy)");
  await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

  expect(await screen.findByText(/landed on \/admin\/dashboards\/feed-pumps-copy/)).toBeInTheDocument();
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({ organizationId: SOURCE_ORG, slug: "feed-pumps-copy", name: "Feed pumps (copy)" }),
  );
  const widgetsArg = putSpy.mock.calls[0]?.[1];
  expect(widgetsArg?.widgets).toHaveLength(1);
  expect(widgetsArg?.widgets.every((widget) => !("id" in widget))).toBe(true);
  expect(deleteSpy).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
}

/**
 * Plan §15 Q5 / §8 Unit 9: not atomic. When `PUT :id/widgets` fails, the already-created
 * dashboard is NOT rolled back (no compensating `DELETE`), and the failure renders inline
 * — right here, not lost behind a silent navigate — with a way into the builder to finish.
 */
export async function widgetCopyFailureRendersInlineWithoutDeletingTheHalfMadeCopy(): Promise<void> {
  stubLoads();
  vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    ...SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockRejectedValue(new Error('{"message":"boom"}'));
  const deleteSpy = vi.spyOn(dashboardsApi, "deleteDashboard");

  renderDialog("admin");
  await screen.findByDisplayValue("Feed pumps (copy)");
  await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

  expect(await screen.findByText(/its widgets could not be copied/i)).toBeInTheDocument();
  expect(screen.getByText(/boom/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /open it in the builder/i })).toHaveAttribute(
    "href",
    `/admin/dashboards/feed-pumps-copy?organizationId=${SOURCE_ORG}`,
  );
  expect(deleteSpy).not.toHaveBeenCalled();
  // The error must not be lost behind an automatic navigate away from it.
  expect(screen.queryByText(/landed on/)).not.toBeInTheDocument();
}
