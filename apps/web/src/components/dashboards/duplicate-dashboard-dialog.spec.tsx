import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  AdminAssetGroupDto,
  DashboardDto,
  DashboardSummaryDto,
  DashboardWidgetDto,
  UserRole,
} from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as dashboardsApi from "../../api/dashboards";
import { useAuthStore } from "../../stores/auth-store";
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
 *
 * `F3.63` (ADR 0047 Amendment 6, plan §11 Q1): the dialog is the third caller of
 * `DashboardScopeFields`, reachable from the edit page an `asset_group_admin` now opens. Its
 * cases set `/auth/me`'s scope on the store first (`http.spec.ts`'s idiom); the `.test.tsx`
 * resets it in `afterEach`. The admin fetches stay spied so a regression is RECORDED as a call.
 * An asset-scoped source (§Q2, last sentence) prefills as organization — `scopeForDuplicate`
 * folds it, because this dialog's state cannot hold the `asset` kind.
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
  assetId: null,
  assetTemplateId: null,
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
    assetId: dto.assetId,
    assetTemplateId: dto.assetTemplateId,
    assetCode: null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    widgetCount: dto.widgets.length,
    ...overrides,
  };
}

/** The same dashboard scoped to an asset group (`F3.34`) — `locationId` NULL, `assetGroupId` set. */
const GROUP_SOURCE: DashboardDto = { ...SOURCE, locationId: null, assetGroupId: "grp-1" };

/** The same dashboard instantiated onto an asset (ADR 0067) — `assetId` set, both scope columns
 * NULL, as the merged-singularity guard stores it. */
const ASSET_SOURCE: DashboardDto = { ...SOURCE, locationId: null, assetGroupId: null, assetId: "asset-1" };

/** `/auth/me`'s scope for an `asset_group_admin` of the source's organization —
 * `accessibleScopeSchema`'s exact shape. The location's id matches the group's `locationId`,
 * so `scopeAssetGroupOptions` resolves the label `Hvac — Western Cape`. */
function signInAsAssetGroupAdmin(): void {
  useAuthStore.setState({
    scope: {
      kind: "asset_group",
      locations: [
        { id: "loc-1", code: "WC", slug: "western-cape", name: "Western Cape", type: "smoc_campus", province: null },
      ],
      assetGroups: [{ id: "grp-1", locationId: "loc-1", code: "hvac", name: "Hvac", organizationId: SOURCE_ORG }],
      assetIds: ["a1"],
    },
  });
}

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast. */
const GROUP: AdminAssetGroupDto = {
  id: "grp-1",
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: "loc-1",
  locationName: "Site 1",
  organizationId: SOURCE_ORG,
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};
/** A group in another organization — the dialog narrows the unfiltered list to the source's. */
const FOREIGN_GROUP: AdminAssetGroupDto = {
  ...GROUP,
  id: "grp-foreign",
  locationId: "loc-9",
  locationName: "Elsewhere",
  organizationId: "33333333-3333-4333-8333-333333333333",
};

/** Stubs every load the dialog issues. The source is explicit at every call so a group case
 * cannot stay green against the location fixture. */
function stubLoads({
  source,
  siblings = [],
  groups = [GROUP],
}: {
  source: DashboardDto;
  siblings?: DashboardSummaryDto[];
  groups?: readonly AdminAssetGroupDto[];
}): void {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(source);
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: siblings });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: LOCATIONS });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [...groups] });
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
  stubLoads({ source: SOURCE });
  renderDialog("admin");

  expect(
    await screen.findByText(/keeps every point binding from the source dashboard/i),
  ).toBeInTheDocument();
}

/** `DashboardScopeFields` is reused rather than restated — a `location_admin` gets
 * no organization-wide option here either, the same "forms, not buttons" rule
 * `dashboard-scope-fields.spec.tsx` pins directly. */
export async function locationAdminGetsNoOrganizationWideOption(): Promise<void> {
  stubLoads({ source: SOURCE });
  renderDialog("location_admin");

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** The `Asset group` radio is absent from a `location_admin`'s dialog. The source is a
 * location dashboard, the ordinary case for this role; a group source is reachable too (the
 * list read is organization-wide), and the fields' clamp then rewrites the prefill to an
 * unchosen location, so the same absence holds. The `Location` radio found first is the
 * positive control that the fields rendered at all. */
export async function locationAdminGetsNoAssetGroupOption(): Promise<void> {
  stubLoads({ source: SOURCE });
  renderDialog("location_admin");

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Asset group" })).not.toBeInTheDocument();
}

/**
 * **The dialog half of the `F3.34` defect** (ADR 0047 Amendment 5). A two-way prefill read a
 * group source as "organization" and the body was `{ locationId: null, assetGroupId: null }`
 * — the copy silently landed organization-wide. The prefill is `scopeFromDashboard` and the
 * target's scope is `scopeColumns(scope)`, so the group is carried.
 */
export async function duplicatingAnAssetGroupDashboardKeepsTheGroup(): Promise<void> {
  stubLoads({ source: GROUP_SOURCE, groups: [GROUP] });
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    ...GROUP_SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({
    ...GROUP_SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
  });

  renderDialog("admin");
  await screen.findByDisplayValue("Feed pumps (copy)");
  await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

  await screen.findByText(/landed on \/admin\/dashboards\/feed-pumps-copy/);
  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ assetGroupId: "grp-1", locationId: null }));
}

