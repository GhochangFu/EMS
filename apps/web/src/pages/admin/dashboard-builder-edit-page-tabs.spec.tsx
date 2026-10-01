import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { DashboardDto } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as dashboardsApi from "../../api/dashboards";
import { ApiError } from "../../lib/api-error";
import { TAB_LOCATION_MOVE_PROBLEM } from "../../lib/dashboard-builder-form";
import {
  DTO,
  GROUP,
  LOCATION,
  OVERVIEW_TAB,
  SECOND_GROUP,
  TABBED_DTO,
  asUser,
  renderPage,
  stubLoads,
  tileOnTab,
  waitForPrefill,
} from "./dashboard-builder-edit-page.spec";

/**
 * `F3.73` (plan Task 5.2, D11) — the builder's tabs on the edit page: the strip above the canvas,
 * the Tabs panel, the inspector's tab select and the save payload. A sibling of
 * `dashboard-builder-edit-page.spec.tsx` (which sits near the §4.5 1000-line cap) and built on its
 * fixtures; `dashboard-builder-edit-page-tabs.test.tsx` is the Vitest entry point.
 *
 * Every load `AppShell` and the page issue is stubbed by `stubLoads` (a live API on :4000 answers
 * 401 and clears the session).
 */

/** `TAB_LOCATION_MOVE_MESSAGE` (`apps/api/src/dashboard-builder/dashboards.schema.ts`), restated:
 * `apps/web` does not import from `apps/api`. */
const TAB_LOCATION_MOVE_MESSAGE =
  "this dashboard has tabs bound to asset groups at its site, so it cannot leave that site — " +
  "clear the tabs' asset groups first";

const SECOND_LOCATION = { ...LOCATION, id: "loc-2", code: "PUN", slug: "pune-works", name: "Pune Works" };

function stubPut(dto: DashboardDto) {
  vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue(dto);
  return vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(dto);
}

const strip = () => screen.getByRole("tablist", { name: "Dashboard tabs" });
const canvasTitles = () => screen.queryAllByText(/^Tile w-/).map((node) => node.textContent);

/** The strip names each tab, the first is selected, and the canvas shows that tab's widgets only.
 * Mutation: drop the tile filter by the selected tab => red. */
export async function theStripShowsTheSelectedTabsWidgetsOnly(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const overview = await within(strip()).findByRole("tab", { name: "Overview" });
  expect(overview).toHaveAttribute("aria-selected", "true");
  expect(canvasTitles()).toEqual(["Tile w-overview"]);

  await userEvent.click(within(strip()).getByRole("tab", { name: "Electrical" }));
  expect(within(strip()).getByRole("tab", { name: "Electrical" })).toHaveAttribute("aria-selected", "true");
  expect(canvasTitles()).toEqual(["Tile w-electrical"]);
}

/** Adding a tab to a tab-less dashboard puts its widget on the tab, and the save sends the edited
 * tab (no id: it is new) and the widget's `tabKey`. Mutation: send `tabWritesFromDto(dto.tabs)`
 * in place of the edited tabs => red. */
export async function addingATabSendsItWithItsWidget(): Promise<void> {
  const dto: DashboardDto = { ...DTO, widgets: [{ ...tileOnTab("w-1", OVERVIEW_TAB.id, 0), tabId: null }] };
  stubLoads({ dto, groups: [GROUP] });
  const putSpy = stubPut(dto);
  renderPage(asUser("admin"));
  await waitForPrefill("Location");
  await screen.findByRole("option", { name: "Kolkata Works" });

  await userEvent.click(screen.getByRole("button", { name: "Add tab" }));
  const label = screen.getByRole("textbox", { name: "Tab 1 label" });
  await userEvent.clear(label);
  await userEvent.type(label, "Main hall");
  const key = screen.getByRole("textbox", { name: "Tab 1 key" });
  await userEvent.clear(key);
  await userEvent.type(key, "main");
  await userEvent.tab();
  expect(within(strip()).getByRole("tab", { name: "Main hall" })).toHaveAttribute("aria-selected", "true");
  expect(canvasTitles()).toEqual(["Tile w-1"]);

  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
  await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
  const body = putSpy.mock.calls[0]![1];
  expect(body.tabs).toEqual([{ key: "main", label: "Main hall", sortOrder: 0, assetGroupId: null }]);
  expect(body.widgets.map((widget) => [widget.id, widget.tabKey])).toEqual([["w-1", "main"]]);
}

/** The group select reads the groups AT the dashboard's site, and the chosen group is sent.
 * Mutation: read `fetchAdminAssetGroups()` without the location => red. */
