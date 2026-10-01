import {
  domainsPresent,
  groupsToCreate,
  pickTabGroups,
  planSiteLayout,
  type SiteLayoutGroup,
  type SiteLayoutTabSpec,
} from "./site-layout-planner";
import { SMOC_STANDARD_SITE_TEMPLATE } from "./site-templates/smoc-standard";

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
  const targets = cardTargets(planSiteLayout(SMOC_TABS, PHE_GROUPS));
  assert(
    targets.join(",") === "sld,env",
    `PHE Overview module cards: expected sld,env, got ${targets.join(",")}`,
  );
}

export function pheReportsTheFourDroppedCards(): void {
  const dropped = planned(planSiteLayout(SMOC_TABS, PHE_GROUPS)).droppedCards;
  const shape = dropped.map((row) => `${row.tabKey}>${row.targetTabKey}`).join(",");
  assert(
    shape === "overview>ups,overview>hvac,overview>it,overview>water",
    `PHE dropped cards: got ${shape}`,
  );
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
