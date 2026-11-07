/**
 * `F4.320` (ADR 0087 Amendment 4 decision 1) — the site template tab edits.
 *
 * Assertions live here; `site-template-tabs.test.ts` is the Vitest entry point (ADR 0014).
 */
import { MAX_DASHBOARD_TABS, RESERVED_DASHBOARD_TAB_KEYS, updateDashboardTemplateBodySchema } from "@bms/shared";

import type { SectionTemplateWidgetInput } from "../api/admin/dashboard-templates";
import {
  TAB_KEY_FORMAT_PROBLEM,
  addTemplateTab,
  blankTemplateWidget,
  firstTabProblem,
  moveTemplateTab,
  rekeyTemplateTab,
  removeTemplateTab,
  renameTemplateTab,
  setTemplateTabDomain,
  setTemplateTabGroupCode,
  tabIndexOfProblem,
  withTabWidgets,
  type TemplateTabInput,
} from "./site-template-tabs";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function widget(key: string, extra: Partial<SectionTemplateWidgetInput> = {}): SectionTemplateWidgetInput {
  return { ...blankTemplateWidget(), key, ...extra } as SectionTemplateWidgetInput;
}

/** Three tabs: an Overview with a card that links the SLD tab, the SLD tab with a mimic, and Water. */
function threeTabs(): TemplateTabInput[] {
  return [
    {
      key: "overview",
      label: "Overview",
      sortOrder: 0,
      domain: null,
      widgets: [
        widget("card", { widgetType: "module_summary_card", config: { targetTabKey: "sld" } } as never),
        widget("tile"),
      ],
    },
    {
      key: "sld",
      label: "SLD",
      sortOrder: 4,
      domain: "electrical",
      groupCode: "LV",
      widgets: [widget("mimic", { widgetType: "mimic", config: { tabKey: "sld" } } as never)],
    },
    { key: "water", label: "Water", sortOrder: 9, domain: "water", widgets: [] },
  ];
}

const keys = (tabs: readonly TemplateTabInput[]) => tabs.map((tab) => tab.key).join(",");
const orders = (tabs: readonly TemplateTabInput[]) => tabs.map((tab) => tab.sortOrder).join(",");

/** Add takes the first free `tab-N`, appends an empty Overview-style tab, and renumbers. */
export function addAppendsAFreshTab(): void {
  const start = [...threeTabs(), { key: "tab-1", label: "Tab 1", sortOrder: 3, domain: null, widgets: [] }];
  const added = addTemplateTab(start);
  assert(added !== null, "add refused below the cap");
  assert(keys(added!.tabs) === "overview,sld,water,tab-1,tab-2", `keys: ${keys(added!.tabs)}`);
  assert(added!.index === 4, `index: ${added!.index}`);
  const tab = added!.tabs[4]!;
  assert(tab.label === "Tab 2" && tab.domain === null && tab.widgets.length === 0, "the new tab is not empty");
  assert(orders(added!.tabs) === "0,1,2,3,4", `orders: ${orders(added!.tabs)}`);
  const first = addTemplateTab([]);
  assert(first !== null && first.tabs[0]!.key === "tab-1" && first.index === 0, "the first tab is not tab-1");
}

/** Add refuses at `MAX_DASHBOARD_TABS`. */
export function addRefusesAtTheCap(): void {
  let tabs: TemplateTabInput[] = [];
  for (let i = 0; i < MAX_DASHBOARD_TABS; i += 1) tabs = addTemplateTab(tabs)!.tabs;
  assert(tabs.length === MAX_DASHBOARD_TABS, `length: ${tabs.length}`);
  assert(addTemplateTab(tabs) === null, "add went past the cap");
}

/** Rename sets the label of one tab only. */
export function renameSetsOneLabel(): void {
  const tabs = renameTemplateTab(threeTabs(), 1, "Single line");
  assert(tabs[1]!.label === "Single line" && tabs[0]!.label === "Overview", "rename touched the wrong tab");
}

