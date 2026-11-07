import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// `F4.306` U10 — the trend strip selection summary's read; every case that mounts it says what it answers.
const siteTrendPointsMocks = vi.hoisted(() => ({ fetchSiteTrendPoints: vi.fn() }));
vi.mock("../../api/site-trend-points", () => ({
  fetchSiteTrendPoints: siteTrendPointsMocks.fetchSiteTrendPoints,
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
  options: {
    problems?: DashboardBuilderProblem[];
    onChange?: (patch: Partial<DashboardWidgetRow>) => void;
    tabs?: readonly { key: string; label: string; assetGroupId: string | null }[];
    locationId?: string | null;
  } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WidgetInspector
        row={row}
        problems={options.problems ?? []}
        role="admin"
        organizationId="org-1"
        tabs={options.tabs ?? []}
        locationId={options.locationId ?? null}
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

/**
 * `F3.73` — the site widgets' inspector surface (`F3.74` adds `breaker_table`, a sixth). Each absence sits beside the `value_tile`
 * positive controls above, which render the same fields.
 */
const SITE_TYPES = [
  "active_alarms_rail",
  "state_legend",
  "asset_class_strip",
  "module_summary_card",
  "critical_systems_list",
  "breaker_table",
  "trend_strip",
] as const;

export function aSiteWidgetHidesUnitDecimalsAndBoundPoints(): void {
  for (const type of SITE_TYPES) {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WidgetInspector
          row={blankDashboardWidgetRow(type)}
          problems={[]}
          role="admin"
          organizationId="org-1"
          tabs={[]}
          locationId={null}
          onChange={() => {}}
          onRemove={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Unit", { exact: true }), `${type} shows Unit`).toBeNull();
    expect(screen.queryByText("Decimals", { exact: true }), `${type} shows Decimals`).toBeNull();
    expect(screen.queryByText("Bound points", { exact: true }), `${type} shows Bound points`).toBeNull();
    expect(screen.queryByText("Named metric", { exact: true }), `${type} shows Named metric`).toBeNull();
    unmount();
  }
}

export function aRailShowsItsRowsAtTheDefault(): void {
  renderInspector(blankDashboardWidgetRow("active_alarms_rail"));
  expect((screen.getByRole("textbox", { name: /^Rows/ }) as HTMLInputElement).value).toBe("8");
}

export async function editingTheRailRowsWritesThemToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("active_alarms_rail"), { onChange });
  await userEvent.type(screen.getByRole("textbox", { name: /^Rows/ }), "5");
  // The row is controlled, so each keystroke reports against the prop's "8": "8" + "5".
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ railRows: "85" }) });
}

export async function untickingSummaryWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("active_alarms_rail"), { onChange });
  await userEvent.click(screen.getByRole("checkbox", { name: /Alarm Summary/ }));
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ railShowSummary: false }) });
}

export function aRailRowsProblemRendersUnderTheRows(): void {
  renderInspector(blankDashboardWidgetRow("active_alarms_rail"), {
    problems: [{ widget: 0, field: "railRows", message: "The rail shows an integer from 1 to 20 alarms." }],
  });
  expect(screen.getByText("The rail shows an integer from 1 to 20 alarms.")).not.toBeNull();
}

const TABS = [
  { key: "ups", label: "UPS", assetGroupId: null },
  { key: "hvac", label: "HVAC", assetGroupId: null },
];

/** `F3.74` — "overview" binds no group; "electrical" binds one. */
const GROUP_TABS = [
  { key: "overview", label: "Overview", assetGroupId: null },
  { key: "electrical", label: "Electrical", assetGroupId: "33333333-3333-4333-8333-333333333333" },
];

export function aModuleCardOffersTheDashboardsTabs(): void {
  renderInspector(blankDashboardWidgetRow("module_summary_card"), { tabs: TABS });
  const select = screen.getByRole("combobox", { name: /^Links to tab/ }) as HTMLSelectElement;
  expect(select.disabled).toBe(false);
  expect(within(select).getByRole("option", { name: "UPS" })).not.toBeNull();
  expect(within(select).getByRole("option", { name: "HVAC" })).not.toBeNull();
}

export async function choosingATabWritesItsKeyToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("module_summary_card"), { tabs: TABS, onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Links to tab/ }), "hvac");
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ targetTabKey: "hvac" }) });
}

/** No tabs: the select is disabled and the hint says why — the plan's "disabled with a hint". */
export function aModuleCardOnADashboardWithNoTabsIsDisabledWithAHint(): void {
  renderInspector(blankDashboardWidgetRow("module_summary_card"), { tabs: [] });
  expect((screen.getByRole("combobox", { name: /^Links to tab/ }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText("This dashboard has no tabs yet, so there is nothing to link to.")).not.toBeNull();
}

/** A stored key the dashboard no longer has keeps its own option rather than showing another tab. */
export function aStoredTabKeyTheDashboardNoLongerHasStaysSelected(): void {
  const row = blankDashboardWidgetRow("module_summary_card");
  row.config.targetTabKey = "gone";
  renderInspector(row, { tabs: TABS });
  expect((screen.getByRole("combobox", { name: /^Links to tab/ }) as HTMLSelectElement).value).toBe("gone");
}

export function aTabProblemRendersUnderTheSelect(): void {
  renderInspector(blankDashboardWidgetRow("module_summary_card"), {
    tabs: TABS,
    problems: [{ widget: 0, field: "targetTabKey", message: "Choose the tab this card links to." }],
  });
  expect(screen.getByText("Choose the tab this card links to.")).not.toBeNull();
}

export function aNonModuleCardHasNoTabSelect(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"), { tabs: TABS });
  expect(screen.queryByText("Links to tab", { exact: true })).toBeNull();
}

/** `F3.73` D11 — on a dashboard with tabs every widget has a tab select, and choosing a tab
 * writes the row's `tabKey` (the page moves the widget). Mutation: drop the select => red. */
export async function aWidgetOnATabbedDashboardMovesThroughTheTabSelect(): Promise<void> {
  const onChange = vi.fn();
  renderInspector({ ...blankDashboardWidgetRow("value_tile"), tabKey: "ups" }, { tabs: TABS, onChange });
  const select = screen.getByRole("combobox", { name: "Tab" }) as HTMLSelectElement;
  expect(select.value).toBe("ups");
  await userEvent.selectOptions(select, "hvac");
  expect(onChange).toHaveBeenLastCalledWith({ tabKey: "hvac" });
}

/** A dashboard without tabs shows no tab select. */
export function aWidgetOnADashboardWithoutTabsHasNoTabSelect(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"), { tabs: [] });
  expect(screen.queryByRole("combobox", { name: "Tab" })).toBeNull();
}

/** `F3.74` — a mimic on a group-less tab offers only the group-bound tabs to resolve through.
 * Mutation: list every tab => red (the Overview option is present). */
export function theMimicTabSelectListsOnlyGroupBoundTabs(): void {
  renderInspector({ ...blankDashboardWidgetRow("mimic"), tabKey: "overview" }, { tabs: GROUP_TABS });
  const select = screen.getByRole("combobox", { name: /^Resolves through tab/ });
  expect(within(select).getByRole("option", { name: "Electrical" })).not.toBeNull();
  expect(within(select).queryByRole("option", { name: "Overview" })).toBeNull();
}

export async function choosingAMimicTabWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector({ ...blankDashboardWidgetRow("mimic"), tabKey: "overview" }, { tabs: GROUP_TABS, onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Resolves through tab/ }), "electrical");
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ mimicTabKey: "electrical" }) });
}

/** A mimic on a group-bound tab resolves through its own tab, so it shows no select. */
export function aMimicOnAGroupBoundTabHasNoMimicTabSelect(): void {
  renderInspector({ ...blankDashboardWidgetRow("mimic"), tabKey: "electrical" }, { tabs: GROUP_TABS });
  expect(screen.queryByRole("combobox", { name: /^Resolves through tab/ })).toBeNull();
}

