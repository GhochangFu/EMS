import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminAssetGroupDto, AssetListRow, DashboardDto, UserRole } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as assetsApi from "../../api/assets";
import * as dashboardsApi from "../../api/dashboards";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { DashboardBuilderEditPage } from "./dashboard-builder-edit-page";

/**
 * `F3.1d` Unit 7 — the dashboard edit page; `F3.34` (ADR 0047 Amendment 5) for the
 * asset-group scope.
 *
 * Assertions live here; `dashboard-builder-edit-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * **The load-bearing assertion in this file** is
 * `renamingAGroupScopedDashboardKeepsItsGroup`. Before `F3.34` this page prefilled a
 * stored scope TWO-way, so an asset-group dashboard opened as "organization" and a rename
 * — which sends both scope columns on every save (plan §10 Q1) — silently widened it to the
 * whole tenant. The prefill is now `scopeFromDashboard` (three-way) and the PATCH body is
 * `scopeColumns(scope)`: the group id is carried back, and `scopeColumns` never yields two
 * non-nulls so `DashboardsService.update`'s merged singularity guard stays satisfied.
 * `assetId` (ADR 0067) is never sent.
 *
 * **`F3.63` (ADR 0047 Amendment 6 §Q2) closed the asset half of the same defect.** An
 * asset-scoped row used to prefill as organization — a false radio — so a rename sent
 * `{ null, null }`, which the server merged onto the kept `assetId` (one axis, a silent success),
 * and choosing a location or a group was a 400. It now prefills as the read-only `asset` kind, and
 * the PATCH body is `scopePatch(scope)` — which OMITS both scope columns for it, so
 * `renamingAnAssetScopedDashboardSendsOnlyNameAndDescription` and the exact-keys case beside
 * it are this file's second load-bearing pair. Amendment 6 §Q1 point 2 opened the page to an
 * `asset_group_admin`; its cases set `/auth/me`'s scope on the store first (`http.spec.ts`'s
 * idiom) and the `.test.tsx` resets it in `afterEach`. The admin fetches stay spied so a
 * regression is RECORDED as a call, not lost as an unhandled `fetch`.
 *
 * **The review's foreign-scope pair** (`assetGroupAdminOnAForeignGroupCannotSave`,
 * `locationAdminOnAForeignLocationCannotSave`): a role can OPEN a dashboard on a group or a
 * location it does not hold, and before the fix a rename enabled Save and the PATCH met the
 * server's 404. `isScopeOffered` in the page's `blocked` keeps Save disabled. Mutation: drop it
 * from `blocked` ⇒ both red; the own-group rename case beside them is the positive control.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "33333333-3333-4333-8333-333333333333";

const LOCATION = {
  id: "loc-1",
  organizationId: ORG_ID,
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  code: "KOL",
  slug: "kolkata-works",
  name: "Kolkata Works",
  type: "smoc_campus" as const,
  province: null,
  capital: null,
  latitude: 0,
  longitude: 0,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: ORG_ID,
  slug: "site-a-overview",
  name: "Site A Overview",
  description: null,
  locationId: "loc-1",
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [],
};

/** The same dashboard, scoped to an asset group — `locationId` NULL, `assetGroupId` set. */
const GROUP_DTO: DashboardDto = { ...DTO, id: "dash-2", slug: "hvac-kolkata", locationId: null, assetGroupId: "grp-1" };

/** The same dashboard, instantiated onto an asset (ADR 0067) — `assetId` set and BOTH scope
 * columns NULL, as the merged-singularity guard stores it. A fixture with `assetId` beside a
 * scope column would be a row the API never writes, and a body pinned against it proves nothing. */
const ASSET_DTO: DashboardDto = {
  ...DTO,
  id: "dash-3",
  slug: "chiller-1",
  name: "Chiller 1 — health",
  locationId: null,
  assetGroupId: null,
  assetId: "asset-1",
};

