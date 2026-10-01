import {
  domainsPresent,
  groupsToCreate,
  omitUnboundTiles,
  packAfterRemoval,
  pickTabGroups,
  planSiteLayout,
  type SiteLayoutGroup,
  type SiteLayoutTabSpec,
} from "./site-layout-planner";
import type { SectionTemplateWidget, SiteTemplateTab } from "./index";
import { SMOC_STANDARD_SITE_TEMPLATE } from "./site-templates/smoc-standard";
import { planTemplateWidget } from "./template-instantiation";

/**
 * `F3.73` plan D5 — the site-layout planner. Assertions live here; `site-layout-planner.test.ts`
 * is the Vitest entry point (ADR 0014). One claim per exported function, so a mutation reddens
 * the `it` that owns it.
 *
 * **Group ids never equal group codes in these fixtures** (`grp-<code>`), so a planner that
 * matched a choice by code, or answered a code where an id belongs, fails here and is not
 * hidden by a fixture where the two spell the same string.
 *
 * The site shapes are the seeded ones Task 4.0 measured: a PHE pump station (electrical +
 * environment), CSMOC Gauteng (two electrical-domain groups, two water-domain groups, a
 * domain-less formula group) and IONX-DEMO (one water group).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function group(code: string, domain: string | null): SiteLayoutGroup {
  return { id: `grp-${code}`, code, name: `${code} group`, domain };
}

const SMOC_TABS = SMOC_STANDARD_SITE_TEMPLATE.content.tabs;

/** One `module_summary_card` that opens `targetTabKey`, in slot `slot` of the fixture's card row (y6). */
function fixtureCard(targetTabKey: string, slot: number): SectionTemplateWidget {
  return {
    key: `overview-${targetTabKey}-card`,
    title: targetTabKey,
    gridX: slot * 2,
    gridY: 6,
    gridW: 2,
    gridH: 3,
    bindings: [],
    sources: [],
    widgetType: "module_summary_card",
    config: { targetTabKey },
  };
}

/**
 * `F3.77` — the stock Overview holds no card since v3 (plan D1), but the drop-and-pack rule stays
 * for an admin's site template. This fixture is the SMOC tabs with an Overview that carries one
 * card per group tab in a row at y6 between a strip and a rail, the shape the v2 stock row had.
 */
const CARD_TABS: readonly SiteTemplateTab[] = [
  {
    key: "overview",
    label: "Overview",
    sortOrder: 0,
    domain: null,
    widgets: [
      {
        key: "overview-class-strip",
        title: null,
        gridX: 0,
        gridY: 0,
        gridW: 12,
        gridH: 6,
        bindings: [],
        sources: [],
        widgetType: "asset_class_strip",
        config: {},
      },
      ...["sld", "ups", "hvac", "it", "env", "water"].map(fixtureCard),
      {
        key: "overview-alarms-rail",
        title: "Active alarms",
        gridX: 0,
        gridY: 9,
        gridW: 12,
        gridH: 5,
        bindings: [],
        sources: [],
        widgetType: "active_alarms_rail",
        config: { rows: 8, showSummary: true },
      },
    ],
  },
  ...SMOC_TABS.slice(1),
];

const PHE_GROUPS = [group("electrical", "electrical"), group("environment", "environment")];

const CSMOC_GROUPS = [
  group("electrical", "electrical"),
  group("ups-battery", "electrical"),
  group("hvac", "hvac"),
  group("water", "water"),
  group("demo-water-plant", "water"),
  group("IT_LOAD", null),
];

const CSMOC_CHOICE = { sld: "grp-electrical", ups: "grp-ups-battery", water: "grp-water" };

/** The four tabs the pick tests below need: an Overview and three with a domain. */
const PICK_TABS: SiteLayoutTabSpec[] = [
  { key: "overview", sortOrder: 0, domain: null },
  { key: "sld", sortOrder: 1, domain: "electrical", groupCode: "electrical" },
  { key: "ups", sortOrder: 2, domain: "electrical", groupCode: "ups-battery" },
  { key: "hvac", sortOrder: 3, domain: "hvac" },
];

