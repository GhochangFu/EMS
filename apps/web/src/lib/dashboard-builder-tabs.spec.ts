import { MAX_DASHBOARD_TABS, MIMIC_TAB_MESSAGE } from "@bms/shared";

import {
  addBuilderTab,
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  dashboardBuilderErrors,
  dashboardRowsFromDto,
  MIMIC_NEEDS_ASSET_GROUP_MESSAGE,
  moveBuilderTab,
  offerableWidgetTypesOnTab,
  removeBuilderTab,
  renameBuilderTabKey,
  TAB_LOCATION_MOVE_PROBLEM,
  tabLocationMoveProblems,
  TABS_PROBLEM_FIELD,
  type TabForRules,
  type TabWritePayload,
} from "./dashboard-builder-form";
import { withDefaultMimicTabKey } from "./dashboard-builder-mimic-tab";

/**
 * `F3.73` (plan Task 5.2, D11) — the tab rules and the tab edits of the builder. A sibling of
 * `dashboard-builder-form.spec.ts`, which sits at the §4.5 1000-line cap; assertions live here and
 * `dashboard-builder-tabs.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** "overview" binds no group; "electrical" binds one. */
const TABS_FOR_RULES = [
  { key: "overview", label: "Overview", assetGroupId: null },
  { key: "electrical", label: "Electrical", assetGroupId: "33333333-3333-4333-8333-333333333333" },
] as const;

const onTab = (tabKey: string, widgetType: Parameters<typeof blankDashboardWidgetRow>[0] = "value_tile") => ({
  ...blankDashboardWidgetRow(widgetType),
  tabKey,
});


const tabsProblems = (tabs: readonly TabForRules[]) =>
  dashboardBuilderErrors([], "location", tabs).filter((problem) => problem.field === TABS_PROBLEM_FIELD);

/** The site page owns the `assets` segment, so a tab keyed `assets` is refused with the reason.
 * Mutation: drop the reserved-key branch => red (the generic key sentence is not this one). */
export function runReservedTabKeyIsRefusedTests(): void {
  const problems = tabsProblems([{ key: "assets", label: "Assets", assetGroupId: null }]);
  assert(
    JSON.stringify(problems.map((problem) => [problem.widget, problem.message])) ===
      JSON.stringify([[null, 'Tab 1: the key "assets" is reserved for the site\'s Assets & RTUs page.']]),
    `a tab keyed assets reports the reserved-key problem — got ${JSON.stringify(problems)}`,
  );
}

/** A key that is not a lowercase slug is refused (the route segment and the key CHECK). */
export function runMalformedTabKeyIsRefusedTests(): void {
  const problems = tabsProblems([{ key: "Main Hall", label: "Main hall", assetGroupId: null }]);
  assert(
    problems.length === 1 && problems[0]!.message.startsWith("Tab 1: a key is 1 to 64 lowercase"),
    `a key with capitals and a space is refused — got ${JSON.stringify(problems)}`,
  );
  assert(tabsProblems(TABS_FOR_RULES).length === 0, "two well-formed tabs report no tab problem");
}

/** Two tabs may not share one key. Mutation: drop the duplicate check => red. */
export function runDuplicateTabKeyIsRefusedTests(): void {
  const problems = tabsProblems([
    { key: "ups", label: "UPS", assetGroupId: null },
    { key: "ups", label: "UPS 2", assetGroupId: null },
  ]);
  assert(
    JSON.stringify(problems.map((problem) => problem.message)) ===
      JSON.stringify(['Tab 2: another tab already uses the key "ups".']),
    `the second tab with a taken key is refused — got ${JSON.stringify(problems)}`,
  );
}

/** A tab needs a label; a blank one is refused. Mutation: drop the trim => red. */
export function runBlankTabLabelIsRefusedTests(): void {
  const problems = tabsProblems([{ key: "ups", label: "   ", assetGroupId: null }]);
  assert(
    JSON.stringify(problems.map((problem) => problem.message)) === JSON.stringify(["Tab 1 needs a label."]),
    `a blank label is refused — got ${JSON.stringify(problems)}`,
  );
}