export async function bindingATabToAGroupReadsTheSitesGroups(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP, SECOND_GROUP] });
  const putSpy = stubPut(TABBED_DTO);
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const select = await screen.findByRole("combobox", { name: "Tab 1 asset group" });
  await within(select).findByRole("option", { name: "Electrical" });
  expect(assetGroupsApi.fetchAdminAssetGroups).toHaveBeenCalledWith("loc-1");
  await userEvent.selectOptions(select, "grp-2");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
  expect(putSpy.mock.calls[0]![1].tabs.map((tab) => [tab.key, tab.assetGroupId])).toEqual([
    ["overview", "grp-2"],
    ["electrical", "grp-1"],
  ]);
}

/** The inspector's tab select moves a widget to another tab; the strip follows it, and the save
 * sends the new `tabKey`. The widget moved is the SECOND row, shown first on its own tab, so a
 * tile index taken from the filtered list selects the wrong row. Mutations: drop the inspector's
 * tab select => red; re-index the filtered tiles => red. */
export async function movingAWidgetToAnotherTab(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  const putSpy = stubPut(TABBED_DTO);
  renderPage(asUser("admin"));
  await waitForPrefill("Location");
  await screen.findByRole("option", { name: "Kolkata Works" });

  await userEvent.click(await within(strip()).findByRole("tab", { name: "Electrical" }));
  await userEvent.click(screen.getByText("Tile w-electrical"));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tab" }), "overview");
  expect(within(strip()).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(canvasTitles()).toEqual(["Tile w-overview", "Tile w-electrical"]);

  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
  await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
  expect(putSpy.mock.calls[0]![1].widgets.map((widget) => [widget.id, widget.tabKey])).toEqual([
    ["w-overview", "overview"],
    ["w-electrical", "overview"],
  ]);
}

/** A new widget lands on the selected tab, and a group-bound tab offers the plant mimic where the
 * Overview tab of a location dashboard does not. Mutation: add the row without the tab => red. */
export async function aNewWidgetLandsOnTheSelectedTab(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  await within(strip()).findByRole("tab", { name: "Overview" });
  expect(screen.queryByRole("button", { name: "+ Plant mimic" })).toBeNull();
  await userEvent.click(within(strip()).getByRole("tab", { name: "Electrical" }));
  await userEvent.click(screen.getByRole("button", { name: "+ Plant mimic" }));

  expect(screen.getByRole("combobox", { name: "Tab" })).toHaveValue("electrical");
  expect(screen.getAllByText("Plant mimic · 0 point(s)")).toHaveLength(1);
  await userEvent.click(within(strip()).getByRole("tab", { name: "Overview" }));
  expect(screen.queryAllByText("Plant mimic · 0 point(s)")).toHaveLength(0);
}

/** A tab keyed `assets` is refused before the save, and the summary says why. */
export async function aReservedTabKeyBlocksTheSave(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const key = await screen.findByRole("textbox", { name: "Tab 2 key" });
  await userEvent.clear(key);
  await userEvent.type(key, "assets");
  await userEvent.tab();

  expect(
    await screen.findByText('Tab 2: the key "assets" is reserved for the site\'s Assets & RTUs page.'),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
}

/** A key another tab holds is refused at the field, so two tabs' widgets never merge. */
export async function aTakenTabKeyIsRefusedAtTheField(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const key = await screen.findByRole("textbox", { name: "Tab 2 key" });
  await userEvent.clear(key);
  await userEvent.type(key, "overview");
  await userEvent.tab();

  expect(screen.getByText('Another tab already uses the key "overview".')).toBeInTheDocument();
  await userEvent.click(within(strip()).getByRole("tab", { name: "Electrical" }));
  expect(canvasTitles()).toEqual(["Tile w-electrical"]);
}

/** Review finding — a SAVED group tab holds the dashboard at its site (the tabs' location FK), and
 * the save sends the PATCH before the PUT that would clear the group. So a move is refused before
 * Save with the way out, and clearing the group in the panel does not lift it: the stored tab still
 * binds it. Putting the site back lifts it. Mutation: drop `tabLocationMoveProblems` from the page's
 * problems => red (Save enables, and the PATCH meets the API's 400). */
export async function aLocationMoveWithSavedGroupTabsBlocksTheSave(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP], locations: [LOCATION, SECOND_LOCATION] });
  const patchSpy = vi.spyOn(dashboardsApi, "updateDashboard").mockRejectedValue(
    new ApiError(JSON.stringify({ message: TAB_LOCATION_MOVE_MESSAGE, error: "Bad Request", statusCode: 400 }), 400),
  );
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Tab 2 asset group" }), "");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Location" }), "loc-2");

  expect(await screen.findByText(TAB_LOCATION_MOVE_PROBLEM)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
  expect(patchSpy).not.toHaveBeenCalled();

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "loc-1");
  expect(screen.queryByText(TAB_LOCATION_MOVE_PROBLEM)).toBeNull();
  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeEnabled();
}

