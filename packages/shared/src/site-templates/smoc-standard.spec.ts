import { MAX_DASHBOARD_WIDGETS } from "../contracts/dashboard-builder";
import { mimicPresetSchema } from "../contracts/mimic-config";
import {
  sectionTemplateContentSchema,
  stockDashboardTemplateDtoSchema,
  templateTargetContentMessage,
} from "../contracts/dashboard-templates";
import type { StockDashboardTemplateDto } from "../index";
import { SMOC_STANDARD_SITE_TEMPLATE } from "./smoc-standard";

/**
 * `F3.73` plan D8 — the SMOC standard site layout. Assertions live here; `smoc-standard.test.ts`
 * is the Vitest entry point (ADR 0014). One claim per exported function.
 *
 * The role and point-key vocabularies are NOT checked here: `stock-catalog.spec.ts` and
 * `tests/f3.38-stock-catalog-vocabulary.test.ts` read them out of the migrations and the
 * `*_POINT_KEYS` arrays, and both walk this entry's tab widgets.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Widened to the contract type, so a tab without an optional key reads as `undefined`.
const entry: StockDashboardTemplateDto = SMOC_STANDARD_SITE_TEMPLATE;

export function theEntryIsTheSiteTargetStockRow(): void {
  const shape = `${entry.code}|${entry.section}|${entry.target}|${entry.stockVersion}`;
  assert(shape === "smoc-standard|site|site|2", `code|section|target|stockVersion: got ${shape}`);
}

/** Stock version 2 — each widget's height fits its content at the view canvas's 64 px row; the widths are v1's. */
const COMPACT_SIZE: Readonly<Record<string, string>> = {
  state_legend: "12x2",
  value_tile: "3x2",
  asset_class_strip: "12x2",
  module_summary_card: "2x3",
  mimic: "12x7",
  active_alarms_rail: "6x5",
  table: "6x5",
  critical_systems_list: "6x5",
};

export function everyWidgetHasItsCompactSize(): void {
  for (const tab of entry.content.tabs) {
    for (const widget of tab.widgets) {
      const size = `${widget.gridW}x${widget.gridH}`;
      assert(
        size === COMPACT_SIZE[widget.widgetType],
        `${tab.key}/${widget.key} is ${size}, wanted ${COMPACT_SIZE[widget.widgetType]}`,
      );
    }
  }
}

/**
 * The fewest rows a widget type needs on the view canvas's 64 px floor row (`VIEW_ROW_MIN_PX` in
 * `apps/web/src/components/dashboards/dashboard-canvas.tsx`), where `n` rows are
 * `64n + 8(n - 1)` px. The legend: `WidgetFrame`'s chrome (`p-3`, the title line, `mb-2`) is
 * about 48.5 px, so 1 row (64 px) leaves the pills about 15 px; 2 rows (136 px) leave about
 * 87 px. A value tile: `KpiTile` with a hint and the ADR 0027 stale line is about 132 px and is
 * not clipped to its cell, so 2 rows (136 px) hold it.
 */
const VIEW_FLOOR_MIN_ROWS: Readonly<Record<string, number>> = {
  state_legend: 2,
  value_tile: 2,
};

export function everyWidgetFitsTheViewCanvasFloorRow(): void {
  for (const tab of entry.content.tabs) {
    for (const widget of tab.widgets) {
      const min = VIEW_FLOOR_MIN_ROWS[widget.widgetType] ?? 1;
      assert(widget.gridH >= min, `${tab.key}/${widget.key} is ${widget.gridH} rows, under the ${min} it needs at 64 px`);
    }
  }
}

export function noTwoWidgetsInATabOverlap(): void {
  for (const tab of entry.content.tabs) {
    for (const [i, a] of tab.widgets.entries()) {
      for (const b of tab.widgets.slice(i + 1)) {
        const apart =
          a.gridX + a.gridW <= b.gridX ||
          b.gridX + b.gridW <= a.gridX ||
          a.gridY + a.gridH <= b.gridY ||
          b.gridY + b.gridH <= a.gridY;
        assert(apart, `${tab.key}: ${a.key} overlaps ${b.key}`);
      }
    }
  }
}

/** Every row from 0 to the tab's last is covered by a widget: the compaction left no gap. */
export function noTabLeavesAnEmptyRow(): void {
  for (const tab of entry.content.tabs) {
    const bottom = Math.max(...tab.widgets.map((widget) => widget.gridY + widget.gridH));
    for (let row = 0; row < bottom; row += 1) {
      assert(
        tab.widgets.some((widget) => widget.gridY <= row && row < widget.gridY + widget.gridH),
        `${tab.key}: row ${row} holds no widget`,
      );
    }
  }
}