/** At most `MAX_DASHBOARD_TABS` tabs, the API's array bound. */
export function runTooManyTabsIsRefusedTests(): void {
  const tabs = Array.from({ length: MAX_DASHBOARD_TABS + 1 }, (_, index) => ({
    key: `tab-${index + 1}`,
    label: `Tab ${index + 1}`,
    assetGroupId: null,
  }));
  const problems = tabsProblems(tabs);
  assert(
    problems.length === 1 && problems[0]!.message.includes(`at most ${MAX_DASHBOARD_TABS} tabs`),
    `${MAX_DASHBOARD_TABS + 1} tabs report one cap problem — got ${JSON.stringify(problems)}`,
  );
}

/** A group tab off a location scope is refused before the save: the PATCH of the new scope would
 * commit and the PUT then answer `TAB_GROUP_SCOPE_MESSAGE`. Mutation: drop the rule => red. */
export function runGroupTabOffALocationScopeIsRefusedTests(): void {
  const off = dashboardBuilderErrors([], "organization", TABS_FOR_RULES).filter(
    (problem) => problem.field === TABS_PROBLEM_FIELD,
  );
  assert(
    JSON.stringify(off.map((problem) => [problem.widget, problem.message])) ===
      JSON.stringify([
        [null, "Tab 2 binds an asset group, and only a location dashboard carries group tabs. Clear its group or choose a location."],
      ]),
    `a group tab on an organization dashboard is refused — got ${JSON.stringify(off)}`,
  );
  assert(tabsProblems(TABS_FOR_RULES).length === 0, "the same tabs on a location dashboard are clean");
}

/** A module summary card linking to a tab the dashboard does not have is refused (the API's
 * `TAB_TARGET_UNKNOWN_MESSAGE`). Mutation: drop the target check => red. */
export function runCardTargetingAMissingTabIsRefusedTests(): void {
  const card = { ...onTab("overview", "module_summary_card") };
  card.config = { ...card.config, targetTabKey: "hvac" };
  const flagged = dashboardBuilderErrors([card], "location", TABS_FOR_RULES).filter(
    (problem) => problem.field === "targetTabKey",
  );
  assert(
    JSON.stringify(flagged.map((problem) => [problem.widget, problem.message])) ===
      JSON.stringify([[0, 'This card links to the tab "hvac", which this dashboard does not have.']]),
    `a card targeting a missing tab is refused — got ${JSON.stringify(flagged)}`,
  );
  card.config = { ...card.config, targetTabKey: "electrical" };
  const clean = dashboardBuilderErrors([card], "location", TABS_FOR_RULES);
  assert(clean.length === 0, `a card targeting a present tab is clean — got ${JSON.stringify(clean)}`);
}

/** A widget naming a tab the dashboard does not have is refused (the API's
 * `TAB_KEY_UNKNOWN_MESSAGE`); on a tab-less dashboard a `tabKey` is refused as well. */
export function runWidgetOnAMissingTabIsRefusedTests(): void {
  const flagged = dashboardBuilderErrors([onTab("hvac")], "location", TABS_FOR_RULES).filter(
    (problem) => problem.field === "tabKey",
  );
  assert(
    JSON.stringify(flagged.map((problem) => problem.message)) ===
      JSON.stringify(['This widget sits on the tab "hvac", which this dashboard does not have.']),
    `a widget on a missing tab is refused — got ${JSON.stringify(flagged)}`,
  );
  const untabbed = dashboardBuilderErrors([onTab("hvac")], "location", []).filter((problem) => problem.field === "tabKey");
  assert(untabbed.length === 1, `a tabKey on a dashboard without tabs is refused — got ${JSON.stringify(untabbed)}`);
}

/** The edit page offers the plant mimic on a tab that binds a group, whatever the scope kind,
 * and — `F3.74` — on a group-less tab when another tab binds a group (the mimic then names that
 * tab through `config.tabKey`). Mutation: ignore the tab's group => red. */