/** A re-key moves the card's `targetTabKey` and the mimic's `tabKey`, and nothing else. */
export function rekeyMovesTheReferences(): void {
  const result = rekeyTemplateTab(threeTabs(), 1, "electrical-1");
  assert(result.ok, "a valid key was refused");
  if (!result.ok) return;
  assert(keys(result.tabs) === "overview,electrical-1,water", `keys: ${keys(result.tabs)}`);
  const card = result.tabs[0]!.widgets[0]!.config as Record<string, unknown>;
  const mimic = result.tabs[1]!.widgets[0]!.config as Record<string, unknown>;
  assert(card.targetTabKey === "electrical-1", "the card still links the old key");
  assert(mimic.tabKey === "electrical-1", "the mimic still names the old key");
  assert(JSON.stringify(result.tabs[0]!.widgets[1]!.config) === "{}", "the tile's config changed");
}

/** A card that links another tab keeps its link when a different tab is re-keyed. */
export function rekeyLeavesOtherReferences(): void {
  const result = rekeyTemplateTab(threeTabs(), 2, "water-1");
  assert(result.ok, "a valid key was refused");
  if (!result.ok) return;
  assert((result.tabs[0]!.widgets[0]!.config as Record<string, unknown>).targetTabKey === "sld", "the card moved");
  assert((result.tabs[1]!.widgets[0]!.config as Record<string, unknown>).tabKey === "sld", "the mimic moved");
}

/** A re-key is refused for a taken key, a reserved key and a bad format; the same key is a no-op. */
export function rekeyRefusesAnUnusableKey(): void {
  const taken = rekeyTemplateTab(threeTabs(), 1, "water");
  assert(!taken.ok && taken.problem === 'Another tab already uses the key "water".', "a taken key was accepted");
  for (const reserved of RESERVED_DASHBOARD_TAB_KEYS) {
    const result = rekeyTemplateTab(threeTabs(), 1, reserved);
    assert(!result.ok && result.problem.includes("reserved"), `the reserved key ${reserved} was accepted`);
  }
  for (const bad of ["", "Sld", "s l d", "a".repeat(65)]) {
    const result = rekeyTemplateTab(threeTabs(), 1, bad);
    assert(!result.ok && result.problem === TAB_KEY_FORMAT_PROBLEM, `the key "${bad}" was accepted`);
  }
  const same = rekeyTemplateTab(threeTabs(), 1, "sld");
  assert(same.ok && keys(same.tabs) === "overview,sld,water", "the same key was not a no-op");
  const missing = rekeyTemplateTab(threeTabs(), 7, "x");
  assert(missing.ok && keys(missing.tabs) === "overview,sld,water", "a missing index changed the list");
}

/** Move swaps neighbours and renumbers; a move past either end is unchanged. */
export function moveSwapsAndRenumbers(): void {
  const down = moveTemplateTab(threeTabs(), 0, 1);
  assert(keys(down) === "sld,overview,water" && orders(down) === "0,1,2", `down: ${keys(down)} ${orders(down)}`);
  const up = moveTemplateTab(threeTabs(), 2, -1);
  assert(keys(up) === "overview,water,sld", `up: ${keys(up)}`);
  assert(keys(moveTemplateTab(threeTabs(), 0, -1)) === "overview,sld,water", "moved past the start");
  assert(keys(moveTemplateTab(threeTabs(), 2, 1)) === "overview,sld,water", "moved past the end");
  assert(keys(moveTemplateTab(threeTabs(), -1, 1)) === "overview,sld,water", "moved a missing tab");
}

/** Remove takes the tab and its widgets, and renumbers the rest. */
export function removeTakesTheTabAndItsWidgets(): void {
  const tabs = removeTemplateTab(threeTabs(), 1);
  assert(keys(tabs) === "overview,water" && orders(tabs) === "0,1", `remove: ${keys(tabs)} ${orders(tabs)}`);
  assert(!tabs.some((tab) => tab.widgets.some((w) => w.key === "mimic")), "the removed tab's widget stayed");
}

