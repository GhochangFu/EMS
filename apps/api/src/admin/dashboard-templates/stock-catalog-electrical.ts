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
/**
 * A third row, used by `electrical-metered-pumping` alone — derived from the
 * two literals above rather than written as `12`, so it moves if either does.
 *
 * `0050`'s `dashboard_widgets_grid_bounds_check` bounds `grid_x + grid_w` and
 * `grid_h` and puts **no ceiling on `grid_y`**, so a third row is legal. Read
 * out of the migration rather than assumed from the other entries all fitting
 * in two rows.
 *
 * Not exported: no non-electrical entry uses a third row today, and exporting
 * an unused symbol would trip `noUnusedLocals` nowhere and simply mislead.
 */
const THIRD_ROW_Y = BELOW_TILES_Y + LOWER_ROW_H;

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

  // -------------------------------------------------------------------------
  // Electrical, second shape — a metered pumping station: meters and pumps,
  // no substation train. ADR 0051 decision 6.
  // -------------------------------------------------------------------------
  /**
   * `F3.41` — the catalog's first **second entry for one section**, and that is
   * the feature rather than a duplicate.
   *
   * **THE PLANT SHAPE THIS SERVES.** `electrical-overview` above draws a
   * substation train: an 11 kV incomer, a 100 kVA transformer, HT and LT panels,
   * MCCs. PHE WB's six village pumping stations hold none of those. Each carries
   * two multifunction meters (`PHE-MFM-*`) and four pumps — two mains
   * (`PHE-PUMP-M-*`) and two chlorine dosing (`PHE-PUMP-C-*`). "Electrical" at a
   * substation and "electrical" at a village pumping station are different
   * trains, not different clients, which is ADR 0051 decision 6 in one line:
   * *"A new shape is a catalog entry, not a per-tenant fork."*
   *
   * Decision 7 keeps the per-tenant import copy (`F3.36`) as the escape hatch
   * for a genuinely unique site. It is **not** the answer to a shape that
   * recurs — the ADR's own test is that if the same edit is made twice for the
   * same reason, the reason is a shape and belongs here.
   *
   * ---
   *
   * **WHY BOTH BINARY PUMP POINTS ARE ON CHARTS, AND ON TWO CHARTS.**
   *
   * The owner's 2026-09-02 ruling gives both pump shapes the single `pump`
   * role (`asset-groups-seed.ts` carries it and the reason). So one `pump`
   * binding matches **four** members per site carrying two **disjoint** point
   * sets: `PHE-PUMP-M-*` registers only `breaker_main`, `PHE-PUMP-C-*` only
   * `chlorine_pump_on`. Every binding here therefore resolves on half of what
   * it matches, by construction.
   *
   * That is a reported state, not a silent one — but **which** state gets
   * reported depends on the widget, and `outcomeOf` in
   * `dashboard-templates-instantiate.service.ts` is why. It tests `truncated`
   * **before** `partial`:
   *
   *  - a cap-1 `value_tile` gives matched 4, candidates 2, bound 1, so `1 < 2`
   *    fires first and the report says **`truncated`**, whose stated remedy is
   *    *"the widget cannot hold them all — use another widget"*. That is false
   *    here. The widget holds them fine; two members carry no such point;
   *
   *  - a `chart` (cap 8) gives matched 4, bound 2, so it reports **`partial`**,
   *    and the two numbers show the size of the gap as well as its existence.
   *
   * **Two charts and not one** for the same reason one step further: a single
   * chart binding both keys reports matched 4 / bound 4 / `partial`, where the
   * counts read as complete and only the outcome word disagrees.
   *
   * ---
   *
   * **THE THREE METER TILES REPORT `truncated`, AND THAT IS CORRECT.** Two
   * meters cannot fit a cap-1 tile, so the report says so, and the remedy it
   * names — another widget — is exactly what `meter-current-chart` below is.
   * `water-overview`'s `pump-house-tile` already does this against a role
   * `0051` itself names as plural. Amber here is a correct report, not a defect
   * to design around.
   *
   * ---
   *
   * **NO `unit` ON A BINARY, AND NONE ON THE POWER FACTOR.** `breaker_main` and
   * `chlorine_pump_on` are on/off — the vendor's `UnitCode` is `NA`,
   * `unitLabel()` returns null and `UNIT_BY_KEY` spells both `""` — and `pf` is
   * dimensionless. `commonConfigFields.unit` is optional, so leaving it off is
   * the contract's own answer rather than a workaround. A unit on a binary is
   * precisely the silent-wrong class `tests/f3.38-stock-catalog-vocabulary.test.ts`
   * ends its file checking for.
   *
   * **`widgetIconSchema` HOLDS NO PUMP ICON AND IS NOT EXTENDED.** Electrical
   * readings take `bolt`; the dimensionless power factor takes `gauge`; the
   * charts carry no icon at all.
   */
  {
    code: "electrical-metered-pumping",
    name: "Electrical — Metered Pumping",
    section: "electrical",
    description:
      "A metered pumping station: multifunction meters and mains/dosing pumps, the shape a " +
      "village water supply runs rather than a substation train.",
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
        // The three meter tiles. `kw`, `voltage_l1_v` and `pf` are the three
        // readings a pumping station is actually operated on, and all three are
        // codes the MFM registers today — `TKW`, `APV` and `APF` in the vendor
        // catalog. Not `kwh_total`: a lifetime energy total is a report, not a
        // live tile.
        {
          key: "meter-kw-tile",
          title: "Metered Load",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "meter", pointKey: "kw", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "kW" },
        },
        {
          key: "meter-voltage-tile",
          title: "Phase Voltage",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            {
              assetRoleCode: "meter",
              pointKey: "voltage_l1_v",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "V" },
        },
        // Six tiles across the 12-column canvas fills the `x = 10` slot the
        // other six entries leave empty. This entry's own reading, not a style
        // change to them.
        {
          key: "meter-pf-tile",
          title: "Power Factor",
          gridX: 10,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "meter", pointKey: "pf", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "gauge" },
        },
        // The remedy `truncated` names for the three tiles above, made concrete:
        // three series over both matched meters, so nothing is dropped. `chart`
        // allows up to `MAX_WIDGET_POINTS` bindings, and three is well inside
        // it.
        {
          key: "meter-current-chart",
          title: "Phase Currents",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            { assetRoleCode: "meter", pointKey: "current_ir", pointRole: "series", sortOrder: 0 },
            { assetRoleCode: "meter", pointKey: "current_iy", pointRole: "series", sortOrder: 1 },
            { assetRoleCode: "meter", pointKey: "current_ib", pointRole: "series", sortOrder: 2 },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440, footerStats: true, unit: "A" },
        },
        // The two `pump` charts. One binding each, and charts rather than tiles
        // — see this entry's docblock for the `outcomeOf` ordering that decides
        // it. Expect `partial` at 4 matched / 2 bound on both, per site.
        {
          key: "pump-run-chart",
          title: "Pump Run State",
          gridX: HALF_CANVAS_W,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            {
              assetRoleCode: "pump",
              pointKey: "breaker_main",
              pointRole: "series",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440 },
        },
        {
          key: "dosing-run-chart",
          title: "Chlorine Dosing State",
          gridX: 0,
          gridY: THIRD_ROW_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            {
              assetRoleCode: "pump",
              pointKey: "chlorine_pump_on",
              pointRole: "series",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440 },
        },
        {
          key: "alarms-table",
          title: "Active Alarms",
          gridX: HALF_CANVAS_W,
          gridY: THIRD_ROW_Y,
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