/** Overview 2 + 2 + 2 + 3 + 5; a domain tab 2 + 7 + 5; UPS (no mimic) 2 + 5. */
export function theTabsTotalTheirCompactRows(): void {
  const totals = entry.content.tabs
    .map((tab) => `${tab.key}:${Math.max(...tab.widgets.map((widget) => widget.gridY + widget.gridH))}`)
    .join(",");
  assert(
    totals === "overview:14,sld:14,ups:7,hvac:14,it:14,env:14,water:14",
    `rows per tab: got ${totals}`,
  );
}

export function theEntryParsesUnderTheStockContract(): void {
  const parsed = stockDashboardTemplateDtoSchema.safeParse(entry);
  assert(parsed.success, `stockDashboardTemplateDtoSchema refused it: ${JSON.stringify(parsed.error?.issues)}`);
}

export function theContentParsesUnderTheContentSchema(): void {
  const parsed = sectionTemplateContentSchema.safeParse(entry.content);
  assert(parsed.success, `sectionTemplateContentSchema refused it: ${JSON.stringify(parsed.error?.issues)}`);
}

export function theContentFitsTheSiteTarget(): void {
  const message = templateTargetContentMessage(entry.target, entry.content);
  assert(message === null, `the target rule refused it: ${message}`);
}

export function theTabsAreThePlanOrder(): void {
  const keys = entry.content.tabs.map((tab) => `${tab.key}:${tab.domain ?? "null"}`).join(",");
  assert(
    keys ===
      "overview:null,sld:electrical,ups:electrical,hvac:hvac,it:it,env:environment,water:water",
    `tabs in order: got ${keys}`,
  );
}

export function everyTabPresetIsAPresetOption(): void {
  const options = new Set<string>(mimicPresetSchema.options);
  for (const tab of entry.content.tabs) {
    if (tab.mimicPreset !== undefined) {
      assert(options.has(tab.mimicPreset), `tab ${tab.key} names preset ${tab.mimicPreset}`);
    }
  }
}

/** A tab's mimic draws the tab's own preset, and a tab with no preset draws no mimic. */
export function everyMimicDrawsItsTabsPreset(): void {
  for (const tab of entry.content.tabs) {
    const drawn = tab.widgets.flatMap((widget) =>
      widget.widgetType === "mimic" && widget.config.source === "preset" ? [widget.config.preset] : [],
    );
    const expected = tab.mimicPreset === undefined ? [] : [tab.mimicPreset];
    assert(
      drawn.join(",") === expected.join(","),
      `tab ${tab.key}: mimics draw [${drawn.join(",")}], the tab names [${expected.join(",")}]`,
    );
  }
}

export function everyModuleCardNamesATab(): void {
  const keys = new Set(entry.content.tabs.map((tab) => tab.key));
  for (const tab of entry.content.tabs) {
    for (const widget of tab.widgets) {
      if (widget.widgetType === "module_summary_card") {
        assert(
          keys.has(widget.config.targetTabKey),
          `${tab.key}/${widget.key} targets ${widget.config.targetTabKey}, which is no tab`,
        );
      }
    }
  }
}

/** One card per group tab on the Overview, in tab order — ruling Q6b. */
export function theOverviewHasOneCardPerGroupTab(): void {
  const [overview, ...groupTabs] = entry.content.tabs;
  const cards = (overview?.widgets ?? []).flatMap((widget) =>
    widget.widgetType === "module_summary_card" ? [widget.config.targetTabKey] : [],
  );
  const expected = groupTabs.map((tab) => tab.key);
  assert(cards.join(",") === expected.join(","), `Overview cards: got ${cards.join(",")}`);
}

export function noTabHoldsMoreThanTheWidgetCap(): void {
  for (const tab of entry.content.tabs) {
    assert(
      tab.widgets.length <= MAX_DASHBOARD_WIDGETS,
      `tab ${tab.key} holds ${tab.widgets.length} widgets, over ${MAX_DASHBOARD_WIDGETS}`,
    );
  }
}

/**
 * ADR 0049 decision 4 — stock content names roles, never an asset. `CR-` is the control-room
 * asset-code prefix the seeds use. This reads the VALUE; the file's text, docblocks included, is
 * scanned by `tests/f3.38-stock-catalog-vocabulary.test.ts`, which reads it as text already.
 */
export function theValueNamesNoControlRoomAssetCode(): void {
  assert(!JSON.stringify(entry).includes("CR-"), "the entry's value spells an asset code");
}