/** `fetchAssets`'s real row shape (`assetListRowSchema`), no cast. */
const ASSET: AssetListRow = {
  id: "asset-1",
  code: "CH-01",
  name: "Chiller 1",
  siteName: "Kolkata Works",
  domain: "hvac",
  locationId: "11111111-1111-4111-8111-111111111111",
  locationName: "Kolkata Works",
  rtuId: null,
  rtuDisplayName: null,
  telemetrySource: null,
  active: true,
  templateId: null,
};

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast, so a
 * missing `organizationId` fails the compiler rather than the run. */
const GROUP: AdminAssetGroupDto = {
  id: "grp-1",
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: "loc-1",
  locationName: "Kolkata Works",
  organizationId: ORG_ID,
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};
const SECOND_GROUP: AdminAssetGroupDto = { ...GROUP, id: "grp-2", code: "electrical", name: "Electrical" };
/** A group in another organization — `GET /admin/asset-groups` is unfiltered for `admin`, so
 * the page must narrow the list to the dashboard's own organization itself. */
const FOREIGN_GROUP: AdminAssetGroupDto = {
  ...GROUP,
  id: "grp-foreign",
  locationId: "loc-9",
  locationName: "Elsewhere",
  organizationId: OTHER_ORG_ID,
};

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

/** Stubs every load the page issues. `dto` and `groups` are explicit at each group case so a
 * case cannot stay green against the wrong fixture. */
function stubLoads({
  dto,
  groups,
  locations = [LOCATION],
  assets = [ASSET],
}: {
  dto: DashboardDto;
  groups: readonly AdminAssetGroupDto[];
  locations?: readonly (typeof LOCATION)[];
  assets?: readonly AssetListRow[];
}): void {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(dto);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [...locations] });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [...groups] });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([...assets]);
}

/** `/auth/me`'s scope for an `asset_group_admin` of this dashboard's organization —
 * `accessibleScopeSchema`'s exact shape. The location's id matches the group's `locationId`,
 * so `scopeAssetGroupOptions` resolves the label `Hvac — Western Cape`. */
function signInAsAssetGroupAdmin(): void {
  useAuthStore.setState({
    scope: {
      kind: "asset_group",
      locations: [
        { id: "loc-1", code: "WC", slug: "western-cape", name: "Western Cape", type: "smoc_campus", province: null },
      ],
      assetGroups: [{ id: "grp-1", locationId: "loc-1", code: "hvac", name: "Hvac", organizationId: ORG_ID }],
      assetIds: ["a1"],
    },
  });
}

/** Stubs the two save calls and returns the `updateDashboard` spy the body assertions read. */
function stubSave() {
  const updateSpy = vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue(DTO);
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(DTO);
  return updateSpy;
}

/**
 * Waits until the page has applied the loaded dto — the scope radio it prefills is checked.
 * `findByLabelText("Name")` is NOT that wait: the Name input renders before the dto arrives
 * (state `""`), so it resolves at once and a synchronous `getByRole("combobox", …)` after it
 * races the dto effect — the race CI lost once on the sweep PR (#476). The groups query is a
 * second async load; assertions on the option list wait for it separately.
 */
async function waitForPrefill(kind: "Location" | "Asset group"): Promise<void> {
  await screen.findByRole("radio", { name: kind, checked: true });
}

/** The asset-kind wait: there is no radio for it, so the read-only scope line — rendered only
 * once the dto effect has applied `scopeFromDashboard` — is what proves the prefill landed. */