export function runMimicOfferedOnAGroupTabTests(): void {
  const [overview, electrical] = TABS_FOR_RULES;
  assert(offerableWidgetTypesOnTab("location", electrical, TABS_FOR_RULES).includes("mimic"), "a group tab offers the mimic");
  assert(
    offerableWidgetTypesOnTab("location", overview, TABS_FOR_RULES).includes("mimic"),
    "the Overview tab offers it when a group-bound tab exists",
  );
  assert(
    !offerableWidgetTypesOnTab("location", overview, [overview]).includes("mimic"),
    "the Overview tab does not when no tab binds a group",
  );
  assert(!offerableWidgetTypesOnTab("location", undefined, []).includes("mimic"), "a tab-less location canvas does not");
  assert(offerableWidgetTypesOnTab("assetGroup", overview, [overview]).includes("mimic"), "a group scope offers it on any tab");
}

const mimicOnOverview = (mimicTabKey?: string) => {
  const row = onTab("overview", "mimic");
  return {
    ...row,
    config: { ...row.config, ...(mimicTabKey === undefined ? {} : { mimicTabKey }) },
  };
};
const mimicProblems = (mimicTabKey?: string) =>
  dashboardBuilderErrors([mimicOnOverview(mimicTabKey)], "location", TABS_FOR_RULES).map((problem) => problem.message);

/** `F3.74` plan D7 — an Overview mimic resolves through `config.tabKey`: none is the scope
 * sentence; a group-bound key is clean; a group-less or unknown key is the API's
 * `MIMIC_TAB_MESSAGE`. Mutation: ignore the key => the group-bound case reddens. */
export function runMimicResolvesThroughItsTabKeyTests(): void {
  assert(
    JSON.stringify(mimicProblems()) === JSON.stringify([MIMIC_NEEDS_ASSET_GROUP_MESSAGE]),
    `an Overview mimic with no tabKey is refused — got ${JSON.stringify(mimicProblems())}`,
  );
  assert(mimicProblems("electrical").length === 0, `a group-bound tabKey is clean — got ${JSON.stringify(mimicProblems("electrical"))}`);
  assert(
    JSON.stringify(mimicProblems("overview")) === JSON.stringify([MIMIC_TAB_MESSAGE]),
    `a group-less tabKey is refused with MIMIC_TAB_MESSAGE — got ${JSON.stringify(mimicProblems("overview"))}`,
  );
  assert(
    JSON.stringify(mimicProblems("nope")) === JSON.stringify([MIMIC_TAB_MESSAGE]),
    `an unknown tabKey is refused with MIMIC_TAB_MESSAGE — got ${JSON.stringify(mimicProblems("nope"))}`,
  );
  // A mimic on a group-bound tab of its own, or on a group scope, needs no key (the key is not read).
  assert(dashboardBuilderErrors([onTab("electrical", "mimic")], "location", TABS_FOR_RULES).length === 0, "a mimic on a group tab is clean");
  assert(
    dashboardBuilderErrors([mimicOnOverview("nope")], "assetGroup", [TABS_FOR_RULES[0]]).length === 0,
    "on a group scope the key is not judged (the API resolves the dashboard's group first)",
  );
}

/** `F3.74` — the payload carries `config.tabKey` and `compact`, and a stored mimic round-trips
 * both through `dashboardRowsFromDto`. Mutation: drop `compact` from the build => red. */