/** The group list is narrowed to the source's own organization — one option besides the
 * placeholder when the stub returns one own group and one foreign group. */
export async function theGroupListIsTheSourcesOrganizationOnly(): Promise<void> {
  stubLoads({ source: GROUP_SOURCE, groups: [GROUP, FOREIGN_GROUP] });
  renderDialog("admin");

  await screen.findByDisplayValue("Feed pumps (copy)");
  // The option list fills when the groups query resolves — an async load after the prefill.
  await waitFor(() => {
    const values = within(screen.getByRole("combobox", { name: "Asset group" }))
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== "");
    expect(values).toEqual(["grp-1"]);
  });
}

/** `freeSlug` is fed the already-fetched sibling list (Task 0.2) and skips a taken candidate. */
export async function prefillsNameAndSlugSkippingATakenCandidate(): Promise<void> {
  stubLoads({
    source: SOURCE,
    siblings: [summaryFor(SOURCE), summaryFor(SOURCE, { id: "sibling", slug: "feed-pumps-copy" })],
  });
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
  stubLoads({ source: SOURCE });
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
  stubLoads({ source: SOURCE });
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

/** Opens the role's dialog on its own group dashboard and waits for the group radio, checked —
 * the positive control the two absence assertions below sit beside. */
async function openAssetGroupAdminsDialog(): Promise<void> {
  stubLoads({ source: GROUP_SOURCE, groups: [GROUP] });
  signInAsAssetGroupAdmin();
  renderDialog("asset_group_admin");
  await screen.findByRole("radio", { name: "Asset group", checked: true });
}

/** `GET /admin/locations` is a 403 for the role; the hook gates it on
 * `canChooseLocationDashboardScope`. Mutation: drop that clause ⇒ red. */
export async function assetGroupAdminsDialogDoesNotFetchLocations(): Promise<void> {
  await openAssetGroupAdminsDialog();
  expect(locationsApi.fetchAdminLocations).not.toHaveBeenCalled();
}

/** `GET /admin/asset-groups` stays refused for the role (Amendment 6 §Q1 point 2). Mutation:
 * gate the admin query on the group predicate alone ⇒ red. */
export async function assetGroupAdminsDialogDoesNotFetchAdminAssetGroups(): Promise<void> {
  await openAssetGroupAdminsDialog();
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The group list is the store's `scope.assetGroups`. Mutation: feed the role `[]` ⇒ red. */
export async function assetGroupAdminsDialogListsItsOwnGroups(): Promise<void> {
  await openAssetGroupAdminsDialog();
  expect(await screen.findByRole("option", { name: "Hvac — Western Cape" })).toBeInTheDocument();
}

/** The role duplicates its group dashboard and the copy carries the group — the `F3.34` rule,
 * now for the role Amendment 6 admits. */
export async function assetGroupAdminDuplicatesItsGroupDashboardAndKeepsTheGroup(): Promise<void> {
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    ...GROUP_SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({
    ...GROUP_SOURCE,
    id: "new-dash-id",
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
  });
  await openAssetGroupAdminsDialog();

  await screen.findByDisplayValue("Feed pumps (copy)");
  await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

  await screen.findByText(/landed on \/admin\/dashboards\/feed-pumps-copy/);
  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ assetGroupId: "grp-1", locationId: null }));
}

/** An asset-scoped source prefills as organization-wide for `admin` (Amendment 6 §Q2, last
 * sentence): the dialog's state is `ChosenScopeValue`, and `scopeForDuplicate` folds the row.
 * Mutation: prefill with `scopeFromDashboard` instead ⇒ the `asset` kind renders no radio at
 * all, so no radio is checked ⇒ red. */
export async function anAssetScopedSourcePrefillsAsOrganizationWide(): Promise<void> {
  stubLoads({ source: ASSET_SOURCE });
  renderDialog("admin");

  expect(await screen.findByRole("radio", { name: "Organization-wide", checked: true })).toBeInTheDocument();
}