async function waitForAssetPrefill(): Promise<void> {
  await screen.findByText(/Scoped to asset Chiller 1\./);
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/dashboards/site-a-overview"]}>
        <Routes>
          <Route path="/admin/dashboards/:slug" element={<DashboardBuilderEditPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * **The load-bearing assertion of `F3.34`** — the silent widening ADR 0047 Amendment 5 names.
 * A group-scoped dashboard, renamed and saved, must send its own group back: a two-way
 * prefill reads it as "organization" and the PATCH body would carry `{ null, null }`.
 *
 * The body is matched **exactly**, not with `objectContaining` (review finding). The key that
 * must stay absent is `assetId`: `updateDashboard` merges on presence, so an `assetId: null`
 * in this body would clear an instantiated asset dashboard's provenance on a rename
 * (`DashboardsService.update`'s forged-provenance case). `tsc` refuses that key today because
 * `UpdateDashboardPayload` lacks it, but that gate disappears the day the type gains the field
 * (`F3.63`), so the spec pins it too — mutation: spread `assetId: null` into the body ⇒ red.
 */
export async function renamingAGroupScopedDashboardKeepsItsGroup(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  // Two async loads, both waited for in order: the dto (the checked radio — typing before it
  // lands is overwritten by `setName(dto.name)`), then the group list, which Save waits for
  // (`isScopeOffered`). The Name input renders before either and is not a wait.
  await waitForPrefill("Asset group");
  await screen.findByRole("option", { name: "Hvac — Kolkata Works" });
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(GROUP_DTO.id, {
      name: `${GROUP_DTO.name} (renamed)`,
      description: null,
      locationId: null,
      assetGroupId: "grp-1",
    });
  });
}

/** Moving a location dashboard onto a group sends the group and clears the location — both
 * scope columns are sent explicitly on every save (plan §10 Q1). */
export async function movingALocationDashboardOntoAGroupSendsTheGroupAndClearsTheLocation(): Promise<void> {
  stubLoads({ dto: DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  await waitForPrefill("Location");
  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(DTO.id, expect.objectContaining({ locationId: null, assetGroupId: "grp-1" }));
  });
}

/** An unedited group-scoped dashboard is not dirty — a prefill that read it as "organization"
 * would report the scope as changed before the author touched anything. */
export async function anUneditedGroupScopedDashboardIsNotDirty(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await waitForPrefill("Asset group");
  expect(screen.getByText("No changes yet.")).toBeInTheDocument();
}

/** Choosing a different group makes the form dirty — the dirty check compares both scope
 * columns, not `locationId` alone. */
export async function choosingADifferentGroupMakesItDirty(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP, SECOND_GROUP] });

  renderPage(asUser("admin"));

  await waitForPrefill("Asset group");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset group" }), "grp-2");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeEnabled();
}

/** The LOCATION half of the rewritten dirty check (post-merge sweep, Medium). The row rewrote
 * `scopeChanged` to compare both columns and pinned only the group half: with the location
 * comparison dropped, moving a dashboard from one location to another showed "No changes yet."
 * and Save stayed disabled, and every case stayed green. Mutation: compare `assetGroupId`
 * only ⇒ red. */
export async function choosingADifferentLocationMakesItDirty(): Promise<void> {
  const SECOND_LOCATION = { ...LOCATION, id: "loc-2", code: "MUM", slug: "mumbai-works", name: "Mumbai Works" };
  stubLoads({ dto: DTO, groups: [GROUP], locations: [LOCATION, SECOND_LOCATION] });

  renderPage(asUser("admin"));

  await waitForPrefill("Location");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Location" }), "loc-2");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeEnabled();
}

/** The group list is narrowed to the dashboard's own organization — one option besides the
 * placeholder when the stub returns one own group and one foreign group. */
export async function theGroupListIsTheDashboardsOrganizationOnly(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP, FOREIGN_GROUP] });

  renderPage(asUser("admin"));

  await waitForPrefill("Asset group");
  // The option list fills when the groups query resolves — a second async load after the dto.
  await waitFor(() => {
    const values = within(screen.getByRole("combobox", { name: "Asset group" }))
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== "");
    expect(values).toEqual(["grp-1"]);
  });
}

/**
 * **The load-bearing assertion of `F3.63`'s Q2 half** (ADR 0047 Amendment 6 §Q2). An
 * asset-scoped dashboard, renamed and saved by `admin`, sends exactly `{ name, description }`:
 * `scopePatch` returns `{}` for the `asset` kind, so neither scope column is in the body. The
 * match is exact, not `objectContaining`: a body carrying `locationId: null` or
 * `assetGroupId: null` — what spreading `scopeColumns`'s two nulls would send — reds it.
 */