export function runMimicTabKeyAndCompactRoundTripTests(): void {
  const row = mimicOnOverview("electrical");
  row.config.mimicCompact = true;
  const body = buildPutWidgetsPayload([row], []);
  const config = body.widgets[0]!.config as Record<string, unknown>;
  assert(config.tabKey === "electrical", `the payload carries config.tabKey — got ${JSON.stringify(config)}`);
  assert(config.compact === true, `the payload carries compact — got ${JSON.stringify(config)}`);
  const plain = buildPutWidgetsPayload([onTab("overview", "mimic")], []).widgets[0]!.config as Record<string, unknown>;
  assert(!("tabKey" in plain) && !("compact" in plain), `absent stays absent — got ${JSON.stringify(plain)}`);
  const layout = mimicOnOverview("electrical");
  layout.config.mimicSource = "layout";
  layout.config.mimicLayoutId = "77777777-7777-4777-8777-777777777777";
  layout.config.mimicCompact = true;
  const layoutConfig = buildPutWidgetsPayload([layout], []).widgets[0]!.config as Record<string, unknown>;
  assert(layoutConfig.tabKey === "electrical" && !("compact" in layoutConfig), `the layout arm carries tabKey, not compact — got ${JSON.stringify(layoutConfig)}`);

  const dto = {
    tabs: [{ id: "t1", key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null }],
    widgets: [
      {
        id: "w1",
        tabId: "t1",
        widgetType: "mimic",
        title: null,
        gridX: 0,
        gridY: 0,
        gridW: 12,
        gridH: 6,
        points: [],
        sources: [],
        config: { source: "preset", preset: "lv_single_line", tabKey: "electrical", compact: true },
      },
    ],
  } as unknown as Parameters<typeof dashboardRowsFromDto>[0];
  const read = dashboardRowsFromDto(dto)[0]!;
  assert(
    read.config.mimicTabKey === "electrical" && read.config.mimicCompact === true,
    `a stored mimic reads tabKey and compact back — got ${JSON.stringify(read.config)}`,
  );
}

/** The tabs as the save path sends them: "overview" binds no group, "electrical" binds one. */
const SAVE_TABS: TabWritePayload[] = TABS_FOR_RULES.map((tab, sortOrder) => ({ ...tab, sortOrder }));

/** `F3.74` review finding 7(b) — a mimic on a group-bound tab resolves through that tab, so a
 * `mimicTabKey` left from an earlier tab is not saved; on a group-less tab the key is the mimic's
 * route and is saved. Mutation: drop `mimicConfigForSave` from the build => red. */
export function runMimicTabKeyIsDroppedOnAGroupTabTests(): void {
  const moved = onTab("electrical", "mimic");
  moved.config.mimicTabKey = "electrical";
  const written = buildPutWidgetsPayload([moved], SAVE_TABS).widgets[0]!.config as Record<string, unknown>;
  assert(!("tabKey" in written), `a mimic on a group tab saves no tabKey — got ${JSON.stringify(written)}`);
  const kept = buildPutWidgetsPayload([mimicOnOverview("electrical")], SAVE_TABS).widgets[0]!.config as Record<string, unknown>;
  assert(kept.tabKey === "electrical", `a mimic on a group-less tab saves its tabKey — got ${JSON.stringify(kept)}`);
}

/** `F3.74` review finding 7(c) — a new mimic on a group-less tab resolves through the first
 * group-bound tab by default, so it shows no scope problem; a mimic on a group tab, a non-mimic,
 * and a dashboard with no group tab get no key. Mutation: return the row unchanged => red. */
export function runNewMimicDefaultsItsTabKeyTests(): void {
  const fresh = withDefaultMimicTabKey(onTab("overview", "mimic"), TABS_FOR_RULES);
  assert(fresh.config.mimicTabKey === "electrical", `a new Overview mimic resolves through Electrical — got ${String(fresh.config.mimicTabKey)}`);
  const problems = dashboardBuilderErrors([fresh], "location", TABS_FOR_RULES);
  assert(problems.length === 0, `and shows no problem — got ${JSON.stringify(problems)}`);
  assert(withDefaultMimicTabKey(onTab("electrical", "mimic"), TABS_FOR_RULES).config.mimicTabKey === undefined, "a mimic on a group tab gets no key");
  assert(withDefaultMimicTabKey(onTab("overview"), TABS_FOR_RULES).config.mimicTabKey === undefined, "a value tile gets no key");
  assert(withDefaultMimicTabKey(onTab("overview", "mimic"), [TABS_FOR_RULES[0]]).config.mimicTabKey === undefined, "no group tab, no key");
}

