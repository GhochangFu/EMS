import type { StockDashboardTemplateDto } from "@bms/shared";

/**
 * `F3.36` Part D — the stock dashboard template catalog (ADR 0049 decision 3).
 *
 * **This is repository data, not a database seed.** ADR 0049 decision 3 fixes
 * only that the catalog lives outside the tenant tables and is *imported*,
 * never seeded per organization and never a NULL-organization row; format and
 * location were this plan's to decide, and they are decided HERE, in this
 * docblock, so a future reader finds the reason beside the file rather than
 * having to reconstruct it from a plan document.
 *
 * ---
 *
 * **WHY A TYPESCRIPT MODULE, NOT JSON, AND NOT `packages/db/src/`.**
 *
 * The nearest existing precedent is `packages/db/src/phe-catalog.json`, and it
 * is the wrong one for this consumer, for three separate reasons rather than
 * one:
 *
 *  1. **The reader is the API, not a seed script.** `phe-catalog.json` is read
 *     with `resolve(process.cwd(), …)`, and `phe-pilot-seed.ts` carries a
 *     two-path `CATALOG_CANDIDATES` fallback that exists BECAUSE a runtime
 *     file read broke on a different cwd. `apps/api` runs from `dist/` inside
 *     a container — a third cwd nobody has tested, and this catalog is read on
 *     every list/import request rather than once at seed time.
 *  2. **A TS module is typechecked.** Exporting it `as const satisfies
 *     readonly StockDashboardTemplateDto[]` makes a malformed default entry a
 *     BUILD error — `pnpm typecheck` refuses it — rather than a 500 the first
 *     time an administrator opens the catalog picker.
 *  3. **The catalog is reviewed like code** (ADR 0049 Consequences). A `.ts`
 *     diff shows a widget config change as a code change, with the same
 *     `git blame` and the same PR review any other logic change gets; a `.json`
 *     diff shows the same change as data and invites the same "just data,
 *     rubber-stamp it" review a `CHECK` constraint gets when it should not.
 *
 * It stays under `apps/api` and NOT `packages/shared`, because the browser
 * reaches the catalog through `GET /admin/dashboard-templates/stock` (this
 * part's sibling unit), never by importing it — so six templates' worth of
 * widget configuration never enters the web bundle.
 *
 * ---
 *
 * **WHY EACH ENTRY CARRIES ITS OWN `stockVersion`, NOT ONE CATALOG CONSTANT.**
 *
 * `stockDashboardTemplateDtoSchema.stockVersion` is a per-entry field, and this
 * file honours that by giving every entry below its own literal `1`, not by
 * spreading one exported `CURRENT_STOCK_VERSION` across all six. Improving the
 * Electrical default to version 2 next quarter must not renumber the other
 * five — that is the property decision 3 exists to provide, and a shared
 * constant would quietly take it away the day someone reached for it out of
 * DRY habit.
 *
 * ---
 *
 * **WHAT THIS FILE DOES NOT DO.** It does not read `bms.dashboard_sections` or
 * `bms.asset_roles`, and it must not gain an import from `packages/db` to do
 * so — this is repository data, checked against the live vocabularies by
 * `stock-catalog.spec.ts` at TEST time (parsing migrations `0051` and `0056`
 * as text) and by the importing service at RUN time (the same
 * `assertAssetRole`/section-lookup boundary every other write path already
 * uses). A compile-time import here would make this module depend on a
 * database connection to load, which a repository constant must never do.
 *
 * **THE SIX CODES ARE A LITERAL LIST IN THE SPEC, DELIBERATELY — THE OPPOSITE
 * CALL FROM `0051`'S OWN HEADER.** `0051` refuses to let its 26 role codes be
 * retyped anywhere outside the migration, because they are ROWS — data a
 * later `INSERT` can add to without a code change, and a copy invites drift
 * against a vocabulary nothing here owns. The six codes below are the
 * opposite: THIS FILE is the six's only source, so asserting them as a
 * literal list in the test is not a copy of a vocabulary — it IS the
 * specification, and a seventh appearing here without the test changing would
 * be exactly the silent addition `0051`'s discipline exists to catch one
 * layer up.
 *
 * **THE ELECTRICAL SINGLE-LINE DIAGRAM IS NOT HERE.** No widget type draws
 * one — that is `F3.32`, a different unit entirely. Do not add a `mimic`
 * widget type by symmetry with the mock's own Electrical screen.
 */

