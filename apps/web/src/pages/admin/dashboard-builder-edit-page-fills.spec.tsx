import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto } from "@bms/shared";
import { TAB_KEY_UNKNOWN_MESSAGE } from "@bms/shared/contracts";

import * as copilotApi from "../../api/copilot";
import * as dashboardsApi from "../../api/dashboards";
import { useWizardStore } from "../../stores/wizard-store";
import { DashboardBuilderEditPage } from "./dashboard-builder-edit-page";
import {
  asUser,
  detailsWizard,
  DTO,
  GROUP,
  renderPage,
  stubLoads,
  submitDetails,
  submitWidgets,
  typeOntoName,
  waitForPrefill,
  widgetsWizard,
} from "./dashboard-builder-edit-page.spec";

/**
 * `F4.245` (owner rulings 2 and 3) — the edit page takes a copilot layout fill
 * onto its canvas rows and a slug fill onto Basics, the save and the address.
 * Built on `dashboard-builder-edit-page.spec.tsx`'s fixtures, with a uuid id:
 * a wizard names its record by the catalog's `uuidParam`. Vitest entry point:
 * `dashboard-builder-edit-page-fills.test.tsx` (jsdom).
 */

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POINT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U_DTO: DashboardDto = { ...DTO, id: ID };

const fill = (catalogId: string, stepId: string, values: Record<string, unknown>) => ({ catalogId, params: { id: ID }, stepId, values });
const TILE = {
  widgetType: "value_tile",
  title: "Filled tile",
  gridX: 0,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  points: [{ pointId: POINT, role: "primary", sortOrder: 0 }],
  sources: [],
  config: {},
};

async function openThePage(): Promise<{ put: ReturnType<typeof vi.spyOn>; update: ReturnType<typeof vi.spyOn> }> {
  stubLoads({ dto: U_DTO, groups: [GROUP] });
  const update = vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue(U_DTO);
  const put = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(U_DTO);
  renderPage(asUser("admin"));
  await waitForPrefill("Location");
  return { put, update };
}

/** Owner ruling 3. Mutation: put back the widgets wizard's `onChange={() => undefined}` → the tile never shows. */
export async function aLayoutFillReplacesTheCanvasRows(): Promise<void> {
  await openThePage();
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.widgets.replace", "layout", { tabs: [], widgets: [TILE] }), null));
  expect(await within(widgetsWizard()).findByText("Filled tile")).toBeInTheDocument();
}

/** The request half: the filled tile is what the PUT sends. */
export async function aLayoutFillIsWhatTheWidgetsSubmitSends(): Promise<void> {
  const { put } = await openThePage();
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.widgets.replace", "layout", { tabs: [], widgets: [TILE] }), null));
  await within(widgetsWizard()).findByText("Filled tile");
  await submitWidgets();
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect((put.mock.calls[0]?.[1] as { widgets: Array<{ title?: string }> }).widgets.map((w) => w.title)).toEqual(["Filled tile"]);
}

/** A fill the route would refuse says so on the Layout step and leaves the canvas as it was. */
export async function aLayoutFillTheRouteWouldRefuseShowsTheProblem(): Promise<void> {
  await openThePage();
  const bad = { tabs: [], widgets: [{ ...TILE, tabKey: "nope" }] };
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.widgets.replace", "layout", bad), null));
  expect(await within(widgetsWizard()).findByRole("alert")).toHaveTextContent(TAB_KEY_UNKNOWN_MESSAGE);
  expect(within(widgetsWizard()).getByText("Add a widget to start composing this dashboard.")).toBeInTheDocument();
}

/** Owner ruling 2. Mutation: drop the read-only line → red. */
export async function aSlugFillShowsOnBasics(): Promise<void> {
  await openThePage();
  await userEvent.click(within(detailsWizard()).getByRole("button", { name: "Back" }));
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.update", "basics", { slug: "new-slug" }), null));
  expect(
    await within(detailsWizard()).findByText(`Slug: new-slug (filled by the copilot; now ${U_DTO.slug}).`),
  ).toBeInTheDocument();
}

/** Mutation: drop `slug` from the update body → the PATCH keeps the old address. */
export async function aSlugFillIsSentInTheSave(): Promise<void> {
  const { update } = await openThePage();
  update.mockResolvedValue({ ...U_DTO, slug: "new-slug" });
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.update", "basics", { slug: "new-slug" }), null));
  await submitDetails();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toBe(ID);
  expect((update.mock.calls[0]?.[1] as Record<string, unknown>).slug).toBe("new-slug");
}

/** Mutation: drop the navigate after a renaming save → the page stays on the old address. */
export async function aSavedSlugFillMovesToTheNewEditPath(): Promise<void> {
  const { update } = await openThePage();
  update.mockResolvedValue({ ...U_DTO, slug: "new-slug" });
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.update", "basics", { slug: "new-slug" }), null));
  await submitDetails();
  // The page header's subtitle is the route's slug.
  expect(await screen.findByText("new-slug")).toBeInTheDocument();
}

/** The adjacent case: a save the user typed alone sends no `slug` key at all. */
export async function aSaveWithoutASlugFillSendsNoSlugKey(): Promise<void> {
  const { update } = await openThePage();
  await typeOntoName(" (renamed)");
  await submitDetails();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(Object.keys(update.mock.calls[0]?.[1] as Record<string, unknown>)).not.toContain("slug");
}

/**
 * Review (quality): the move after a slug save replaces the history entry, so
 * Back never returns to the old address (stale, then a 404 on refetch).
 * Mutation: `navigate(editPath(next))` as a push → the action is `PUSH`.
 */
export async function aSavedSlugFillReplacesTheHistoryEntry(): Promise<void> {
  stubLoads({ dto: U_DTO, groups: [GROUP] });
  const update = vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue({ ...U_DTO, slug: "new-slug" });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(U_DTO);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  const router = createMemoryRouter([{ path: "/admin/dashboards/:slug", element: <DashboardBuilderEditPage user={asUser("admin")} /> }], {
    initialEntries: ["/admin/dashboards", "/admin/dashboards/site-a-overview"],
    initialIndex: 1,
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitForPrefill("Location");
  act(() => useWizardStore.getState().receiveFill(fill("dashboard.update", "basics", { slug: "new-slug" }), null));
  await submitDetails();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/dashboards/new-slug"));
  expect(router.state.historyAction).toBe("REPLACE");
}
