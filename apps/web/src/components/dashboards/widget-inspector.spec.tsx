import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { MimicLayoutsListResponse } from "@bms/shared";

import { blankDashboardWidgetRow, type DashboardBuilderProblem, type DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import { WidgetInspector } from "./widget-inspector";

/**
 * `F3.32` U5 — the inspector's plant mimic surface (ADR 0079, plan D8; the source select and
 * library layout arm, `F3.32c` ADR 0081).
 *
 * Assertions live here; `widget-inspector.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **Every absence sits beside a positive control on a `value_tile`**, which renders the same
 * field, so a hidden field is a decision about the mimic rather than a render that produced
 * nothing. Each `it()` carries one claim.
 *
 * A `value_tile` renders `PointPicker` and `MetricSourcePicker`, which read through `fetch`;
 * `stubFetch` answers every call with an empty list so no spec reaches the real API on :4000.
 * `fetchMimicLayouts` is a separate module mock (below), not a `fetch` stub response, because
 * `mimicLayoutsListResponseSchema` needs `{ items: [...] }` — `stubFetch`'s bare `"[]"` fails
 * that contract in test, which throws (`checkResponse`'s `shouldThrowOnDrift`) rather than
 * giving the library select a fixed list of names to assert on.
 */

export function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

const mimicLayoutsMocks = vi.hoisted(() => ({
  fetchMimicLayouts: vi.fn(),
}));

vi.mock("../../api/mimic-layouts", () => ({
  fetchMimicLayouts: mimicLayoutsMocks.fetchMimicLayouts,
}));

const EMPTY_LAYOUTS: MimicLayoutsListResponse = { items: [] };

/** The default every case not testing the library list itself gets — an empty library, so the
 * Layout select renders with only its placeholder option. */
export function stubMimicLayouts(response: MimicLayoutsListResponse = EMPTY_LAYOUTS): void {
  mimicLayoutsMocks.fetchMimicLayouts.mockReset();
  mimicLayoutsMocks.fetchMimicLayouts.mockResolvedValue(response);
}

function libraryLayout(
  overrides: Partial<MimicLayoutsListResponse["items"][number]> = {},
): MimicLayoutsListResponse["items"][number] {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organizationId: "org-1",
    name: "Water train",
    slug: "water-train",
    canvasW: 80,
    canvasH: 60,
    version: 1,
    unitCount: 8,
    symbolLibraries: ["core"],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderInspector(
  row: DashboardWidgetRow,
  options: { problems?: DashboardBuilderProblem[]; onChange?: (patch: Partial<DashboardWidgetRow>) => void } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WidgetInspector
        row={row}
        problems={options.problems ?? []}
        role="admin"
        organizationId="org-1"
        onChange={options.onChange ?? (() => {})}
        onRemove={() => {}}
      />
    </QueryClientProvider>,
  );
}

function mimicRow(): DashboardWidgetRow {
  return blankDashboardWidgetRow("mimic");
}

export function aValueTileShowsTheUnitField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Unit", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheUnitField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Unit", { exact: true })).toBeNull();
}

export function aValueTileShowsTheDecimalsField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Decimals", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheDecimalsField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Decimals", { exact: true })).toBeNull();
}

export function aValueTileShowsTheBoundPointsField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Bound points", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheBoundPointsField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Bound points", { exact: true })).toBeNull();
}

export function aValueTileHasNoPresetField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Preset", { exact: true })).toBeNull();
}

export function aMimicShowsThePresetSelectOnItsPreset(): void {
  renderInspector(mimicRow());
  const select = screen.getByRole("combobox", { name: /^Preset/ }) as HTMLSelectElement;
  expect(select.value).toBe("water_train");
}

export function thePresetOptionReadsThePresetLabel(): void {
  renderInspector(mimicRow());
  expect(screen.getByRole("option", { name: "Water train" })).not.toBeNull();
}

export async function choosingAPresetWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  const row = mimicRow();
  const unchosen: DashboardWidgetRow = { ...row, config: { ...row.config, mimicPreset: undefined } };
  renderInspector(unchosen, { onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Preset/ }), "water_train");
  expect(onChange).toHaveBeenCalledWith({ config: { ...unchosen.config, mimicPreset: "water_train" } });
}

export function thePresetProblemRendersUnderThePreset(): void {
  const row = mimicRow();
  renderInspector(
    { ...row, config: { ...row.config, mimicPreset: undefined } },
    { problems: [{ widget: 0, field: "preset", message: "Choose which plant drawing this mimic shows." }] },
  );
  expect(screen.getByText("Choose which plant drawing this mimic shows.")).not.toBeNull();
}

// -------------------------------------------------------------------------------------------
// `F3.32c` (ADR 0081) — the Source select and the Layout arm. One claim per function.
// -------------------------------------------------------------------------------------------

function layoutRow(overrides: Partial<DashboardWidgetRow["config"]> = {}): DashboardWidgetRow {
  const row = mimicRow();
  return { ...row, config: { ...row.config, mimicSource: "layout", mimicPreset: undefined, ...overrides } };
}