/** `F3.74` review finding 7(a), plan D7 — with no group-bound tab anywhere there is nothing to
 * resolve through, so a group-less mimic shows no select (the positive side is
 * `theMimicTabSelectListsOnlyGroupBoundTabs`). Mutation: drop the "a group tab exists" test => red. */
export function aMimicWithNoGroupTabAnywhereHasNoMimicTabSelect(): void {
  renderInspector({ ...blankDashboardWidgetRow("mimic"), tabKey: "overview" }, { tabs: [GROUP_TABS[0]!] });
  expect(screen.queryByRole("combobox", { name: /^Resolves through tab/ })).toBeNull();
}

/** The same dashboard, but the mimic still stores a key: the select stays, so the author can clear
 * the key the builder refuses on this field — hidden, that problem would block Save unseen.
 * Mutation: drop the stored-key branch => red. */
export function aStoredMimicTabKeyKeepsTheSelectWithNoGroupTab(): void {
  const row = blankDashboardWidgetRow("mimic");
  renderInspector({ ...row, tabKey: "overview", config: { ...row.config, mimicTabKey: "gone" } }, { tabs: [GROUP_TABS[0]!] });
  const select = screen.getByRole("combobox", { name: /^Resolves through tab/ }) as HTMLSelectElement;
  expect(select.value).toBe("gone");
}

export function aValueTileHasNoMimicTabSelect(): void {
  renderInspector({ ...blankDashboardWidgetRow("value_tile"), tabKey: "overview" }, { tabs: GROUP_TABS });
  expect(screen.queryByRole("combobox", { name: /^Resolves through tab/ })).toBeNull();
}

export function aMimicTabProblemRendersUnderTheSelect(): void {
  renderInspector(
    { ...blankDashboardWidgetRow("mimic"), tabKey: "overview" },
    { tabs: GROUP_TABS, problems: [{ widget: 0, field: "mimicTabKey", message: "tab problem sentence" }] },
  );
  expect(screen.getByText("tab problem sentence")).not.toBeNull();
}

export async function tickingCompactWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("mimic"), { onChange });
  await userEvent.click(screen.getByRole("checkbox", { name: /Compact/ }));
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ mimicCompact: true }) });
}

/** `compact` is the preset arm's only (plan D7): the layout arm shows no checkbox. */
export function theLayoutSourceHasNoCompactCheckbox(): void {
  const row = blankDashboardWidgetRow("mimic");
  row.config.mimicSource = "layout";
  renderInspector(row);
  expect(screen.queryByRole("checkbox", { name: /Compact/ })).toBeNull();
}

/**
 * `F4.305` — the trend strip's inspector surface: "Scope" (Whole site, or one group-bound tab of the
 * dashboard) and "Default range". Each absence sits beside the `value_tile` control.
 */
export function aTrendStripScopeOffersTheWholeSiteAndEachGroupBoundTab(): void {
  renderInspector(blankDashboardWidgetRow("trend_strip"), { tabs: GROUP_TABS });
  const select = screen.getByRole("combobox", { name: /^Scope/ }) as HTMLSelectElement;
  expect(select.value).toBe("");
  const labels = within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(labels).toEqual(["Whole site", "Electrical"]);
}

export async function choosingAScopeWritesItsTabKeyToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("trend_strip"), { tabs: GROUP_TABS, onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Scope/ }), "electrical");
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ stripTabKey: "electrical" }) });
}

export async function choosingTheWholeSiteClearsTheTabKey(): Promise<void> {
  const onChange = vi.fn();
  const row = blankDashboardWidgetRow("trend_strip");
  row.config.stripTabKey = "electrical";
  renderInspector(row, { tabs: GROUP_TABS, onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Scope/ }), "");
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ stripTabKey: undefined }) });
}

/** A stored key the dashboard no longer has (or that binds no group) keeps its own option. */
export function anUnknownStoredStripTabKeyStaysSelected(): void {
  const row = blankDashboardWidgetRow("trend_strip");
  row.config.stripTabKey = "gone";
  renderInspector(row, { tabs: GROUP_TABS });
  expect((screen.getByRole("combobox", { name: /^Scope/ }) as HTMLSelectElement).value).toBe("gone");
}

