import { createHash } from "node:crypto";

import { type SectionTemplateContent, sectionTemplateContentSchema } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  canonicalJson,
  OVERVIEW_TAB_KEY,
  OVERVIEW_V2_WIDGETS,
  OVERVIEW_V3_WIDGETS,
  SMOC_STANDARD_V1_RECTS,
  SMOC_STANDARD_V2_DOMAIN_TABS_SHA256,
  SMOC_STANDARD_V2_RECTS,
  SLD_V3_WIDGETS,
  siteTemplateRects,
  siteWidgetIdentity,
  smocStandardV1Content,
  smocStandardV2Content,
  smocStandardV3Content,
} from "./site-layout-stock-history";

/**
 * The SMOC standard site layout's frozen stock history (`F3.77` plan D5). Assertions live here;
 * `site-layout-stock-history.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const current = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;

const rectsOf = (rects: ReadonlyMap<string, { gridX: number; gridY: number; gridW: number; gridH: number }>): string =>
  [...rects].map(([identity, r]) => `${identity}@${r.gridX},${r.gridY},${r.gridW},${r.gridH}`).join(";");

/**
 * Every tab but the Overview of the v2 content is the one stock v2 shipped: the hash was taken
 * from the v2 source (`smoc-standard.ts` at `b21eadad`). The v2 content is built from the frozen
 * v3, so the live `sld` tab changing in v4 does not move it; an edit to a frozen tab, or building
 * v2 from the live `sld` tab, does.
 */
export function everyDomainTabIsUnchangedFromV2(): void {
  const domainTabs = smocStandardV2Content().tabs.filter((tab) => tab.key !== OVERVIEW_TAB_KEY);
  const digest = createHash("sha256").update(canonicalJson(domainTabs)).digest("hex");
  assert(
    digest === SMOC_STANDARD_V2_DOMAIN_TABS_SHA256,
    `the domain tabs hash to ${digest}: a domain tab changed, which is a stock version bump — freeze ` +
      "v2's tab in site-layout-stock-history.ts first; do not update this hash",
  );
}

/** The v2 Overview's 14 widgets at the rects stock v2 shipped (legend 12×2 first, 14 rows). */
export function theV2OverviewHoldsItsFourteenWidgetsAtTheirV2Rects(): void {
  const got = OVERVIEW_V2_WIDGETS.map(
    (w) => `${w.widgetType}|${w.title ?? ""}@${w.gridX},${w.gridY},${w.gridW},${w.gridH}`,
  ).join(";");
  assert(
    got ===
      "state_legend|@0,0,12,2;" +
        "value_tile|Active alarms@0,2,3,2;value_tile|Total load@3,2,3,2;" +
        "value_tile|Asset health@6,2,3,2;value_tile|Offline assets@9,2,3,2;" +
        "asset_class_strip|@0,4,12,2;" +
        "module_summary_card|Electrical@0,6,2,3;module_summary_card|UPS & battery@2,6,2,3;" +
        "module_summary_card|HVAC@4,6,2,3;module_summary_card|IT@6,6,2,3;" +
        "module_summary_card|Environment@8,6,2,3;module_summary_card|Water@10,6,2,3;" +
        "active_alarms_rail|Active alarms@0,9,6,5;critical_systems_list|Critical systems@6,9,6,5",
    got,
  );
}

/** The v2 Offline tile drew the `alert` icon; v3 gave it `offline`. */
export function theV2OfflineTileDrawsTheAlertIcon(): void {
  const tile = OVERVIEW_V2_WIDGETS.find((w) => w.title === "Offline assets");
  assert(canonicalJson(tile?.config) === canonicalJson({ icon: "alert" }), canonicalJson(tile?.config));
}

/** The v2 content is a valid site template: the frozen v3 tabs with the v2 Overview in place. */
export function theV2ContentParsesAndHoldsTheV2Overview(): void {
  const v2 = smocStandardV2Content();
  assert(sectionTemplateContentSchema.safeParse(v2).success, "the v2 content does not parse");
  assert(
    v2.tabs.map((tab) => tab.key).join(",") === current.tabs.map((tab) => tab.key).join(","),
    v2.tabs.map((tab) => tab.key).join(","),
  );
  const overview = v2.tabs.find((tab) => tab.key === OVERVIEW_TAB_KEY);
  assert(canonicalJson(overview?.widgets) === canonicalJson(OVERVIEW_V2_WIDGETS), "the v2 Overview is not the frozen one");
  assert(SMOC_STANDARD_V2_RECTS.size === 14 + 32, `${SMOC_STANDARD_V2_RECTS.size} v2 identities`);
}

/** The v1 table names exactly the v2 widgets, and the v1 content holds each at its v1 rect. */
export function theV1ContentHoldsEveryV2WidgetAtItsV1Rect(): void {
  const v1Keys = [...SMOC_STANDARD_V1_RECTS.keys()].sort().join(",");
  const v2Keys = [...SMOC_STANDARD_V2_RECTS.keys()].sort().join(",");
  assert(v1Keys === v2Keys, `v1 table: ${v1Keys}\nv2: ${v2Keys}`);
  const v1 = siteTemplateRects(smocStandardV1Content());
  assert(rectsOf(new Map([...v1].sort())) === rectsOf(new Map([...SMOC_STANDARD_V1_RECTS].sort())), rectsOf(v1));
  const card = SMOC_STANDARD_V1_RECTS.get(siteWidgetIdentity("overview", "module_summary_card", "HVAC"));
  assert(card?.gridY === 9 && card.gridH === 4, `the v1 HVAC card: ${JSON.stringify(card)}`);
}