/** A new mimic row (source defaults to `"preset"`, plan §4 U5) shows the Source select on it. */
export function aMimicShowsTheSourceSelectDefaultingToPreset(): void {
  stubMimicLayouts();
  renderInspector(mimicRow());
  const select = screen.getByRole("combobox", { name: /^Source/ }) as HTMLSelectElement;
  expect(select.value).toBe("preset");
}

/** Choosing "Layout" in the Source select patches `mimicSource`, not the config wholesale —
 * `WidgetInspector` is controlled, so the row itself does not change until the parent re-renders
 * it with the patch applied. */
export async function choosingLayoutSourceWritesItToTheConfig(): Promise<void> {
  stubMimicLayouts();
  const onChange = vi.fn();
  const row = mimicRow();
  renderInspector(row, { onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Source/ }), "layout");
  expect(onChange).toHaveBeenCalledWith({ config: { ...row.config, mimicSource: "layout" } });
}

/** A layout-source row hides the Preset select — the two arms are exclusive. */
export function aLayoutSourceRowHidesThePresetSelect(): void {
  stubMimicLayouts();
  renderInspector(layoutRow());
  expect(screen.queryByRole("combobox", { name: /^Preset/ })).toBeNull();
}

/** The positive twin: a layout-source row shows the Layout select. */
export function aLayoutSourceRowShowsTheLayoutSelect(): void {
  stubMimicLayouts();
  renderInspector(layoutRow());
  expect(screen.getByRole("combobox", { name: /^Layout/ })).not.toBeNull();
}

/** The Layout select lists the organization's library by name, read through
 * `fetchMimicLayouts` — the module mock, not `stubFetch`'s bare `fetch`. */
export async function theLayoutSelectListsLibraryNames(): Promise<void> {
  stubMimicLayouts({ items: [libraryLayout({ id: "layout-a", name: "Water train A" }), libraryLayout({ id: "layout-b", name: "Water train B" })] });
  renderInspector(layoutRow());
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Water train A" })).not.toBeNull();
  });
  expect(screen.getByRole("option", { name: "Water train B" })).not.toBeNull();
}

/** The anchor for the case below: the dashboard's own organization's layout is listed. */
export async function theLayoutSelectListsTheDashboardsOrganizationsLayout(): Promise<void> {
  stubMimicLayouts({
    items: [libraryLayout({ id: "layout-own", name: "Own plant" }), libraryLayout({ id: "layout-foreign", organizationId: "org-2", name: "Foreign plant" })],
  });
  renderInspector(layoutRow());
  expect(await screen.findByRole("option", { name: "Own plant" })).not.toBeNull();
}

/** A global admin's `list()` holds every organization's layouts; the select offers only the
 * dashboard's organization's — a foreign one would be refused with a 400 on save. */
export async function theLayoutSelectOmitsAnotherOrganizationsLayout(): Promise<void> {
  stubMimicLayouts({
    items: [libraryLayout({ id: "layout-own", name: "Own plant" }), libraryLayout({ id: "layout-foreign", organizationId: "org-2", name: "Foreign plant" })],
  });
  renderInspector(layoutRow());
  await screen.findByRole("option", { name: "Own plant" });
  expect(screen.queryByRole("option", { name: "Foreign plant" })).toBeNull();
}

/** A stored `mimicLayoutId` the list does not hold stays the select's value — the browser does
 * not fall back to the first layout's name (the Role select's rule, `mimic-editor/inspector.tsx`). */
export async function anUnlistedStoredLayoutStaysSelected(): Promise<void> {
  stubMimicLayouts({ items: [libraryLayout({ id: "layout-other", name: "Other plant" })] });
  renderInspector(layoutRow({ mimicLayoutId: "layout-gone" }));
  await screen.findByRole("option", { name: "Other plant" });
  expect((screen.getByRole("combobox", { name: /^Layout/ }) as HTMLSelectElement).value).toBe("layout-gone");
}

/** Choosing a library layout writes its id to `mimicLayoutId`. */
export async function choosingALayoutWritesItToTheConfig(): Promise<void> {
  stubMimicLayouts({ items: [libraryLayout({ id: "layout-a", name: "Water train A" })] });
  const onChange = vi.fn();
  const row = layoutRow();
  renderInspector(row, { onChange });
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Water train A" })).not.toBeNull();
  });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Layout/ }), "layout-a");
  expect(onChange).toHaveBeenCalledWith({ config: { ...row.config, mimicLayoutId: "layout-a" } });
}

/** A layout source with no layout chosen reports "Choose a layout from the library." under the
 * Layout field — `widgetConfigErrors`' own problem, plan §4 U5. */
export function aLayoutSourceWithNoLayoutReportsTheProblem(): void {
  stubMimicLayouts();
  renderInspector(layoutRow(), {
    problems: [{ widget: 0, field: "layout", message: "Choose a layout from the library." }],
  });
  expect(screen.getByText("Choose a layout from the library.")).not.toBeNull();
}