export function theDefaultRangeShowsTheStoredRange(): void {
  const row = blankDashboardWidgetRow("trend_strip");
  row.config.stripRange = "7d";
  renderInspector(row, { tabs: GROUP_TABS });
  expect((screen.getByRole("combobox", { name: /^Default range/ }) as HTMLSelectElement).value).toBe("7d");
}

export async function choosingARangeWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  renderInspector(blankDashboardWidgetRow("trend_strip"), { tabs: GROUP_TABS, onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Default range/ }), "30d");
  expect(onChange).toHaveBeenLastCalledWith({ config: expect.objectContaining({ stripRange: "30d" }) });
}

export function aStripTabProblemRendersUnderTheScope(): void {
  renderInspector(blankDashboardWidgetRow("trend_strip"), {
    tabs: GROUP_TABS,
    problems: [{ widget: 0, field: "stripTabKey", message: "tab problem sentence" }],
  });
  expect(screen.getByText("tab problem sentence")).not.toBeNull();
}

export function aValueTileHasNoStripFields(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"), { tabs: GROUP_TABS });
  expect(screen.queryByText("Default range", { exact: true })).toBeNull();
  expect(screen.queryByText("Scope", { exact: true })).toBeNull();
}

/**
 * `F4.306` U10 (owner OQ2) — the stored selection's summary mounts only on a `trend_strip` row
 * that holds one, and reads the site's lists only then. Each absence sits beside its positive.
 */
const STRIP_LOCATION = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

function answerSiteTrendPoints(): void {
  siteTrendPointsMocks.fetchSiteTrendPoints.mockReset();
  siteTrendPointsMocks.fetchSiteTrendPoints.mockResolvedValue({
    locationId: STRIP_LOCATION,
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    segments: [],
  });
}