export async function renamingAnAssetScopedDashboardSendsOnlyNameAndDescription(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  await waitForAssetPrefill();
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(ASSET_DTO.id, {
      name: `${ASSET_DTO.name} (renamed)`,
      description: null,
    });
  });
}

/** The same body, its keys pinned EXACTLY (the rule `renamingAGroupScopedDashboardKeepsItsGroup`
 * records for `assetId`): `toHaveBeenCalledWith` treats an own property whose value is
 * `undefined` as absent, so a body spread from `{ locationId: undefined, assetGroupId: undefined }`
 * passes the case above and is caught only here. */
export async function thePatchBodyForAnAssetScopedDashboardHasExactlyTwoKeys(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  await waitForAssetPrefill();
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => expect(updateSpy).toHaveBeenCalled());
  expect(Object.keys(updateSpy.mock.calls[0]?.[1] ?? {}).sort()).toEqual(["description", "name"]);
}

/** The read-only line names the asset, resolved from `GET /assets?organizationId=` (the
 * `assets` prop `DashboardScopeFields` requires). */
export async function anAssetScopedDashboardNamesItsAsset(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  expect(await screen.findByText(/Scoped to asset Chiller 1\./)).toBeInTheDocument();
}

/** No radio at all for the `asset` kind — not a disabled one (forms, not buttons). The asset
 * line found first is the positive control that the fields rendered. Mutation: render the
 * three radios for the kind ⇒ red. */
export async function anAssetScopedDashboardRendersNoRadios(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await waitForAssetPrefill();
  expect(screen.queryAllByRole("radio")).toEqual([]);
}

/** The asset list is narrowed to the dashboard's own organization — `fetchAssets(ORG_ID)`. */
export async function anAssetScopedDashboardReadsTheOrganizationsAssets(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await waitForAssetPrefill();
  expect(assetsApi.fetchAssets).toHaveBeenCalledWith(ORG_ID);
}

/** An asset absent from `/assets` (the list is active-only; a retired asset's dashboard is
 * still a row) falls back to the id, so the line never reads "Scoped to asset undefined". */
export async function anAssetScopedDashboardWithTheAssetAbsentShowsTheId(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP], assets: [] });

  renderPage(asUser("admin"));

  expect(await screen.findByText(new RegExp(`Scoped to asset ${ASSET_DTO.assetId}\\.`))).toBeInTheDocument();
}

/** Only an asset-scoped dto issues the assets read. Mutation: drop `enabled: !!dto?.assetId`
 * ⇒ red. */