function planned(result: ReturnType<typeof planSiteLayout>) {
  if (result.status !== "planned") {
    throw new Error(`expected a planned layout, got ${result.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

function tabKeys(result: ReturnType<typeof planSiteLayout>): string {
  return planned(result).tabs.map((row) => row.tab.key).join(",");
}

function cardTargets(result: ReturnType<typeof planSiteLayout>): string[] {
  const overview = planned(result).tabs.find((row) => row.tab.key === "overview");
  assert(overview !== undefined, "the plan has no overview tab");
  return (overview?.tab.widgets ?? []).flatMap((widget) =>
    widget.widgetType === "module_summary_card" ? [widget.config.targetTabKey] : [],
  );
}

// ---- the PHE pump-station shape -------------------------------------------------------------

export function pheShapeKeepsOverviewSldAndEnv(): void {
  const keys = tabKeys(planSiteLayout(SMOC_TABS, PHE_GROUPS));
  assert(keys === "overview,sld,env", `PHE tabs: expected overview,sld,env, got ${keys}`);
}

export function pheShapeOmitsTheFourAbsentDomains(): void {
  const omitted = planned(planSiteLayout(SMOC_TABS, PHE_GROUPS)).omitted.map((row) => row.tabKey);
  assert(
    omitted.join(",") === "ups,hvac,it,water",
    `PHE omitted tabs: expected ups,hvac,it,water, got ${omitted.join(",")}`,
  );
}

export function pheOverviewKeepsExactlyTheSldAndEnvCards(): void {
  const targets = cardTargets(planSiteLayout(CARD_TABS, PHE_GROUPS));
  assert(
    targets.join(",") === "sld,env",
    `PHE Overview module cards: expected sld,env, got ${targets.join(",")}`,
  );
}

export function pheReportsTheFourDroppedCards(): void {
  const dropped = planned(planSiteLayout(CARD_TABS, PHE_GROUPS)).droppedCards;
  const shape = dropped.map((row) => `${row.tabKey}>${row.targetTabKey}`).join(",");
  assert(
    shape === "overview>ups,overview>hvac,overview>it,overview>water",
    `PHE dropped cards: got ${shape}`,
  );
}

/**
 * `F3.77` plan D1 — the v3 stock Overview holds no card, so a PHE copy drops none. The kept
 * Overview still carries its eight widgets: the adjacent positive, so an empty plan cannot pass.
 */
export function theSmocOverviewHasNoCardToDrop(): void {
  const plan = planned(planSiteLayout(SMOC_TABS, PHE_GROUPS));
  const overview = plan.tabs.find((row) => row.tab.key === "overview");
  assert(overview?.tab.widgets.length === 8, `PHE Overview widgets: got ${overview?.tab.widgets.length}`);
  assert(plan.droppedCards.length === 0, `PHE dropped cards: got ${JSON.stringify(plan.droppedCards)}`);
}

// ---- the CSMOC Gauteng shape ----------------------------------------------------------------

export function csmocWithTheSeedChoiceHasFiveTabs(): void {
  const keys = tabKeys(planSiteLayout(SMOC_TABS, CSMOC_GROUPS, CSMOC_CHOICE));
  assert(keys === "overview,sld,ups,hvac,water", `CSMOC tabs (choice): got ${keys}`);
}

export function csmocWithoutAChoiceHasTheSameFiveTabs(): void {
  const keys = tabKeys(planSiteLayout(SMOC_TABS, CSMOC_GROUPS));
  assert(keys === "overview,sld,ups,hvac,water", `CSMOC tabs (no choice): got ${keys}`);
}

export function csmocWithoutAChoiceBindsEachTabByGroupCode(): void {
  const bound = planned(planSiteLayout(SMOC_TABS, CSMOC_GROUPS))
    .tabs.map((row) => `${row.tab.key}=${row.group?.id ?? "none"}:${row.via}`)
    .join(",");
  assert(
    bound ===
      "overview=none:overview,sld=grp-electrical:group_code,ups=grp-ups-battery:group_code," +
        "hvac=grp-hvac:single,water=grp-water:group_code",
    `CSMOC bindings (no choice): got ${bound}`,
  );
}

export function csmocWithTheSeedChoiceBindsByChoice(): void {
  const bound = planned(planSiteLayout(SMOC_TABS, CSMOC_GROUPS, CSMOC_CHOICE))
    .tabs.filter((row) => row.via === "choice")
    .map((row) => `${row.tab.key}=${row.group?.id ?? "none"}`)
    .join(",");
  assert(
    bound === "sld=grp-electrical,ups=grp-ups-battery,water=grp-water",
    `CSMOC bindings made by the choice: got ${bound}`,
  );
}

/** `IT_LOAD` is a group with `domain: null`, and the Overview is a tab with `domain: null`. */
export function aDomainlessGroupNeverBindsTheOverview(): void {
  const overview = planned(planSiteLayout(SMOC_TABS, CSMOC_GROUPS)).tabs.find(
    (row) => row.tab.key === "overview",
  );
  assert(overview?.group === null, `the Overview bound ${overview?.group?.code ?? "no tab"}`);
}

// ---- ambiguity and refusals -----------------------------------------------------------------

export function twoCandidatesWithNoGroupCodeMatchAreAmbiguous(): void {
  const result = pickTabGroups(PICK_TABS, [
    group("electrical-a", "electrical"),
    group("electrical-b", "electrical"),
  ]);
  assert(result.status === "ambiguous", `expected ambiguous, got ${result.status}`);
  const sld = result.status === "ambiguous" ? result.ambiguous.find((row) => row.tabKey === "sld") : undefined;
  assert(
    JSON.stringify(sld) ===
      JSON.stringify({
        tabKey: "sld",
        domain: "electrical",
        candidates: [
          { id: "grp-electrical-a", code: "electrical-a", name: "electrical-a group" },
          { id: "grp-electrical-b", code: "electrical-b", name: "electrical-b group" },
        ],
      }),
    `the ambiguous sld entry: got ${JSON.stringify(sld)}`,
  );
}

function refusals(choice: Readonly<Record<string, string>>): string {
  const result = pickTabGroups(PICK_TABS, CSMOC_GROUPS, choice);
  return result.status === "refused"
    ? result.refused.map((row) => `${row.tabKey}:${row.reason}`).join(",")
    : `not refused (${result.status})`;
}

export function aChoiceOfAnotherDomainIsRefused(): void {
  const got = refusals({ sld: "grp-hvac" });
  assert(got === "sld:wrong_domain", `a wrong-domain choice: got ${got}`);
}

export function aChoiceOfATakenGroupIsRefused(): void {
  const got = refusals({ sld: "grp-electrical", ups: "grp-electrical" });
  assert(got === "ups:taken", `a taken-group choice: got ${got}`);
}

export function aChoiceOfAGroupNotAtTheSiteIsRefused(): void {
  const got = refusals({ sld: "grp-elsewhere" });
  assert(got === "sld:unknown_group", `a group not at the site: got ${got}`);
}

export function aChoiceForTheOverviewIsRefused(): void {
  const got = refusals({ overview: "grp-electrical" });
  assert(got === "overview:overview_tab", `a choice for the Overview: got ${got}`);
}

export function aChoiceForAnUnknownTabIsRefused(): void {
  const got = refusals({ nope: "grp-electrical" });
  assert(got === "nope:unknown_tab", `a choice for an unknown tab: got ${got}`);
}

export function aLaterTabTakesOnlyAnUntakenGroup(): void {
  const result = pickTabGroups(
    [
      { key: "a", sortOrder: 0, domain: "electrical" },
      { key: "b", sortOrder: 1, domain: "electrical" },
    ],
    [group("g1", "electrical"), group("g2", "electrical")],
    { a: "grp-g1" },
  );
  const b = result.status === "planned" ? result.tabs.find((row) => row.tab.key === "b") : undefined;
  assert(b?.group?.id === "grp-g2", `tab b: expected grp-g2, got ${b?.group?.id ?? result.status}`);
}

// ---- the IONX-DEMO shape --------------------------------------------------------------------

export function ionxShapeKeepsOverviewAndWater(): void {
  const keys = tabKeys(planSiteLayout(SMOC_TABS, [group("demo-water-plant", "water")]));
  assert(keys === "overview,water", `IONX-DEMO tabs: got ${keys}`);
}

export function ionxShapeCreatesNoGroup(): void {
  const made = groupsToCreate(
    [
      { id: "a-wtp", domain: "water" },
      { id: "a-ro", domain: "water" },
    ],
    [group("demo-water-plant", "water")],
  );
  assert(made.length === 0, `IONX-DEMO groups to create: got ${JSON.stringify(made)}`);
}

// ---- domains and group creation -------------------------------------------------------------

export function aSiteWithNoGroupGetsOneGroupPerDomain(): void {
  const made = groupsToCreate(
    [
      { id: "a1", domain: "environment" },
      { id: "a2", domain: "electrical" },
      { id: "a3", domain: null },
      { id: "a4", domain: "electrical" },
    ],
    [],
  );
  assert(
    JSON.stringify(made) ===
      JSON.stringify([
        { code: "electrical", domain: "electrical", assetIds: ["a2", "a4"] },
        { code: "environment", domain: "environment", assetIds: ["a1"] },
      ]),
    `groups to create: got ${JSON.stringify(made)}`,
  );
}

export function domainsPresentIsSortedUniqueAndNonNull(): void {
  const got = domainsPresent([
    { domain: "water" },
    { domain: null },
    { domain: "electrical" },
    { domain: "water" },
  ]);
  assert(got.join(",") === "electrical,water", `domains present: got ${got.join(",")}`);
}

// ---- packing: the Overview cards (critique finding a) ----------------------------------------

/** `targetTabKey@gridX,gridY` of each Overview card, in widget order. */
function cardRects(result: ReturnType<typeof planSiteLayout>): string {
  const overview = planned(result).tabs.find((row) => row.tab.key === "overview");
  return (overview?.tab.widgets ?? [])
    .flatMap((widget) =>
      widget.widgetType === "module_summary_card" ? [`${widget.config.targetTabKey}@${widget.gridX},${widget.gridY}`] : [],
    )
    .join(" ");
}

export function pheOverviewPacksTheKeptCardsLeft(): void {
  const got = cardRects(planSiteLayout(CARD_TABS, PHE_GROUPS));
  assert(got === "sld@0,6 env@2,6", `PHE Overview card rects: got ${got}`);
}

export function csmocOverviewPacksTheKeptCardsLeftInTemplateOrder(): void {
  const got = cardRects(planSiteLayout(CARD_TABS, CSMOC_GROUPS, CSMOC_CHOICE));
  assert(got === "sld@0,6 ups@2,6 hvac@4,6 water@6,6", `CSMOC Overview card rects: got ${got}`);
}

export function packingNeverMovesTheTemplatesOwnCards(): void {
  planSiteLayout(CARD_TABS, PHE_GROUPS);
  const env = CARD_TABS[0]?.widgets.find((widget) => widget.key === "overview-env-card");
  assert(env?.gridX === 8, `the template's env card moved to ${env?.gridX}`);
}

// ---- packing: the general rule ---------------------------------------------------------------

type Box = { readonly id: string; readonly gridX: number; readonly gridY: number; readonly gridW: number; readonly gridH: number };
const box = (id: string, gridX: number, gridY: number, gridW: number, gridH: number): Box => ({ id, gridX, gridY, gridW, gridH });
const boxes = (list: readonly Box[]): string => list.map((b) => `${b.id}@${b.gridX},${b.gridY}`).join(" ");

export function aRowWithNoRemovalKeepsItsGaps(): void {
  const got = packAfterRemoval(
    [box("a", 0, 0, 3, 2), box("b", 6, 0, 3, 2), box("c", 0, 2, 3, 2), box("d", 3, 2, 3, 2)],
    (b) => b.id !== "c",
  );
  assert(boxes(got) === "a@0,0 b@6,0 d@0,2", `pack, a gap in an untouched row: got ${boxes(got)}`);
}

export function anEmptiedRowLiftsTheRowsBelowIt(): void {
  const got = packAfterRemoval(
    [box("t1", 0, 0, 3, 2), box("t2", 3, 0, 3, 2), box("rail", 0, 2, 6, 5), box("table", 6, 2, 6, 5)],
    (b) => b.id !== "t1" && b.id !== "t2",
  );
  assert(boxes(got) === "rail@0,0 table@6,0", `pack, an emptied row: got ${boxes(got)}`);
}

export function aRowThatKeepsAWidgetLiftsNothing(): void {
  const got = packAfterRemoval(
    [box("t1", 0, 0, 3, 2), box("t2", 3, 0, 3, 2), box("rail", 0, 2, 6, 5)],
    (b) => b.id !== "t1",
  );
  assert(boxes(got) === "t2@0,0 rail@0,2", `pack, a row that keeps one: got ${boxes(got)}`);
}

/** A kept tall widget from a higher row that reaches into the packed row is an obstacle, not a gap. */
export function aPackedRowStepsAroundATallWidgetFromAbove(): void {
  const got = packAfterRemoval(
    [box("t", 4, 0, 2, 4), box("a", 0, 2, 4, 2), box("b", 6, 2, 4, 2), box("c", 10, 2, 2, 2)],
    (b) => b.id !== "a",
  );
  assert(boxes(got) === "t@4,0 b@0,2 c@6,2", `pack, a tall widget from above: got ${boxes(got)}`);
}

/** A tall widget packed left does not slide over a kept widget in a lower row it reaches into. */
export function aPackedTallWidgetStepsAroundAWidgetBelow(): void {
  const got = packAfterRemoval(
    [box("a", 0, 0, 3, 2), box("r", 3, 0, 3, 6), box("x", 0, 2, 3, 2)],
    (b) => b.id !== "a",
  );
  assert(boxes(got) === "r@3,0 x@0,2", `pack, a tall widget over a lower row: got ${boxes(got)}`);
}

// ---- unbound role tiles (critique finding b) -------------------------------------------------

const SLD_WIDGETS = SMOC_TABS[1].widgets;

/** Plans the SLD tab where `incoming-supply` has a member holding only `kw`, `meter` none. */
function sldPlans(pointKeys: readonly string[]) {
  const members = new Map([["incoming-supply", [{ assetId: "a-inc", code: "INC-1" }]]]);
  const points = new Map(pointKeys.map((key) => [`a-inc::${key}`, `p-${key}`] as const));
  return SLD_WIDGETS.map((widget) => planTemplateWidget(widget, members, points));
}

function keysOf(plans: readonly { widget: { key: string } }[]): string {
  return plans.map((plan) => plan.widget.key).join(",");
}

export function aTileWhoseRoleHasNoMemberIsOmitted(): void {
  const { omittedTiles } = omitUnboundTiles("sld", sldPlans(["kw", "pf"]));
  const got = omittedTiles.map((tile) => `${tile.tabKey}>${tile.widgetKey}`).join(",");
  assert(
    got === "sld>sld-frequency-tile,sld>sld-main-bus-kw-tile",
    `omitted tiles, roles with no member: got ${got}`,
  );
}

export function aTileWhoseMemberLacksThePointKeyIsOmitted(): void {
  // `incoming-supply` HAS a member, so `pf` reports `partial`, not `unresolved` — and still no point.
  const plans = sldPlans(["kw"]);
  const pf = plans.find((plan) => plan.widget.key === "sld-incomer-pf-tile");
  assert(pf?.resolution.outcome === "partial", `fixture: pf outcome is ${pf?.resolution.outcome}`);
  const { omittedTiles } = omitUnboundTiles("sld", plans);
  assert(
    omittedTiles.some((tile) => tile.widgetKey === "sld-incomer-pf-tile"),
    `a member without the point key: got ${omittedTiles.map((tile) => tile.widgetKey).join(",")}`,
  );
}

export function aBoundTileAndEveryUnboundWidgetAreKept(): void {
  const { plans } = omitUnboundTiles("sld", sldPlans(["kw"]));
  assert(
    keysOf(plans) === "sld-incomer-kw-tile,sld-mimic,sld-alarms-rail,sld-assets-table",
    `kept widgets: got ${keysOf(plans)}`,
  );
}

export function aSourceTileWithNoRoleIsKept(): void {
  const overview = SMOC_TABS[0].widgets.map((widget) => planTemplateWidget(widget, new Map(), new Map()));
  const { omittedTiles } = omitUnboundTiles("overview", overview);
  assert(omittedTiles.length === 0, `overview omitted tiles: got ${omittedTiles.length}`);
}

export function theKeptTilesArePackedLeft(): void {
  const { plans } = omitUnboundTiles("sld", sldPlans(["pf"]));
  const tile = plans.find((plan) => plan.widget.key === "sld-incomer-pf-tile");
  assert(tile?.widget.gridX === 0 && tile.widget.gridY === 0, `pf tile at ${tile?.widget.gridX},${tile?.widget.gridY}`);
}

export function aTabThatLosesEveryTileLiftsItsBody(): void {
  const { plans } = omitUnboundTiles("sld", sldPlans([]));
  const mimic = plans.find((plan) => plan.widget.key === "sld-mimic");
  assert(mimic?.widget.gridY === 0, `sld mimic with no tile at y ${mimic?.widget.gridY}`);
}
