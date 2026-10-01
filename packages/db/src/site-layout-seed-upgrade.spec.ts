import type { SectionTemplateContent } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  type CopyWidget,
  type GridRect,
  isSeedV1SiteTemplate,
  planCopyWidgetUpgrade,
  SITE_LAYOUT_COPY_DESCRIPTION,
  SITE_LAYOUT_COPY_DESCRIPTION_V1,
  SMOC_STANDARD_CURRENT_RECTS,
  SMOC_STANDARD_V1_RECTS,
  type SiteTemplateRow,
  siteWidgetIdentity,
  smocStandardV1Content,
  upgradedCopyDescription,
} from "./site-layout-seed-upgrade";

/**
 * The SMOC standard site layout's v1 → v2 seed upgrade — the pure decisions. Assertions live
 * here; `site-layout-seed-upgrade.test.ts` is the Vitest entry point (ADR 0014). The database
 * half is `tests/f3.73-site-layout-seed.integration.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const content = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;

/** Every widget of tab `tabKey`, as a copy stores it, at the rects of `rects`. */
function copyTab(tabKey: string, rects: ReadonlyMap<string, GridRect>): CopyWidget[] {
  const tab = content.tabs.find((candidate) => candidate.key === tabKey);
  assert(tab !== undefined, `no tab ${tabKey}`);
  return (tab?.widgets ?? []).map((widget) => {
    const rect = rects.get(siteWidgetIdentity(tabKey, widget.widgetType, widget.title));
    assert(rect !== undefined, `no rect for ${tabKey}/${widget.key}`);
    return {
      id: `${tabKey}/${widget.key}`,
      tabKey,
      widgetType: widget.widgetType,
      title: widget.title,
      gridX: rect?.gridX ?? -1,
      gridY: rect?.gridY ?? -1,
      gridW: rect?.gridW ?? -1,
      gridH: rect?.gridH ?? -1,
    };
  });
}

function seedV1Row(overrides: Partial<SiteTemplateRow> = {}): SiteTemplateRow {
  return {
    id: "t1",
    version: 1,
    status: "published",
    stockVersion: 1,
    createdBy: null,
    content: smocStandardV1Content(),
    ...overrides,
  };
}

export function theV1DescriptionIsReplaced(): void {
  const next = upgradedCopyDescription(SITE_LAYOUT_COPY_DESCRIPTION_V1);
  assert(next === SITE_LAYOUT_COPY_DESCRIPTION, `got ${String(next)}`);
}

export function anEditedDescriptionIsKept(): void {
  const edited = upgradedCopyDescription(`${SITE_LAYOUT_COPY_DESCRIPTION_V1} `);
  const empty = upgradedCopyDescription(null);
  assert(edited === null && empty === null, `edited → ${String(edited)}, null → ${String(empty)}`);
}

export function theNewDescriptionNamesNoRowSeedOrDemo(): void {
  assert(!/F3\.73|seed|demo/i.test(SITE_LAYOUT_COPY_DESCRIPTION), SITE_LAYOUT_COPY_DESCRIPTION);
}

/** The copy's matching key is unique per tab: one identity per template widget. */
export function everyTemplateWidgetHasItsOwnIdentity(): void {
  const widgets = content.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0);
  assert(SMOC_STANDARD_CURRENT_RECTS.size === widgets, `${SMOC_STANDARD_CURRENT_RECTS.size} identities, ${widgets} widgets`);
}

export function theV1TableNamesExactlyTheTemplateWidgets(): void {
  const v1 = [...SMOC_STANDARD_V1_RECTS.keys()].sort().join(",");
  const current = [...SMOC_STANDARD_CURRENT_RECTS.keys()].sort().join(",");
  assert(v1 === current, `v1 table: ${v1}\ntemplate: ${current}`);
}

export function aTabAtItsV1RectsMovesToV2(): void {
  const moves = planCopyWidgetUpgrade(copyTab("ups", SMOC_STANDARD_V1_RECTS));
  const got = moves.map((move) => `${move.id}@${move.to.gridX},${move.to.gridY},${move.to.gridW},${move.to.gridH}`);
  assert(
    got.join(";") ===
      "ups/ups-load-tile@0,0,3,2;ups/ups-backup-tile@3,0,3,2;ups/ups-alarms-rail@0,2,6,5;ups/ups-assets-table@6,2,6,5",
    `moves: ${got.join(";")}`,
  );
}

/** One moved widget keeps its whole tab, and another tab still moves. */
export function aMovedWidgetKeepsItsTab(): void {
  const sld = copyTab("sld", SMOC_STANDARD_V1_RECTS).map((widget) =>
    widget.widgetType === "active_alarms_rail" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const moves = planCopyWidgetUpgrade([...sld, ...copyTab("ups", SMOC_STANDARD_V1_RECTS)]);
  const tabs = [...new Set(moves.map((move) => move.id.split("/")[0]))].join(",");
  assert(tabs === "ups", `tabs moved: ${tabs}`);
}

export function aWidgetTheTemplateDoesNotHoldKeepsItsTab(): void {
  const extra: CopyWidget = { id: "hvac/extra", tabKey: "hvac", widgetType: "table", title: "Mine", gridX: 0, gridY: 30, gridW: 6, gridH: 5 };
  const moves = planCopyWidgetUpgrade([...copyTab("hvac", SMOC_STANDARD_V1_RECTS), extra]);
  assert(moves.length === 0, `moves: ${moves.map((move) => move.id).join(",")}`);
  assert(planCopyWidgetUpgrade(copyTab("hvac", SMOC_STANDARD_V1_RECTS)).length === 6, "the unedited hvac tab moves 6");
}

export function aTabAlreadyAtV2WritesNothing(): void {
  const moves = planCopyWidgetUpgrade(copyTab("overview", SMOC_STANDARD_CURRENT_RECTS));
  assert(moves.length === 0, `moves: ${moves.map((move) => move.id).join(",")}`);
}

export function theSeedsV1TemplateRowIsSuperseded(): void {
  assert(isSeedV1SiteTemplate(seedV1Row()), "the seed's v1 row is not recognised");
}

export function aTemplateRowTheSeedDoesNotOwnIsKept(): void {
  const cases: [string, SiteTemplateRow | undefined][] = [
    ["absent", undefined],
    ["an author", seedV1Row({ createdBy: "u1" })],
    ["version 2", seedV1Row({ version: 2 })],
    ["a draft", seedV1Row({ status: "draft" })],
    ["stock 2", seedV1Row({ stockVersion: 2 })],
    ["v2 content", seedV1Row({ content })],
  ];
  for (const [label, row] of cases) {
    assert(!isSeedV1SiteTemplate(row), `${label} was taken for the seed's v1 row`);
  }
  assert(isSeedV1SiteTemplate(seedV1Row()), "the seed's v1 row is not recognised");
}