export async function aLocationDashboardDoesNotFetchAssets(): Promise<void> {
  stubLoads({ dto: DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await waitForPrefill("Location");
  expect(assetsApi.fetchAssets).not.toHaveBeenCalled();
}

/** An unedited asset-scoped dashboard is not dirty — `scopeChanged` is false for the `asset`
 * kind. Mutation: return true for it ⇒ red (the page would show "" and Save would enable). */
export async function anUneditedAssetScopedDashboardIsNotDirty(): Promise<void> {
  stubLoads({ dto: ASSET_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await waitForAssetPrefill();
  expect(screen.getByText("No changes yet.")).toBeInTheDocument();
}

/** Renders the role's edit page on its own group dashboard and waits for the group radio,
 * checked — the positive control the two absence assertions below sit beside. */
async function renderAssetGroupAdminsGroupDashboard(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });
  signInAsAssetGroupAdmin();
  renderPage(asUser("asset_group_admin"));
  await waitForPrefill("Asset group");
}

/** `GET /admin/locations` is a 403 for the role; the hook gates it on
 * `canChooseLocationDashboardScope`. Mutation: drop that clause ⇒ red. */
export async function assetGroupAdminsEditPageDoesNotFetchLocations(): Promise<void> {
  await renderAssetGroupAdminsGroupDashboard();
  expect(locationsApi.fetchAdminLocations).not.toHaveBeenCalled();
}

/** `GET /admin/asset-groups` stays refused for the role (Amendment 6 §Q1 point 2). Mutation:
 * gate the admin query on the group predicate alone ⇒ red. */
export async function assetGroupAdminsEditPageDoesNotFetchAdminAssetGroups(): Promise<void> {
  await renderAssetGroupAdminsGroupDashboard();
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The group list is the store's `scope.assetGroups`. Mutation: feed the role `[]` ⇒ red. */
export async function assetGroupAdminsEditPageListsItsOwnGroups(): Promise<void> {
  await renderAssetGroupAdminsGroupDashboard();
  expect(await screen.findByRole("option", { name: "Hvac — Western Cape" })).toBeInTheDocument();
}

/** The role renames its group dashboard and the group is carried back — the `F3.34` rule,
 * now for the role Amendment 6 admits. */
export async function assetGroupAdminRenamesItsGroupDashboardAndKeepsTheGroup(): Promise<void> {
  const updateSpy = stubSave();
  await renderAssetGroupAdminsGroupDashboard();

  await screen.findByRole("option", { name: "Hvac — Western Cape" });
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(
      GROUP_DTO.id,
      expect.objectContaining({ name: `${GROUP_DTO.name} (renamed)`, assetGroupId: "grp-1", locationId: null }),
    );
  });
}

/** The page passes the AUTHOR's role to `WidgetInspector`, whose `PointPicker` forks on it
 * (Unit 6): for the role the picker's first control is the `Asset` select, not the master-data
 * `Location` chain. Mutation: pass a constant master-data role ⇒ red. */
export async function assetGroupAdminsWidgetInspectorOffersTheAssetChain(): Promise<void> {
  await renderAssetGroupAdminsGroupDashboard();

  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));

  expect(await screen.findByRole("combobox", { name: "Asset" })).toBeInTheDocument();
}

/** The review's foreign-scope defect, group half: the role's store scope holds `grp-1` only, and
 * the dashboard is scoped to `grp-foreign`. The group radio prefills checked (the kind IS offered
 * to the role, so the clamp does not fire), the select has no matching option, and after a rename
 * Save stays disabled. Positive control: `assetGroupAdminRenamesItsGroupDashboardAndKeepsTheGroup`
 * above, same role and same shape on its OWN group, has Save enabled. Mutation: drop
 * `isScopeOffered` from `blocked` ⇒ red. */
export async function assetGroupAdminOnAForeignGroupCannotSave(): Promise<void> {
  stubLoads({ dto: { ...GROUP_DTO, assetGroupId: FOREIGN_GROUP.id }, groups: [GROUP] });
  const updateSpy = stubSave();
  signInAsAssetGroupAdmin();
  renderPage(asUser("asset_group_admin"));

  await waitForPrefill("Asset group");
  await screen.findByRole("option", { name: "Hvac — Western Cape" });
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
  expect(updateSpy).not.toHaveBeenCalled();
}

/** The same defect, location half: `GET /admin/locations` lists a `location_admin`'s own
 * locations only (`writableLocationIds`), so the stub returns a second location and NOT the
 * dashboard's `loc-1`. The location radio prefills checked, the select has no matching option, and
 * after a rename Save stays disabled. Positive control: `choosingADifferentLocationMakesItDirty`
 * has Save enabled for an offered location. Mutation: drop `isScopeOffered` from `blocked` ⇒ red. */
export async function locationAdminOnAForeignLocationCannotSave(): Promise<void> {
  const OWN_LOCATION = { ...LOCATION, id: "loc-2", code: "MUM", slug: "mumbai-works", name: "Mumbai Works" };
  stubLoads({ dto: DTO, groups: [], locations: [OWN_LOCATION] });
  const updateSpy = stubSave();
  renderPage(asUser("location_admin"));

  await waitForPrefill("Location");
  await screen.findByRole("option", { name: "Mumbai Works" });
  await userEvent.type(screen.getByLabelText("Name"), " (renamed)");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
  expect(updateSpy).not.toHaveBeenCalled();
}