const tabWrite = (key: string, sortOrder: number, assetGroupId: string | null = null): TabWritePayload => ({
  key,
  label: key.toUpperCase(),
  sortOrder,
  assetGroupId,
});

/** The first tab adopts every widget already on the canvas — a filtered canvas would otherwise
 * hide them while "needs every widget on a tab" blocks Save. A later tab adopts none, and its key
 * is the first free `tab-N`. Mutation: leave the rows untabbed => red. */
export function runAddingTheFirstTabAdoptsEveryWidgetTests(): void {
  const first = addBuilderTab({ tabs: [], rows: [blankDashboardWidgetRow("value_tile"), blankDashboardWidgetRow("chart")] });
  assert(
    JSON.stringify(first.tabs) === JSON.stringify([{ key: "tab-1", label: "Tab 1", sortOrder: 0, assetGroupId: null }]),
    `the first tab is tab-1 at position 0 — got ${JSON.stringify(first.tabs)}`,
  );
  assert(
    first.rows.every((row) => row.tabKey === "tab-1"),
    `every widget moves onto the first tab — got ${JSON.stringify(first.rows.map((row) => row.tabKey))}`,
  );
  const second = addBuilderTab({ tabs: [tabWrite("tab-2", 0)], rows: [onTab("tab-2")] });
  assert(second.key === "tab-1" && second.tabs[1]!.sortOrder === 1, `the free key is tab-1 at position 1 — got ${JSON.stringify(second)}`);
  assert(second.rows[0]!.tabKey === "tab-2", "a later tab leaves the widgets where they are");
}

/** Review finding — a site-layout copy keeps the template's `sortOrder`s with gaps where tabs were
 * omitted (the CSMOC copy stores 0, 1, 2, 3, 6). A new tab is shown last, so it must save last and
 * never tie with a stored tab. Mutation: `sortOrder: state.tabs.length` without the renumber => red. */
export function runAddingATabAfterAGapSavesItLastTests(): void {
  const next = addBuilderTab({ tabs: [tabWrite("overview", 0), tabWrite("ups", 1), tabWrite("water", 6)], rows: [] });
  assert(
    JSON.stringify(next.tabs.map((tab) => [tab.key, tab.sortOrder])) ===
      JSON.stringify([["overview", 0], ["ups", 1], ["water", 2], ["tab-1", 3]]),
    `the new tab saves after every stored tab, in panel order — got ${JSON.stringify(next.tabs)}`,
  );
}

/** Review finding — `dashboard_tabs_dashboard_id_location_id_fkey` refuses the PATCH that moves a
 * dashboard while a SAVED tab binds a group at its site, and the save sends the PATCH before the PUT
 * that would clear the group. So a move is refused here, before Save, while the stored tabs bind one.
 * Mutation: drop the stored-group test (or the location comparison) => red. */
export function runMovingASiteWithSavedGroupTabsIsRefusedTests(): void {
  const stored = {
    locationId: "11111111-1111-4111-8111-111111111111",
    tabs: [
      { assetGroupId: null },
      { assetGroupId: "33333333-3333-4333-8333-333333333333" },
    ],
  };
  const moved = tabLocationMoveProblems(stored, { locationId: "22222222-2222-4222-8222-222222222222", assetGroupId: null });
  assert(
    JSON.stringify(moved) === JSON.stringify([{ widget: null, field: TABS_PROBLEM_FIELD, message: TAB_LOCATION_MOVE_PROBLEM }]),
    `a move off saved group tabs is refused with the reason — got ${JSON.stringify(moved)}`,
  );
  const toGroup = tabLocationMoveProblems(stored, { locationId: null, assetGroupId: "44444444-4444-4444-8444-444444444444" });
  assert(toGroup.length === 1, `a change to a group scope leaves the site too — got ${JSON.stringify(toGroup)}`);
  assert(
    tabLocationMoveProblems(stored, { locationId: stored.locationId, assetGroupId: null }).length === 0,
    "the same site is not a move",
  );
  assert(tabLocationMoveProblems(stored, {}).length === 0, "an asset scope sends no scope columns, so it never moves");
  assert(
    tabLocationMoveProblems({ ...stored, tabs: [{ assetGroupId: null }] }, { locationId: null, assetGroupId: null }).length === 0,
    "saved tabs without a group do not hold the dashboard at its site",
  );
}

