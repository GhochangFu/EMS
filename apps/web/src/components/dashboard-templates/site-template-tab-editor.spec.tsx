import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MAX_DASHBOARD_TABS } from "@bms/shared";
import { expect, vi } from "vitest";

import type { SectionTemplateWidgetInput } from "../../api/admin/dashboard-templates";
import * as vocabApi from "../../api/vocabularies";
import type { TemplateTabInput } from "../../lib/site-template-tabs";
import { SiteTemplateTabEditor } from "./site-template-tab-editor";

/**
 * `F4.320` (ADR 0087 Amendment 4 decision 1) — the site template tab editor, rendered.
 *
 * Assertions live here; `site-template-tab-editor.test.tsx` is the Vitest entry point (ADR 0014).
 */

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [
    { code: "electrical", label: "Electrical", sortOrder: 10, active: true },
    { code: "water", label: "Water", sortOrder: 20, active: true },
  ],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
};

function tile(key: string, title: string): SectionTemplateWidgetInput {
  return { key, title, gridX: 0, gridY: 0, gridW: 4, gridH: 4, bindings: [], sources: [], widgetType: "value_tile", config: {} };
}

function threeTabs(): TemplateTabInput[] {
  return [
    { key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [tile("o1", "Site load"), tile("o2", "Alarms")] },
    { key: "sld", label: "SLD", sortOrder: 1, domain: "electrical", widgets: [tile("s1", "Incomer")] },
    { key: "water", label: "Water", sortOrder: 2, domain: "water", widgets: [] },
  ];
}