// ---------------------------------------------------------------------------
// Shared literals — read, never restated as a bare number beside a grid field.
// ---------------------------------------------------------------------------

/**
 * **TWO OF THE MOCK'S FOUR WIDGET KINDS ARE NOT USED HERE, AND THAT IS A GAP
 * RATHER THAN A DECISION.**
 *
 * The six entries ship `value_tile`, `chart` and `table`. They ship no
 * `radial_gauge` and no `tank_level`, though the mock draws both explicitly —
 * OHT 72%, EQUALIZE 65% LEVEL, TREATED 68% LEVEL, and Power Factor 0.96 "within
 * target band" — and migration `0051` already seeds the roles they would bind
 * (`oht-tank`, `treated-tank`, `equalization`), all currently unused. Migration
 * `0056`'s own Water description says "tanks".
 *
 * Nothing forces the omission: ADR 0047 and ADR 0048 ship both widget types.
 * Recorded here rather than silently left, because a reader comparing this file
 * to the mock will otherwise assume a constraint that does not exist. Adding a
 * tank to the Water and STP defaults is a content change with its own review,
 * not one to fold into the row that first noticed it. Found by the `F3.36`
 * compliance review.
 *
 * The single-line diagram is a different case and stays out: no widget type
 * draws one, and that is `F3.32`.
 */

/** Row of five KPI tiles, then one chart and one table below it — Sheet 04's
 * Electrical screen, "the same canvas bound to a different asset group". */
const TILE_ROW_Y = 0;
const TILE_W = 2;
const TILE_H = 4;
const BELOW_TILES_Y = TILE_H;
const HALF_CANVAS_W = 6;
const LOWER_ROW_H = 8;