/** Domain and group code set one tab; a blank group code removes the key. */
export function domainAndGroupCodeSetOneTab(): void {
  const overview = setTemplateTabDomain(threeTabs(), 1, null);
  assert(overview[1]!.domain === null && overview[2]!.domain === "water", "domain set the wrong tab");
  const coded = setTemplateTabGroupCode(threeTabs(), 2, "  RAW  ");
  assert(coded[2]!.groupCode === "RAW", `group code: ${coded[2]!.groupCode}`);
  const cleared = setTemplateTabGroupCode(threeTabs(), 1, " ");
  assert(!("groupCode" in cleared[1]!), "a blank group code was kept");
}

/** `withTabWidgets` replaces one tab's widgets. */
export function withTabWidgetsReplacesOneTab(): void {
  const tabs = withTabWidgets(threeTabs(), 2, (widgets) => [...widgets, widget("new")]);
  assert(tabs[2]!.widgets.length === 1 && tabs[2]!.widgets[0]!.key === "new", "the widget was not added");
  assert(tabs[0]!.widgets.length === 2, "another tab changed");
}

/** A blank widget passes the template content schema, in a tab of a site PATCH. */
export function aBlankWidgetIsAValidTemplateWidget(): void {
  const parsed = updateDashboardTemplateBodySchema.safeParse({
    content: {
      widgets: [],
      tabs: [{ key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [blankTemplateWidget()] }],
    },
  });
  assert(parsed.success, `blank widget refused: ${parsed.success ? "" : parsed.error.message}`);
  assert(blankTemplateWidget().key !== blankTemplateWidget().key, "two blank widgets share a key");
}

/** A path or a problem line under `content.tabs.<i>` names tab `i`; anything else names none. */
export function tabIndexOfProblemReadsThePath(): void {
  assert(tabIndexOfProblem(["content", "tabs", 1, "widgets", 0, "config"]) === 1, "the path array");
  assert(
    tabIndexOfProblem("content.tabs.3.widgets.0.config.windowMinutes: Number must be greater than 0") === 3,
    "the line",
  );
  assert(tabIndexOfProblem("content.tabs.0.key: that tab key is reserved") === 0, "tab 0");
  assert(tabIndexOfProblem("content.widgets.0.key: duplicate") === null, "a top-level widget named a tab");
  assert(tabIndexOfProblem("content.tabs: Array must contain at most 8 element(s)") === null, "the list named a tab");
  assert(tabIndexOfProblem("content: Expected object") === null, "the flattened 400 named a tab");
  assert(tabIndexOfProblem("name: Required") === null, "a basics field named a tab");
  assert(tabIndexOfProblem(["content", "tabs", "x"]) === null, "a non-index named a tab");
  assert(tabIndexOfProblem([]) === null, "an empty path named a tab");
}

/** The first line that names a tab wins; none answers null. */
export function firstTabProblemPicksTheFirstTabLine(): void {
  const found = firstTabProblem(["name: Required", "content.tabs.2.label: Too short", "content.tabs.0.key: x"]);
  assert(found !== null && found.index === 2 && found.message === "content.tabs.2.label: Too short", "wrong pick");
  assert(firstTabProblem(["name: Required"]) === null, "a line with no tab was picked");
}

/** A real schema refusal of a tab widget's config reads back as that tab. */
export function aSchemaRefusalNamesItsTab(): void {
  const tabs: TemplateTabInput[] = threeTabs().map((tab) => ({
    ...tab,
    widgets: tab.widgets.filter((w) => w.widgetType === "value_tile"),
  }));
  tabs[1]!.widgets = [widget("bad", { config: { windowMinutes: -5 } } as never)];
  const parsed = updateDashboardTemplateBodySchema.safeParse({ content: { widgets: [], tabs } });
  assert(!parsed.success, "a negative window was accepted");
  if (parsed.success) return;
  const issue = parsed.error.issues[0]!;
  assert(issue.path.join(".").startsWith("content.tabs.1.widgets.0.config"), `path: ${issue.path.join(".")}`);
  assert(tabIndexOfProblem(issue.path) === 1, "the schema path did not name tab 1");
}