/** The page's role: it owns the list and the selection. `latest` reads the list after each edit. */
function renderEditor(initial: TemplateTabInput[], editable: boolean) {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  const latest: { tabs: TemplateTabInput[]; changes: number } = { tabs: initial, changes: 0 };
  function Harness() {
    const [tabs, setTabs] = useState(initial);
    const [selected, setSelected] = useState(0);
    return (
      <SiteTemplateTabEditor
        tabs={tabs}
        onChange={(next) => {
          latest.tabs = next;
          latest.changes += 1;
          setTabs(next);
        }}
        selectedIndex={selected}
        onSelect={setSelected}
        editable={editable}
      />
    );
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return latest;
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
const titleValues = () =>
  screen.queryAllByLabelText("Title").map((input) => (input as HTMLInputElement).value);

/** A tab switch shows only that tab's widgets. */
export async function aTabSwitchShowsOnlyThatTabsWidgets(): Promise<void> {
  renderEditor(threeTabs(), true);
  expect(titleValues()).toEqual(["Site load", "Alarms"]);

  await userEvent.click(screen.getByRole("tab", { name: "SLD" }));
  expect(screen.getByRole("tab", { name: "SLD" })).toHaveAttribute("aria-selected", "true");
  expect(titleValues()).toEqual(["Incomer"]);
  expect((screen.getByLabelText("Tab key") as HTMLInputElement).value).toBe("sld");
  expect((screen.getByLabelText("Domain") as HTMLSelectElement).value).toBe("electrical");

  await userEvent.click(screen.getByRole("tab", { name: "Water" }));
  expect(titleValues()).toEqual([]);
  expect(screen.getByText("This tab has no widgets yet.")).toBeInTheDocument();
}

/** Add appends a tab and selects it; it is disabled at the cap. */
export async function addTabAppendsAndSelects(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  await userEvent.click(screen.getByRole("button", { name: "Add tab" }));
  expect(tabNames()).toEqual(["Overview", "SLD", "Water", "Tab 1"]);
  expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
  expect(latest.tabs.map((tab) => tab.key)).toEqual(["overview", "sld", "water", "tab-1"]);

  for (let i = latest.tabs.length; i < MAX_DASHBOARD_TABS; i += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Add tab" }));
  }
  expect(screen.getAllByRole("tab")).toHaveLength(MAX_DASHBOARD_TABS);
  expect(screen.getByRole("button", { name: "Add tab" })).toBeDisabled();
}

/** Remove asks first, names the widgets it takes, and then removes the tab and its widgets. */
export async function removeAsksThenRemoves(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  await userEvent.click(screen.getByRole("button", { name: "Remove tab" }));
  const confirm = screen.getByRole("alertdialog", { name: "Remove the tab" });
  expect(confirm.textContent).toContain("It takes 2 widgets with it.");
  expect(tabNames(), "the tab went before the confirm").toEqual(["Overview", "SLD", "Water"]);

  await userEvent.click(within(confirm).getByRole("button", { name: "Keep the tab" }));
  expect(tabNames()).toEqual(["Overview", "SLD", "Water"]);

  await userEvent.click(screen.getByRole("button", { name: "Remove tab" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove tab and widgets" }));
  expect(tabNames()).toEqual(["SLD", "Water"]);
  expect(latest.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.key))).toEqual(["s1"]);
}

/** Removing the selected middle tab selects the tab before it. */
export async function removingTheMiddleTabSelectsThePreviousTab(): Promise<void> {
  renderEditor(threeTabs(), true);
  await userEvent.click(screen.getByRole("tab", { name: "SLD" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove tab" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove tab and widgets" }));
  expect(tabNames()).toEqual(["Overview", "Water"]);
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Water" })).toHaveAttribute("aria-selected", "false");
}

/** A key refusal does not outlive its tab: the tab that lands at its index after a remove has none. */
export async function aKeyRefusalDoesNotPassToTheNextTab(): Promise<void> {
  renderEditor(threeTabs(), true);
  const key = screen.getByLabelText("Tab key");
  await userEvent.clear(key);
  await userEvent.type(key, "assets{Enter}");
  expect(screen.getByRole("alert").textContent).toContain("reserved");

  await userEvent.click(screen.getByRole("button", { name: "Remove tab" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove tab and widgets" }));
  expect(tabNames()).toEqual(["SLD", "Water"]);
  expect((screen.getByLabelText("Tab key") as HTMLInputElement).value).toBe("sld");
  expect(screen.queryByRole("alert"), "the removed tab's key refusal stayed").not.toBeInTheDocument();
}

/** An unchanged key sends no edit; a refused key keeps its alert and the input shows the saved key. */
export async function anUnchangedKeyIsNoEdit(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  const key = screen.getByLabelText("Tab key");
  await userEvent.click(key);
  await userEvent.type(key, "{Enter}");
  await userEvent.tab();
  expect(latest.changes, "an unchanged key sent an edit").toBe(0);

  await userEvent.clear(key);
  await userEvent.type(key, "sld");
  await userEvent.tab();
  expect(screen.getByRole("alert").textContent).toBe('Another tab already uses the key "sld".');
  expect((screen.getByLabelText("Tab key") as HTMLInputElement).value).toBe("overview");
  expect(latest.changes).toBe(0);
}

/** Move down and up reorder the strip, and the moved tab stays selected. */
export async function moveReordersTheStrip(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Move down" }));
  expect(tabNames()).toEqual(["SLD", "Overview", "Water"]);
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(latest.tabs.map((tab) => tab.sortOrder)).toEqual([0, 1, 2]);

  await userEvent.click(screen.getByRole("button", { name: "Move down" }));
  expect(tabNames()).toEqual(["SLD", "Water", "Overview"]);
  expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Move up" }));
  expect(tabNames()).toEqual(["SLD", "Overview", "Water"]);
}

/** Label, key, domain and group code edit the selected tab; a refused key says why. */
export async function tabFieldsEditTheSelectedTab(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  await userEvent.click(screen.getByRole("tab", { name: "SLD" }));

  const label = screen.getByLabelText("Tab label");
  await userEvent.clear(label);
  await userEvent.type(label, "Single line");
  expect(screen.getByRole("tab", { name: "Single line" })).toBeInTheDocument();

  const key = screen.getByLabelText("Tab key");
  await userEvent.clear(key);
  await userEvent.type(key, "water{Enter}");
  expect(screen.getByRole("alert").textContent).toBe('Another tab already uses the key "water".');
  expect(latest.tabs[1]!.key).toBe("sld");
  await userEvent.clear(key);
  await userEvent.type(key, "lv-board");
  await userEvent.tab();
  expect(latest.tabs[1]!.key).toBe("lv-board");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await screen.findByRole("option", { name: "Water" });
  await userEvent.selectOptions(screen.getByLabelText("Domain"), "");
  expect(latest.tabs[1]!.domain).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText("Domain"), "water");
  expect(latest.tabs[1]!.domain).toBe("water");

  await userEvent.type(screen.getByLabelText("Group code"), "LV");
  expect(latest.tabs[1]!.groupCode).toBe("LV");
}

/** Add widget to this tab grows the selected tab only. */
export async function addWidgetGrowsTheSelectedTab(): Promise<void> {
  const latest = renderEditor(threeTabs(), true);
  await userEvent.click(screen.getByRole("tab", { name: "Water" }));
  await userEvent.click(screen.getByRole("button", { name: "Add widget to this tab" }));
  expect(latest.tabs.map((tab) => tab.widgets.length)).toEqual([2, 1, 1]);
  expect(screen.queryByText("This tab has no widgets yet.")).not.toBeInTheDocument();
}

/** A problem shows on the tab it names, and on no other. */
export function aProblemShowsOnItsTab(): void {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const problem = { index: 1, message: "content.tabs.1.label: String must contain at least 1 character(s)" };
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <SiteTemplateTabEditor tabs={threeTabs()} onChange={() => undefined} selectedIndex={1} onSelect={() => undefined} editable problem={problem} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("alert").textContent).toBe(problem.message);
  rerender(
    <QueryClientProvider client={queryClient}>
      <SiteTemplateTabEditor tabs={threeTabs()} onChange={() => undefined} selectedIndex={0} onSelect={() => undefined} editable problem={problem} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

/** `editable = false` draws the strip and the widgets, and no tab input, tab button or live input. */
export async function readOnlyRendersNoInputs(): Promise<void> {
  renderEditor(threeTabs(), false);
  expect(tabNames()).toEqual(["Overview", "SLD", "Water"]);
  await userEvent.click(screen.getByRole("tab", { name: "SLD" }));
  expect(screen.getByText(/Key sld · electrical · 1 widget/)).toBeInTheDocument();
  for (const name of ["Tab label", "Tab key", "Domain", "Group code"]) {
    expect(screen.queryByLabelText(name), `${name} rendered read-only`).not.toBeInTheDocument();
  }
  for (const name of ["Add tab", "Remove tab", "Move up", "Move down", "Add widget to this tab", "Remove"]) {
    expect(screen.queryByRole("button", { name }), `${name} rendered read-only`).not.toBeInTheDocument();
  }
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  const live = [...document.querySelectorAll("input, select, textarea")].filter(
    (element) => !(element as HTMLInputElement).disabled,
  );
  expect(live, "a read-only editor drew a live input").toHaveLength(0);
}

/** No tabs: the empty message and Add tab only. */
export async function noTabsOffersAddTab(): Promise<void> {
  const latest = renderEditor([], true);
  expect(screen.getByText("This site template has no tabs yet.")).toBeInTheDocument();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Add tab" }));
  expect(tabNames()).toEqual(["Tab 1"]);
  expect(latest.tabs).toHaveLength(1);
}