/** Re-keying a tab carries its widgets and every card that links to it; a key another tab holds
 * is refused (null), so two tabs' widgets can never merge. Mutation: leave the cards' target => red. */
export function runRenamingATabKeyCarriesItsWidgetsTests(): void {
  const card = { ...onTab("overview", "module_summary_card") };
  card.config = { ...card.config, targetTabKey: "ups" };
  const state = { tabs: [tabWrite("overview", 0), tabWrite("ups", 1)], rows: [card, onTab("ups"), onTab("overview")] };
  const next = renameBuilderTabKey(state, 1, "ups-battery");
  assert(next !== null, "a free key is accepted");
  assert(next!.tabs[1]!.key === "ups-battery", `the tab takes the new key — got ${JSON.stringify(next!.tabs)}`);
  assert(
    JSON.stringify(next!.rows.map((row) => row.tabKey)) === JSON.stringify(["overview", "ups-battery", "overview"]),
    `only the re-keyed tab's widgets follow — got ${JSON.stringify(next!.rows.map((row) => row.tabKey))}`,
  );
  assert(next!.rows[0]!.config.targetTabKey === "ups-battery", "the card that links to the tab follows the key");
  assert(renameBuilderTabKey(state, 1, "overview") === null, "a key another tab holds is refused");
}

/** Moving a tab renumbers `sortOrder` from position. */
export function runMovingATabRenumbersTests(): void {
  const moved = moveBuilderTab([tabWrite("a", 0), tabWrite("b", 1), tabWrite("c", 2)], 2, -1);
  assert(
    JSON.stringify(moved.map((tab) => [tab.key, tab.sortOrder])) === JSON.stringify([["a", 0], ["c", 1], ["b", 2]]),
    `c moves before b and the order is renumbered — got ${JSON.stringify(moved)}`,
  );
  assert(moveBuilderTab(moved, 0, -1) === moved, "the first tab does not move up");
}

/** Removing a tab removes its widgets (the API cascades them); removing the last tab returns the
 * dashboard to one canvas, so no widget keeps a `tabKey`. Mutation: keep the removed tab's rows => red. */
export function runRemovingATabRemovesItsWidgetsTests(): void {
  const state = { tabs: [tabWrite("overview", 0), tabWrite("ups", 1)], rows: [onTab("overview"), onTab("ups"), onTab("ups")] };
  const next = removeBuilderTab(state, 1);
  assert(
    JSON.stringify(next.tabs.map((tab) => [tab.key, tab.sortOrder])) === JSON.stringify([["overview", 0]]),
    `the ups tab is gone — got ${JSON.stringify(next.tabs)}`,
  );
  assert(
    JSON.stringify(next.rows.map((row) => row.tabKey)) === JSON.stringify(["overview"]),
    `only the overview widget stays — got ${JSON.stringify(next.rows.map((row) => row.tabKey))}`,
  );
  const last = removeBuilderTab({ tabs: [tabWrite("overview", 0)], rows: [onTab("overview")] }, 0);
  assert(last.tabs.length === 0 && last.rows.length === 0, `the last tab takes its widgets — got ${JSON.stringify(last)}`);
  const stray = removeBuilderTab({ tabs: [tabWrite("overview", 0)], rows: [onTab("gone")] }, 0);
  assert(stray.rows.length === 1 && !("tabKey" in stray.rows[0]!), "with no tab left, no widget keeps a tabKey");
}
