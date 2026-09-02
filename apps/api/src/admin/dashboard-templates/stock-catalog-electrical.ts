import type { StockDashboardTemplateDto } from "@bms/shared";

/**
 * The **electrical** stock dashboard templates, and the canvas literals every
 * entry in the catalog is laid out on.
 *
 * ---
 *
 * **WHY THIS FILE EXISTS: `stock-catalog.ts` REACHED THE §4.5 1000-LINE CAP.**
 *
 * It stood at 776 lines and the next entry took it to 1037. AGENTS.md §4.5 caps
 * a file at 1000 lines and reads that one whole-file rather than on added lines,
 * because "a file only crosses it because of the edit in hand". The precedent is
 * `packages/db/src/schema/bms-schema.ts`, split the same way at the same cap.
 *
 * **This move is text only.** No entry, widget, binding, source, grid
 * coordinate or config value changed in the split itself.
 *
 * ---
 *
 * **WHERE THE CUT FALLS, AND WHY IT IS TWO FILES AND NOT THREE.**
 *
 * The catalog is keyed by section × plant shape (ADR 0051 decision 6), so
 * `section` is the only axis a reader already navigates by, and `electrical` is
 * the only section holding more than one entry. Cutting there gives two files
 * that each answer one question — *"what does this section ship?"* — and leaves
 * both with room. Cutting per-section instead would give six or seven files
 * averaging 100 lines, which trades one over-long file for a directory nobody
 * can read the catalog out of.
 *
 * **THE SHARED CANVAS LITERALS LIVE HERE, AND THAT IS DELIBERATE RATHER THAN
 * CONVENIENT.** They have to live in whichever of the two files is the leaf, or
 * the two modules import each other and the cycle is a real one — `stock-catalog.ts`
 * needs this file's entries to build the array. This file is the leaf, and the
 * literals belong here on their own merits as well: their docblock has always
 * said they describe *"Sheet 04's Electrical screen"*, which is this file.
 *
 * A reader adding a non-electrical entry imports them from here. A reader
 * adding an electrical one writes it below. Neither needs a third module.
 *
 * ---
 *
 * **THE FILE-LEVEL REASONING FOR THE CATALOG AS A WHOLE STAYS IN
 * `stock-catalog.ts`** — why it is a TypeScript module rather than JSON, why
 * each entry carries its own `stockVersion`, why it must never import from
 * `packages/db`, and why the codes are a literal list in the spec. Those are
 * properties of the catalog, not of the electrical half, and duplicating them
 * here would create the second copy that drifts.
 */

// ---------------------------------------------------------------------------
// Shared literals — read, never restated as a bare number beside a grid field.
// Exported for `stock-catalog.ts`'s five non-electrical entries.
// ---------------------------------------------------------------------------

/** Row of five KPI tiles, then one chart and one table below it — Sheet 04's
 * Electrical screen, "the same canvas bound to a different asset group". */
export const TILE_ROW_Y = 0;
export const TILE_W = 2;
export const TILE_H = 4;
export const BELOW_TILES_Y = TILE_H;
export const HALF_CANVAS_W = 6;
export const LOWER_ROW_H = 8;

export const ELECTRICAL_STOCK_TEMPLATES = [
  // -------------------------------------------------------------------------
  // Electrical — incoming supply, transformers, HT/LT panels, MCCs, utilities.
  // -------------------------------------------------------------------------
  {
    code: "electrical-overview",
    name: "Electrical Overview",
    section: "electrical",
    description:
      "Incoming supply, transformers, HT/LT panels and MCCs, the same canvas Sheet 02 draws " +
      "for the Electrical train.",
    stockVersion: 1,
    content: {
      widgets: [
        {
          key: "alarms-tile",
          title: "Active Alarms",
          gridX: 0,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [],
          sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
          widgetType: "value_tile",
          config: { icon: "alert" },
        },
        {
          key: "workorders-tile",
          title: "Open Work Orders",
          gridX: 2,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [],
          sources: [{ catalogKey: "workorders.open.count", params: {}, sortOrder: 0 }],
          widgetType: "value_tile",
          config: { icon: "clipboard" },
        },
        {
          key: "health-tile",
          title: "Health Score",
          gridX: 4,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [],
          sources: [{ catalogKey: "assets.health.score", params: {}, sortOrder: 0 }],
          widgetType: "value_tile",
          config: { icon: "gauge" },
        },
        {
          key: "incoming-tile",
          title: "Incoming Supply",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "incoming-supply", pointKey: "kw", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "kW" },
        },
        {
          key: "transformer-tile",
          title: "Transformer Load",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          // `F3.38`: this bound `loadPercent`, which existed in no vocabulary.
          // The nearest real code is `load_pct`, but it belongs to
          // `CONTROL_ROOM_UPS_POINT_KEYS` and no seeded electrical asset
          // registers it — renaming to it would have moved the key into the
          // vocabulary and left the widget resolving nothing, which is the same
          // empty tile with a better-looking diff. `kw` is what every seeded
          // electrical asset actually carries, so the tile reads a load in kW.
          // The unit moved with the key: a kW value under a `%` label is wrong
          // in the one way nothing reports.
          bindings: [
            {
              assetRoleCode: "transformer",
              pointKey: "kw",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "kW" },
        },
        // `ht-panel` is one of `0051`'s own named plural nodes ("HT Panels 2 ·
        // all good"), so this is the multi-match case stated rather than left
        // to a fixture: one authored binding, many members resolved at
        // instantiation. `pointRole: "series"` because a chart plots a value
        // over time per matched member, the renderer's "series" slot.
        {
          key: "ht-panel-chart",
          title: "HT Panel Load",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            { assetRoleCode: "ht-panel", pointKey: "kw", pointRole: "series", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440, footerStats: true },
        },
        {
          key: "alarms-table",
          title: "Active Alarms",
          gridX: HALF_CANVAS_W,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [],
          sources: [{ catalogKey: "alarms.active", params: {}, sortOrder: 0 }],
          widgetType: "table",
          config: {},
        },
      ],
    },
  },
] as const satisfies readonly StockDashboardTemplateDto[];
