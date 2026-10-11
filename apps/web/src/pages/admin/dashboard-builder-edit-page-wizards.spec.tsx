import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { DashboardDto } from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import { useWizardStore } from "../../stores/wizard-store";
import {
  DTO,
  GROUP,
  GROUP_DTO,
  LOCATION,
  LOC_1,
  LOC_2,
  MIMIC_GROUP_DTO,
  OVERVIEW_TAB,
  asUser,
  detailsWizard,
  renderPage,
  stubLoads,
  stubSave,
  submitDetails,
  submitWidgets,
  tileOnTab,
  typeOntoName,
  waitForPrefill,
  widgetsWizard,
} from "./dashboard-builder-edit-page.spec";

/**
 * `F3.85` PR 9 — the edit page's two wizards (details, widgets): the Review "Now / After" card, the
 * copilot-fill seeding and the C1/C2/C3/C4 review fixes. A sibling of
 * `dashboard-builder-edit-page.spec.tsx` (split out for the §4.5 1000-line cap) and built on its
 * fixtures; `dashboard-builder-edit-page-wizards.test.tsx` is the Vitest entry point.
 */

/** `F3.85` PR 9 (plan §11.1) — the details Review shows the stored value beside the new one: the
 * Name row reads the dashboard's name under "Now" and the renamed one under "After". Mutation: drop
 * `current={updateCurrent}` from the update wizard => red. */
export async function theDetailsReviewShowsTheStoredNameBesideTheNewOne(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });
  stubSave();
  renderPage(asUser("admin"));

  await waitForPrefill("Asset group");
  await typeOntoName(" (renamed)");
  await userEvent.click(within(detailsWizard()).getByRole("button", { name: "Next" }));
  await userEvent.click(within(detailsWizard()).getByRole("button", { name: "Next" }));

  const row = within(detailsWizard()).getByRole("rowheader", { name: "Name" }).closest("tr");
  expect([...(row?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent)).toEqual([
    GROUP_DTO.name,
    `${GROUP_DTO.name} (renamed)`,
  ]);
}

/** `F3.85` PR 9 review fix (C2) — a copilot fill for `dashboard.update` that arrived before the
 * dashboard loaded is applied AFTER the seed, so the filled name shows. Before the fix the shell
 * took the fill on its mount and the page's seed effect, in the same commit, set `dto.name` over
 * it. Mutation: render the wizards on `dto` alone (drop `seededFor === dto.id`) => red. */
export async function aFillWaitingForTheLoadIsNotOverwrittenByTheSeed(): Promise<void> {
  stubLoads({ dto: DTO, groups: [GROUP] });
  useWizardStore.getState().receiveFill({ catalogId: "dashboard.update", stepId: "basics", values: { name: "Chiller plant" } });
  renderPage(asUser("admin"));

  const region = await screen.findByRole("region", { name: "Dashboard details" });
  await waitFor(() => expect(within(region).getByLabelText("Name")).toHaveValue("Chiller plant"));
}

/** Review fix (C3) — a Scope fill that names a location on a GROUP dashboard makes it a location
 * dashboard. The shell merges the fill over the form's values, so the group id is still there;
 * the old mapper read the group first and dropped the location. Mutation: read the kind in the
 * old order (group id first, whatever changed) => red. */
export async function aLocationFillOnAGroupDashboardChoosesTheLocation(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Asset group");

  act(() => {
    useWizardStore.getState().receiveFill({ catalogId: "dashboard.update", stepId: "scope", values: { locationId: LOC_1 } });
  });

  expect(await screen.findByRole("radio", { name: "Location", checked: true })).toBeInTheDocument();
}

const SAVED_WIDGETS_DO_NOT_FIT =
  "The saved widgets do not fit this scope. Put the scope back, save the widget changes, then change the scope.";
const UNSAVED_SCOPE =
  "The scope has unsaved changes. Save the dashboard details, or put the scope back, before you save the widgets.";

/** The mimic group dashboard with its mimic removed on the Layout step (not saved), then moved
 * onto a location on the Scope step, and the details submitted. */
