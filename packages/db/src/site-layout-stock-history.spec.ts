import { createHash } from "node:crypto";

import { type SectionTemplateContent, sectionTemplateContentSchema } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  canonicalJson,
  OVERVIEW_TAB_KEY,
  OVERVIEW_V2_WIDGETS,
  SMOC_STANDARD_V1_RECTS,
  SMOC_STANDARD_V2_DOMAIN_TABS_SHA256,
  SMOC_STANDARD_V2_RECTS,
  siteTemplateRects,
  siteWidgetIdentity,
  smocStandardV1Content,
  smocStandardV2Content,
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
 * Every tab but the Overview is the one stock v2 shipped: the hash was taken from the v2 source
 * (`smoc-standard.ts` at `b21eadad`), so an edit to a domain tab is a stock version bump that
 * needs its own frozen history here, not a silent change under the v2 snapshot.
 */
export function everyDomainTabIsUnchangedFromV2(): void {
  const domainTabs = current.tabs.filter((tab) => tab.key !== OVERVIEW_TAB_KEY);
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

/** The v2 content is a valid site template: the current tabs with the v2 Overview in place. */
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