export async function aTrendStripWithoutSelectionMountsNoSummaryAndReadsNothing(): Promise<void> {
  answerSiteTrendPoints();
  renderInspector(blankDashboardWidgetRow("trend_strip"), { tabs: GROUP_TABS, locationId: STRIP_LOCATION });
  expect(screen.getByRole("combobox", { name: /^Scope/ })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Trend strip selection" })).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(siteTrendPointsMocks.fetchSiteTrendPoints).not.toHaveBeenCalled();
}

export async function aTrendStripWithASelectionMountsTheSummaryAndReadsTheSite(): Promise<void> {
  answerSiteTrendPoints();
  const row = blankDashboardWidgetRow("trend_strip");
  row.config.stripPoints = ["seg_a:pt_x"];
  renderInspector(row, { tabs: GROUP_TABS, locationId: STRIP_LOCATION });
  expect(screen.getByRole("region", { name: "Trend strip selection" })).toBeInTheDocument();
  await waitFor(() => expect(siteTrendPointsMocks.fetchSiteTrendPoints).toHaveBeenCalledWith(STRIP_LOCATION));
}

export async function clearingTheSelectionWritesThroughTheConfig(): Promise<void> {
  answerSiteTrendPoints();
  const onChange = vi.fn();
  const row = blankDashboardWidgetRow("trend_strip");
  row.config.stripSegments = ["seg_a"];
  row.config.stripPoints = ["seg_a:pt_x"];
  row.config.stripColors = { "seg_a:pt_x": "series-1" };
  renderInspector(row, { tabs: GROUP_TABS, locationId: STRIP_LOCATION, onChange });
  await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(onChange).toHaveBeenLastCalledWith({
    config: { ...row.config, stripSegments: undefined, stripPoints: undefined, stripColors: undefined },
  });
  const written = (onChange.mock.calls.at(-1)?.[0] as { config: Record<string, unknown> }).config;
  expect([written.stripSegments, written.stripPoints, written.stripColors]).toEqual([undefined, undefined, undefined]);
}

/**
 * `F4.317` review — a value tile takes two metrics since ruling Q1b, and `catalogWidgetData`
 * draws only the first; the second exists for the organization strip's Open alarms critical
 * note. The inspector says so once a tile has a metric, so a second one is never a silent drop.
 */
const SECOND_METRIC_NOTE = /Only the first metric is drawn on a tile/;

export function aValueTileWithAMetricShowsTheSecondMetricNote(): void {
  renderInspector({
    ...blankDashboardWidgetRow("value_tile"),
    sources: [{ catalogKey: "assets.offline.count", params: {} }],
  });
  expect(screen.queryByText(SECOND_METRIC_NOTE)).not.toBeNull();
}

export function aValueTileWithNoMetricHasNoSecondMetricNote(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Named metric"), "positive control: the metric block renders").not.toBeNull();
  expect(screen.queryByText(SECOND_METRIC_NOTE)).toBeNull();
}

/** `F4.325` (ADR 0047 Amendment 8 item 1) — a chart with two bound points and the second coloured. */
function twoPointChart(): DashboardWidgetRow {
  const row = blankDashboardWidgetRow("chart");
  return {
    ...row,
    points: [
      { pointId: "p-1", role: "series", sortOrder: 0, label: "kw (kW)" },
      { pointId: "p-2", role: "series", sortOrder: 1, label: "kva (kVA)" },
    ],
    config: { ...row.config, chartColors: ["", "series-6"] },
  };
}

export function aChartShowsAColourSelectBesideEachPoint(): void {
  renderInspector(twoPointChart());
  expect((screen.getByRole("combobox", { name: "Colour of kw (kW)" }) as HTMLSelectElement).value).toBe("");
  expect((screen.getByRole("combobox", { name: "Colour of kva (kVA)" }) as HTMLSelectElement).value).toBe("series-6");
}

export function aValueTileShowsNoColourSelect(): void {
  const row = blankDashboardWidgetRow("value_tile");
  renderInspector({ ...row, points: [{ pointId: "p-1", role: "primary", sortOrder: 0, label: "kw" }] });
  expect(screen.queryByRole("combobox", { name: "Colour of kw" })).toBeNull();
  expect(screen.getByText("kw")).not.toBeNull();
}

export async function choosingAColourWritesItAtThePointsPosition(): Promise<void> {
  const onChange = vi.fn();
  const row = twoPointChart();
  renderInspector({ ...row, config: { ...row.config, chartColors: [] } }, { onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colour of kva (kVA)" }), "series-3");
  expect(onChange).toHaveBeenCalledWith({ config: { ...row.config, chartColors: ["", "series-3"] } });
}

export async function removingAPointTakesItsColour(): Promise<void> {
  const onChange = vi.fn();
  const row = twoPointChart();
  renderInspector(row, { onChange });
  await userEvent.click(screen.getByRole("button", { name: "Remove kw (kW)" }));
  expect(onChange).toHaveBeenCalledWith({
    points: [{ pointId: "p-2", role: "series", sortOrder: 0, label: "kva (kVA)" }],
    config: { ...row.config, chartColors: ["series-6"] },
  });
}

/** `F4.325` (ADR 0047 Amendment 8 item 2) — the matrix kind in the inspector. */
export function theChartKindListsTheMatrix(): void {
  renderInspector(blankDashboardWidgetRow("chart"));
  expect(screen.getByRole("option", { name: "Hour by point (24 h)" })).not.toBeNull();
}

export function aMatrixShowsItsFixedWindowInsteadOfTheField(): void {
  const row = blankDashboardWidgetRow("chart");
  renderInspector({ ...row, config: { ...row.config, series: "matrix" } });
  expect(screen.queryByText("Window (minutes)")).toBeNull();
  expect(screen.getByText("Last 24 hours, one column per hour")).not.toBeNull();
}

export function aLineChartKeepsTheWindowField(): void {
  renderInspector(blankDashboardWidgetRow("chart"));
  expect(screen.getByText("Window (minutes)")).not.toBeNull();
  expect(screen.queryByText("Last 24 hours, one column per hour")).toBeNull();
}

export function aMatrixOffersOneScaleColour(): void {
  const row = twoPointChart();
  renderInspector({ ...row, config: { ...row.config, series: "matrix", chartAggregate: "avg" } });
  expect(screen.getAllByRole("combobox", { name: /^Colour of/ })).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "Colour of the scale" })).not.toBeNull();
}