export const STOCK_DASHBOARD_TEMPLATE_CATALOG = [
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
            { assetRoleCode: "incoming-supply", pointKey: "kW", pointRole: "primary", sortOrder: 0 },
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
          bindings: [
            {
              assetRoleCode: "transformer",
              pointKey: "loadPercent",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "%" },
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
            { assetRoleCode: "ht-panel", pointKey: "kW", pointRole: "series", sortOrder: 0 },
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
  // Water — raw intake, pump house, treatment, tanks, distribution.
  // -------------------------------------------------------------------------
  {
    code: "water-overview",
    name: "Water Overview",
    section: "water",
    description: "Raw intake, pump house, treatment, tanks and distribution.",
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
          key: "raw-intake-tile",
          title: "Raw Intake Flow",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "raw-intake", pointKey: "flowRate", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "drop", unit: "m3/h" },
        },
        {
          key: "pump-house-tile",
          title: "Pump House Load",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "pump-house", pointKey: "kW", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "bolt", unit: "kW" },
        },
        // `pump-house` is `0051`'s other named plural node ("Pump House 2 of 3
        // running"). Used above for the tile and here again for the chart —
        // one role, two widgets, the same many-members shape at each.
        {
          key: "pump-house-chart",
          title: "Pump House Output",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            { assetRoleCode: "pump-house", pointKey: "flowRate", pointRole: "series", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440, footerStats: true },
        },
        {
          key: "workorders-table",
          title: "Open Work Orders",
          gridX: HALF_CANVAS_W,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [],
          sources: [{ catalogKey: "workorders.open", params: {}, sortOrder: 0 }],
          widgetType: "table",
          config: {},
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // STP — sewage treatment: screening, aeration, clarifier, disinfection.
  // -------------------------------------------------------------------------
  {
    code: "stp-overview",
    name: "STP Overview",
    section: "stp",
    description: "Inlet screening, equalization, aeration, secondary clarifier and disinfection.",
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
          key: "inlet-screen-tile",
          title: "Inlet Flow",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            {
              assetRoleCode: "inlet-screen",
              pointKey: "flowRate",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "drop", unit: "m3/h" },
        },
        {
          key: "aeration-tile",
          title: "Aeration DO",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            {
              assetRoleCode: "aeration",
              pointKey: "dissolvedOxygen",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "drop", unit: "mg/L" },
        },
        // `aeration` trains commonly run more than one basin per train, the
        // same shape `0051`'s header calls out for HT panels and pump houses
        // — one authored binding, resolved against however many the target
        // asset group's membership actually holds.
        {
          key: "aeration-chart",
          title: "Aeration DO Trend",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            {
              assetRoleCode: "aeration",
              pointKey: "dissolvedOxygen",
              pointRole: "series",
              sortOrder: 0,
            },
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
  // ETP — effluent treatment: neutralization, biological, settling, discharge.
  // -------------------------------------------------------------------------
  {
    code: "etp-overview",
    name: "ETP Overview",
    section: "etp",
    description: "Neutralization, biological treatment, settling and discharge.",
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
          key: "neutralization-tile",
          title: "Neutralization pH",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "neutralization", pointKey: "pH", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "drop" },
        },
        {
          key: "biological-tile",
          title: "Biological COD",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "biological", pointKey: "cod", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "recycle", unit: "mg/L" },
        },
        {
          key: "biological-chart",
          title: "Biological COD Trend",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            { assetRoleCode: "biological", pointKey: "cod", pointRole: "series", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "chart",
          config: { series: "line", windowMinutes: 1440, footerStats: true },
        },
        {
          key: "workorders-table",
          title: "Open Work Orders",
          gridX: HALF_CANVAS_W,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [],
          sources: [{ catalogKey: "workorders.open", params: {}, sortOrder: 0 }],
          widgetType: "table",
          config: {},
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // HVAC — chillers, cooling towers, primary pumps, AHU/FCU, zones.
  // -------------------------------------------------------------------------
  {
    code: "hvac-overview",
    name: "HVAC Overview",
    section: "hvac",
    description: "Chillers, cooling towers, primary pumps, AHU/FCU and zones.",
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
          key: "chiller-tile",
          title: "Chiller Load",
          gridX: 6,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            { assetRoleCode: "chiller", pointKey: "tons", pointRole: "primary", sortOrder: 0 },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "gauge", unit: "TR" },
        },
        {
          key: "ahu-fcu-tile",
          title: "AHU Supply Air",
          gridX: 8,
          gridY: TILE_ROW_Y,
          gridW: TILE_W,
          gridH: TILE_H,
          bindings: [
            {
              assetRoleCode: "ahu-fcu",
              pointKey: "supplyAirTemp",
              pointRole: "primary",
              sortOrder: 0,
            },
          ],
          sources: [],
          widgetType: "value_tile",
          config: { icon: "gauge", unit: "C" },
        },
        // `chiller` is `0051`'s own named plural node ("Chillers 2 of 3 ·
        // 74%") — the multi-match case again, this time on the chart rather
        // than the tile above it.
        {
          key: "chiller-chart",
          title: "Chiller Load Trend",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [
            { assetRoleCode: "chiller", pointKey: "tons", pointRole: "series", sortOrder: 0 },
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
  // Sustainability — energy, water and emissions rollups across the plant.
  //
  // `0051` seeded 26 role codes from the mock's FIVE trains (Electrical,
  // Water, STP, ETP, HVAC). Sustainability is not one of them, and is not
  // going to be: it is a plant-wide rollup screen, not a train with members
  // to bind a role against. Its stock template therefore ships METRIC-CATALOG
  // SOURCES ONLY, AND ZERO ROLE BINDINGS — every widget below has an empty
  // `bindings` array. That is a legitimate shape (`value_tile` may bind a
  // metric instead of a point) and it is recorded here rather than left for
  // the next reader to "complete" by adding `sustainability-*` roles to
  // `bms.asset_roles` — a vocabulary change `0051`'s own header treats as a
  // product decision, not a display tweak, and not this file's to make.
  //
  // No `chart` widget for the same reason: `WIDGET_POINT_CARDINALITY.chart`
  // is `{min: 1, max: MAX_WIDGET_POINTS}` — a chart binds a POINT, always —
  // and there is no role here to bind one against. Two tiles and a table,
  // both catalog-sourced, is what is left once the role-bound half of the
  // shared skeleton is correctly absent.
  // -------------------------------------------------------------------------
  {
    code: "sustainability-overview",
    name: "Sustainability Overview",
    section: "sustainability",
    description: "Energy, water and emissions rollups across the plant.",
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
          key: "workorders-table",
          title: "Open Work Orders",
          gridX: 0,
          gridY: BELOW_TILES_Y,
          gridW: HALF_CANVAS_W,
          gridH: LOWER_ROW_H,
          bindings: [],
          sources: [{ catalogKey: "workorders.open", params: {}, sortOrder: 0 }],
          widgetType: "table",
          config: {},
        },
      ],
    },
  },
] as const satisfies readonly StockDashboardTemplateDto[];