const ANOTHER_SITE_LABEL = "A group at another site";

/** Answers the site's group read (`?locationId=loc-1`) with `site`, and the page's unfiltered
 * scope-option read with `[GROUP]`, so only the Tabs panel's read is pending or failed. */
function stubSiteGroupsRead(site: () => Promise<{ items: (typeof GROUP)[] }>): void {
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockImplementation((locationId?: string) =>
    locationId === "loc-1" ? site() : Promise.resolve({ items: [GROUP] }),
  );
}

/** Review fix — while the site's groups are loading, a correctly bound tab is not labelled "A group
 * at another site": the panel says the groups are loading. Mutations: map a pending read to the
 * loaded state with no items => red (the status line); label the unlisted option "A group at
 * another site" whatever the read's state => red (the option). */
export async function aBoundTabIsNotMislabelledWhileTheGroupsLoad(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  stubSiteGroupsRead(() => new Promise(() => undefined));
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const select = await screen.findByRole("combobox", { name: "Tab 2 asset group" });
  expect(await screen.findByText("Loading the site's asset groups…")).toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: ANOTHER_SITE_LABEL })).toBeNull();
  expect(within(select).getByRole("option", { name: "Loading its group…" })).toBeInTheDocument();
}

/** Review fix — a failed read shows the query's error text, and a bound tab is not labelled "A
 * group at another site". Mutations: map a failed read to the loaded state with no items => red
 * (the error line); label the unlisted option "A group at another site" whatever the read's state
 * => red (the option). */
export async function aFailedGroupsReadShowsItsErrorNotAMisleadingLabel(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  stubSiteGroupsRead(() =>
    Promise.reject(new ApiError(JSON.stringify({ message: "asset groups are down", statusCode: 503 }), 503)),
  );
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  expect(await screen.findByText(/The site's asset groups did not load: asset groups are down/)).toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: "Tab 2 asset group" });
  expect(within(select).queryByRole("option", { name: ANOTHER_SITE_LABEL })).toBeNull();
  expect(within(select).getByRole("option", { name: "Its group (not loaded)" })).toBeInTheDocument();
}

/** Review fix — an `asset_group_admin` is not a master-data admin, so the site's group read is not
 * made: a bound tab says its group is not loaded, not "A group at another site". The state is
 * brief — the page then clamps this role's location scope off the site, and the select gives way
 * to "Clear tab 2 group". Mutation: map the disabled read to the loaded state with no items => red. */
export async function aDisabledGroupsReadDoesNotMislabelABoundTab(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("asset_group_admin"));

  // The select shows only until this role's scope clamp moves the scope off the location (below),
  // so both option checks run in one synchronous pass over the same select.
  await waitFor(() => {
    const select = screen.getByRole("combobox", { name: "Tab 2 asset group" });
    expect(within(select).getByRole("option", { name: "Its group (not loaded)" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: ANOTHER_SITE_LABEL })).toBeNull();
  });
  expect(await screen.findByRole("button", { name: "Clear tab 2 group" })).toBeInTheDocument();
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalledWith("loc-1");
}

/** Review fix — the positive half: once the groups have loaded and the bound group is not among
 * them, the label says so. Mutation: drop the "another site" option => red. */
export async function aLoadedListWithoutTheBoundGroupSaysAnotherSite(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [SECOND_GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  const select = await screen.findByRole("combobox", { name: "Tab 2 asset group" });
  await within(select).findByRole("option", { name: "Electrical" });
  expect(within(select).getByRole("option", { name: ANOTHER_SITE_LABEL })).toBeInTheDocument();
  expect(screen.queryByText("Loading the site's asset groups…")).toBeNull();
}

/** A scope switch away from the location with a group tab still bound blocks the save before the
 * PATCH can commit, and the panel clears the tab's reason. The tab is a SAVED group tab, so the
 * move reason stays after the clear. Mutation: drop the client rule => red. */
export async function aGroupTabOffALocationScopeBlocksTheSave(): Promise<void> {
  stubLoads({ dto: TABBED_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset group" }), "grp-1");
  const reason =
    "Tab 2 binds an asset group, and only a location dashboard carries group tabs. Clear its group or choose a location.";
  expect(await screen.findByText(reason)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Clear tab 2 group" }));
  expect(screen.queryByText(reason)).toBeNull();
  // The STORED tab still binds the group, so the move off the site stays refused until that saves.
  expect(screen.getByText(TAB_LOCATION_MOVE_PROBLEM)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
}
