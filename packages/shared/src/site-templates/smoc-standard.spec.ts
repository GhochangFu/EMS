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
  assert(shape === "smoc-standard|site|site|3", `code|section|target|stockVersion: got ${shape}`);
}

/**
 * Stock version 3 (`F3.77` plan D1) — the Overview, `key@x,y,w,h` in grid order: four problem
 * tiles, the 8-wide alarm rail beside the 4-wide systems list, the class strip, then the 1-row
 * legend. One size per type no longer holds: the rail is 8x7 here and 6x5 on a domain tab.
 */
const OVERVIEW_RECTS =
  "overview-alarms-tile@0,0,3,2;overview-offline-tile@3,0,3,2;overview-load-tile@6,0,3,2;" +
  "overview-health-tile@9,0,3,2;overview-alarms-rail@0,2,8,7;overview-critical-systems@8,2,4,7;" +
  "overview-class-strip@0,9,12,2;overview-legend@0,11,12,1";

export function theOverviewHoldsItsV3Rects(): void {
  const overview = entry.content.tabs.find((tab) => tab.key === "overview");
  const rects = [...(overview?.widgets ?? [])]
    .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX)
    .map((widget) => `${widget.key}@${widget.gridX},${widget.gridY},${widget.gridW},${widget.gridH}`)
    .join(";");
  assert(rects === OVERVIEW_RECTS, `Overview rects: got ${rects}`);
}

/** Stock version 2 — a domain tab's widget heights fit their content at the 64 px view row; unchanged in v3. */
const DOMAIN_TAB_SIZE: Readonly<Record<string, string>> = {
  value_tile: "3x2",
  mimic: "12x7",
  active_alarms_rail: "6x5",
  table: "6x5",
};

export function everyDomainTabWidgetHasItsCompactSize(): void {
  for (const tab of entry.content.tabs.filter((row) => row.key !== "overview")) {
    for (const widget of tab.widgets) {
      const size = `${widget.gridW}x${widget.gridH}`;
      assert(
        size === DOMAIN_TAB_SIZE[widget.widgetType],
        `${tab.key}/${widget.key} is ${size}, wanted ${DOMAIN_TAB_SIZE[widget.widgetType]}`,
      );
    }
  }
}

/**
 * The fewest rows a widget type needs on the view canvas's 64 px floor row (`VIEW_ROW_MIN_PX` in
 * `apps/web/src/components/dashboards/dashboard-canvas.tsx`), where `n` rows are
 * `64n + 8(n - 1)` px. The legend (`F3.77` plan D2): it draws without `WidgetFrame`, as one row
 * of an inline 11 px title and the pills (`StatusPill` about 20 px), so 1 row (64 px) holds it;
 * the browser layer measures the fit. A value tile: `KpiTile` with a hint and the ADR 0027 stale
 * line is about 132 px and is not clipped to its cell, so 2 rows (136 px) hold it.
 */
const VIEW_FLOOR_MIN_ROWS: Readonly<Record<string, number>> = {
  state_legend: 1,
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

/** Overview 2 + 7 + 2 + 1; a domain tab 2 + 7 + 5; UPS (no mimic) 2 + 5. */
export function theTabsTotalTheirCompactRows(): void {
  const totals = entry.content.tabs
    .map((tab) => `${tab.key}:${Math.max(...tab.widgets.map((widget) => widget.gridY + widget.gridH))}`)
    .join(",");
  assert(
    totals === "overview:12,sld:14,ups:7,hvac:14,it:14,env:14,water:14",
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

/**
 * `F3.77` plan D1 (ADR 0087 Amendment 3; the title stays "Critical systems", owner ruling OQ1) —
 * the v3 Overview holds no module card, and one systems list 4 wide at x8 beside an 8-wide alarm
 * rail, both at y2. `module_summary_card` stays in the vocabulary; only the stock Overview drops it.
 */
export function theOverviewHoldsNoCardAndOneSystemsList(): void {
  const overview = entry.content.tabs.find((tab) => tab.key === "overview")?.widgets ?? [];
  const cards = overview.filter((widget) => widget.widgetType === "module_summary_card");
  assert(cards.length === 0, `the Overview holds ${cards.length} module cards`);
  const lists = overview.filter((widget) => widget.widgetType === "critical_systems_list");
  const list = lists.map((widget) => `${widget.title ?? "null"}@${widget.gridX},${widget.gridY}w${widget.gridW}`).join(";");
  assert(list === "Critical systems@8,2w4", `the Overview systems lists: got ${list}`);
  const rails = overview.filter((widget) => widget.widgetType === "active_alarms_rail");
  const rail = rails.map((widget) => `${widget.gridX},${widget.gridY}w${widget.gridW}`).join(";");
  assert(rail === "0,2w8", `the Overview alarm rails: got ${rail}`);
}

/** `F3.77` (ADR 0087 Amendment 3 ruling 6) — the Offline assets tile draws the `offline` icon. */
export function theOfflineTileUsesTheOfflineIcon(): void {
  const tile = entry.content.tabs
    .find((tab) => tab.key === "overview")
    ?.widgets.find((widget) => widget.key === "overview-offline-tile");
  const icon = tile?.widgetType === "value_tile" ? tile.config.icon : undefined;
  assert(icon === "offline", `the Offline assets tile's icon: got ${String(icon)}`);
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