async function removeTheMimicUnsavedThenMoveToALocation(): Promise<ReturnType<typeof stubSave>> {
  stubLoads({ dto: MIMIC_GROUP_DTO, groups: [GROUP] });
  const updateSpy = stubSave();
  renderPage(asUser("admin"));
  await waitForPrefill("Asset group");

  await userEvent.click(await within(widgetsWizard()).findByText("Water train"));
  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("radio", { name: "Location" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Location" }), LOC_1);
  await submitDetails();
  return updateSpy;
}

/** Review fix (C1, direction a) — the PATCH writes the scope beside the SAVED widgets, so the
 * details wizard judges the new scope against them: an unsaved removal of the mimic does not let
 * a group dashboard move to a location. The Review card names why. Mutation: drop the
 * saved-widgets check from `detailsReason` => red. */
export async function aMoveOffTheGroupIsJudgedAgainstTheSavedMimic(): Promise<void> {
  await removeTheMimicUnsavedThenMoveToALocation();
  expect(within(detailsWizard()).getByText(SAVED_WIDGETS_DO_NOT_FIT)).toBeInTheDocument();
}

/** The same case's request half: no PATCH. */
export async function aMoveOffTheGroupWithTheSavedMimicSendsNoPatch(): Promise<void> {
  const updateSpy = await removeTheMimicUnsavedThenMoveToALocation();
  expect(updateSpy).not.toHaveBeenCalled();
}

/** A location dashboard with one value tile and no tabs. */
const TILE_DTO: DashboardDto = { ...DTO, widgets: [{ ...tileOnTab("w-1", OVERVIEW_TAB.id, 0), tabId: null }] };

/** The tile's title edited on the Layout step, the scope moved to another location on the Scope
 * step (not saved), and the widgets submitted. */
async function editATileUnderAnUnsavedScope() {
  const SECOND_LOCATION = { ...LOCATION, id: LOC_2, code: "MUM", slug: "mumbai-works", name: "Mumbai Works" };
  stubLoads({ dto: TILE_DTO, groups: [GROUP], locations: [LOCATION, SECOND_LOCATION] });
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(TILE_DTO);
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Location" }), LOC_2);
  await userEvent.click(await within(widgetsWizard()).findByText("Tile w-1"));
  await userEvent.type(within(widgetsWizard()).getByLabelText("Title"), " (edited)");
  await submitWidgets();
  return putSpy;
}

/** Review fix (C1 direction b, PR9-SEC-1) — the PUT writes onto the SAVED scope, so the widgets
 * wizard refuses while the scope has unsaved changes, and the Review card names why. This also
 * holds the role variant: a scoped role that picks its own group over a foreign one, unsaved, no
 * longer passes the scope rules for a PUT onto the foreign group. Mutation: drop the
 * unsaved-scope check from `widgetsReason` => red. */
export async function theWidgetsWizardRefusesWhileTheScopeIsUnsaved(): Promise<void> {
  await editATileUnderAnUnsavedScope();
  expect(within(widgetsWizard()).getByText(UNSAVED_SCOPE)).toBeInTheDocument();
}

/** The same case's request half: no PUT. Positive control: `renamingATabbedDashboardReSendsItsTabs`,
 * the same title edit with the scope unchanged, PUTs. */
export async function theWidgetsWizardSendsNoPutWhileTheScopeIsUnsaved(): Promise<void> {
  const putSpy = await editATileUnderAnUnsavedScope();
  expect(putSpy).not.toHaveBeenCalled();
}

/** Adds a value tile to an empty location dashboard by clicks only, then clicks the widgets
 * wizard's Cancel. */
async function addATileByClicksThenCancel(): Promise<void> {
  stubLoads({ dto: DTO, groups: [GROUP] });
  renderPage(asUser("admin"));
  await waitForPrefill("Location");

  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: "+ Value tile" }));
  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: "Cancel" }));
}

/** Review fix (C4) — the shell marks itself changed on a field `change`, and a widget added by a
 * click is none: the page's `dirty` prop (`widgetsChanged`) makes the shell ask first. Mutation:
 * drop the page's `dirty` prop => red. */
export async function cancellingClickOnlyWidgetWorkAsksFirst(): Promise<void> {
  await addATileByClicksThenCancel();
  expect(within(widgetsWizard()).getByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
}

/** The action half: "Discard and leave" discards the added tile. */
export async function discardingClickOnlyWidgetWorkClearsIt(): Promise<void> {
  await addATileByClicksThenCancel();
  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: "Discard and leave" }));
  expect(await within(widgetsWizard()).findByText("Add a widget to start composing this dashboard.")).toBeInTheDocument();
}