/** Key order does not change a canonical form: Postgres `jsonb` reorders an object's keys. */
export function theCanonicalFormIgnoresKeyOrder(): void {
  assert(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }) === canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }), "key order");
  assert(canonicalJson({ a: 1 }) !== canonicalJson({ a: 2 }), "a changed value is the same form");
  assert(canonicalJson([1, 2]) !== canonicalJson([2, 1]), "array order is ignored");
}

/** The v3 Overview's eight widgets at the rects stock v3 shipped (the strip full width at y9). */
export function theV3OverviewHoldsItsEightWidgetsAtTheirV3Rects(): void {
  const got = OVERVIEW_V3_WIDGETS.map(
    (w) => `${w.widgetType}|${w.title ?? ""}@${w.gridX},${w.gridY},${w.gridW},${w.gridH}`,
  ).join(";");
  assert(
    got ===
      "value_tile|Active alarms@0,0,3,2;value_tile|Offline assets@3,0,3,2;" +
        "value_tile|Total load@6,0,3,2;value_tile|Asset health@9,0,3,2;" +
        "active_alarms_rail|Active alarms@0,2,8,7;critical_systems_list|Critical systems@8,2,4,7;" +
        "asset_class_strip|@0,9,12,2;state_legend|@0,11,12,1",
    got,
  );
}

/** The v3 `sld` tab's seven widgets: no breaker table, the mimic at y2, the lower row at y9. */
export function theV3ElectricalTabHoldsItsSevenWidgetsAtTheirV3Rects(): void {
  const got = SLD_V3_WIDGETS.map(
    (w) => `${w.widgetType}|${w.title ?? ""}@${w.gridX},${w.gridY},${w.gridW},${w.gridH}`,
  ).join(";");
  assert(
    got ===
      "value_tile|Incomer load@0,0,3,2;value_tile|Incomer power factor@3,0,3,2;" +
        "value_tile|Frequency@6,0,3,2;value_tile|Main bus load@9,0,3,2;mimic|@0,2,12,7;" +
        "active_alarms_rail|Active alarms@0,9,6,5;table|Assets@6,9,6,5",
    got,
  );
}

/**
 * The v3 content holds the v3 Overview and the v2 electrical tab: the `sld` tab still draws
 * `electrical_distribution`, with no breaker table, and it is the tab the v2 content carries.
 */
export function theV3ContentHoldsTheV3OverviewAndTheV2ElectricalTab(): void {
  const v3 = smocStandardV3Content();
  assert(sectionTemplateContentSchema.safeParse(v3).success, "the v3 content does not parse");
  const overview = v3.tabs.find((tab) => tab.key === OVERVIEW_TAB_KEY);
  assert(canonicalJson(overview?.widgets) === canonicalJson(OVERVIEW_V3_WIDGETS), "the v3 Overview is not the frozen one");
  const sld = v3.tabs.find((tab) => tab.key === "sld");
  assert(sld?.mimicPreset === "electrical_distribution", `the v3 sld preset: got ${String(sld?.mimicPreset)}`);
  assert(canonicalJson(sld?.widgets) === canonicalJson(SLD_V3_WIDGETS), "the v3 sld widgets are not the frozen ones");
  const v2Sld = smocStandardV2Content().tabs.find((tab) => tab.key === "sld");
  assert(canonicalJson(sld) === canonicalJson(v2Sld), "the v2 electrical tab is not the v3 one");
}

/**
 * The sha256 of {@link canonicalJson} of the frozen v3 Overview's widgets. Equal to the hash of
 * the live entry's Overview at `origin/main` 7bb6283d, stock version 3, the content that shipped:
 * the upgrade's gate compares a stored Overview with this, so an edit to one frozen config or rect
 * would silently stop every v3 copy from moving to v4.
 */
const OVERVIEW_V3_SHA256 = "b92626e2e33f528f64c37ac8018bf4b8469f7b08da40cef840b345ac98b20d98";

/** The frozen v3 Overview is byte for byte, config included, the one stock v3 shipped. */
export function theFrozenV3OverviewHashesAsShipped(): void {
  const digest = createHash("sha256").update(canonicalJson(OVERVIEW_V3_WIDGETS)).digest("hex");
  assert(digest === OVERVIEW_V3_SHA256, `the frozen v3 Overview hashes to ${digest}: it changed since stock v3`);
}

/**
 * The sha256 of {@link canonicalJson} of the five tabs v4 did not touch (`ups`, `hvac`, `it`,
 * `env`, `water`), taken at the v3 → v4 commit. The frozen v3 reuses those tabs from the live
 * entry, so only a hash can say an edit to one is not a silent change under v3.
 */
const UNCHANGED_TABS_V3_TO_V4_SHA256 = "f2c644c2ed9a4e8d86a21cfb9cdcee976049807770eeb7087af49dce1e561a2a";

/**
 * Which tabs differ between the frozen v3 and the live v4: the Overview and `sld`, no other. The
 * other five are compared by hash, since the frozen v3 borrows them from the live entry.
 */
export function onlyTheElectricalTabChangedBetweenV3AndV4(): void {
  const v3 = smocStandardV3Content();
  const untouched = current.tabs.filter((tab) => tab.key !== OVERVIEW_TAB_KEY && tab.key !== "sld");
  const digest = createHash("sha256").update(canonicalJson(untouched)).digest("hex");
  assert(digest === UNCHANGED_TABS_V3_TO_V4_SHA256, `the five untouched tabs hash to ${digest}: a tab changed since v3`);
  const changed = current.tabs
    .filter((tab) => canonicalJson(tab) !== canonicalJson(v3.tabs.find((old) => old.key === tab.key)))
    .map((tab) => tab.key)
    .join(",");
  assert(changed === "overview,sld", `tabs changed since v3: got ${changed}`);
  assert(v3.tabs.length === current.tabs.length, `v3 holds ${v3.tabs.length} tabs, v4 ${current.tabs.length}`);
}
