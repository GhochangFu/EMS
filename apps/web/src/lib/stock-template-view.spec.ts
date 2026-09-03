/**
 * The stock catalog entry as a read-only template view (`F2.14`, ADR 0052
 * decisions 1 and 10).
 *
 * The fixture is parsed through `stockAssetTemplateDtoSchema` so it is a real
 * `StockAssetTemplateDto` and not a hand-typed lookalike; the adapter's output
 * is parsed through `adminAssetTemplateDtoSchema` for the same reason in the
 * other direction. Between those two parses sits the one property this module
 * exists to hold: the synthetic `status` must read as **not editable**, or the
 * Calculations and KPIs formula editors render writable in a screen that has
 * no save control.
 */
import {
  adminAssetTemplateDtoSchema,
  stockAssetTemplateDtoSchema,
} from "@bms/shared/contracts";
import type { StockAssetTemplateDto } from "@bms/shared";

import { capabilities, formulaFieldsAreReadOnly } from "./template-lifecycle";
import { pointRowsFrom } from "./template-points-grid";
import {
  STOCK_VIEW_TEMPLATE_ID,
  findStockEntry,
  stockEntryAsTemplate,
} from "./stock-template-view";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A small entry with every branch the adapter has to cross: a point carrying
 * `meta`, a point with `meta` absent, a derived point with a formula, a
 * `null` description, and `content` with both alarms and KPIs.
 */
const ENTRY: StockAssetTemplateDto = stockAssetTemplateDtoSchema.parse({
  code: "electrical-feeder",
  name: "Feeder / incomer — multifunction energy meter",
  assetType: "feeder",
  domain: "electrical",
  description: null,
  stockVersion: 3,
  content: {
    contentVersion: 1,
    alarms: [{ code: "OVERCURRENT", severity: "warning" }],
    kpis: [{ key: "load_factor", formula: "{kw} / {kva}" }],
  },
  points: [
    {
      pointKey: "kw",
      label: "Active power",
      unit: "kW",
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      kind: "measured",
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 0,
      meta: { tier: "extended" },
    },
    {
      pointKey: "kva",
      label: "Apparent power",
      unit: "kVA",
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      kind: "measured",
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: false,
      sortOrder: 1,
      // `meta` deliberately absent — the branch the bridge has to close.
    },
    {
      pointKey: "power_factor",
      label: "Power factor",
      unit: null,
      sourceDataKeyPattern: null,
      formula: "{kw} / {kva}",
      formulaDialect: "bms-calc-v1",
      kind: "derived",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: 300,
      required: false,
      sortOrder: 2,
      meta: { tier: "core" },
    },
  ],
});

const CATALOG: readonly StockAssetTemplateDto[] = [
  ENTRY,
  stockAssetTemplateDtoSchema.parse({
    ...ENTRY,
    code: "electrical-transformer",
    name: "Transformer",
    assetType: "transformer",
  }),
];

/**
 * 1. The synthetic status reads as read-only — derived through the same two
 * functions the tabs call, never as a literal. `expect(status).toBe("published")`
 * would restate the constant and catch nothing the constant does not already
 * say; what matters is what `template-lifecycle.ts` answers for it.
 */
export function runStatusIsReadOnlyTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  assert(
    capabilities(view.status).editable === false,
    `status "${view.status}" is editable — every tab's inputs would accept edits in the read-only viewer`,
  );
  assert(
    formulaFieldsAreReadOnly(view.status),
    `status "${view.status}" is not formula-read-only — the Calculations and KPIs formula editors render writable in the read-only viewer`,
  );
}

/**
 * 2. The output is a real `AdminAssetTemplateDto` at runtime, not only by
 * annotation. This is what fails the day the DTO gains a field the adapter
 * does not stamp.
 */
export function runParsesAsAdminTemplateTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  try {
    adminAssetTemplateDtoSchema.parse(view);
  } catch (cause) {
    throw new Error(
      `stockEntryAsTemplate() does not produce a valid AdminAssetTemplateDto — a tab reading the missing field would crash: ${String(
        cause,
      )}`,
    );
  }
}

/** 3. Content and points survive by value, position for position. */
export function runContentAndPointsSurviveTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  assert(
    JSON.stringify(view.content) === JSON.stringify(ENTRY.content),
    "content must reach the tabs unchanged — alarms, KPIs and philosophy all live in it",
  );
  assert(
    view.points.length === ENTRY.points.length,
    `expected ${ENTRY.points.length} points, got ${view.points.length}`,
  );
  for (const [index, point] of ENTRY.points.entries()) {
    const mapped = view.points[index];
    assert(mapped !== undefined, `point ${index} is missing from the view`);
    assert(
      mapped.pointKey === point.pointKey,
      `point ${index}: pointKey ${mapped.pointKey} !== ${point.pointKey}`,
    );
    assert(mapped.formula === point.formula, `point ${index}: formula changed`);
    assert(mapped.kind === point.kind, `point ${index}: kind changed`);
    assert(mapped.required === point.required, `point ${index}: required changed`);
    assert(mapped.sortOrder === point.sortOrder, `point ${index}: sortOrder changed`);
  }
}

/**
 * 4. The `meta` bridge, both branches. The stock shape is `{ tier } |
 * undefined`; the admin shape is `{ tier? } | null`. A present tier survives;
 * an absent `meta` becomes `null`, which `pointRowsFrom` — the Points tab's
 * seed — reads without throwing.
 */
export function runMetaBridgeTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  const withTier = view.points[0];
  const withoutMeta = view.points[1];
  assert(withTier !== undefined && withoutMeta !== undefined, "fixture needs two points");
  assert(
    withTier.meta !== null && withTier.meta.tier === "extended",
    `a point with meta.tier "extended" must keep it — got ${JSON.stringify(withTier.meta)}`,
  );
  assert(
    withoutMeta.meta === null,
    `a point with no meta must map to null, not ${JSON.stringify(withoutMeta.meta)} — the admin DTO is nullable, never optional`,
  );

  const rows = pointRowsFrom(view);
  assert(rows.length === ENTRY.points.length, "pointRowsFrom must seed every point");
  assert(rows[1]?.meta === null, "pointRowsFrom must read the bridged null meta as null");
  assert(rows[0]?.meta?.tier === "extended", "pointRowsFrom must read the bridged tier through");
}

/** 5. A `null` description stays `null` — the Details tab renders `""` for it itself. */
export function runNullDescriptionSurvivesTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  assert(
    view.description === null,
    `description null must survive as null, got ${JSON.stringify(view.description)}`,
  );
  const described = stockEntryAsTemplate({ ...ENTRY, description: "Authored from the tag list." });
  assert(
    described.description === "Authored from the tag list.",
    "a string description must pass through",
  );
}

/**
 * 6. The id is the sentinel, and the sentinel is not a uuid. The shape is the
 * one the API's `idParamSchema` accepts — a "tidy-up" that makes the sentinel
 * look like a real id fails here before it can reach a request.
 */
export function runSentinelIdTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  assert(view.id === STOCK_VIEW_TEMPLATE_ID, `view.id must be the sentinel, got ${view.id}`);
  assert(
    !/^[0-9a-f]{8}-/i.test(STOCK_VIEW_TEMPLATE_ID),
    `STOCK_VIEW_TEMPLATE_ID "${STOCK_VIEW_TEMPLATE_ID}" looks like a uuid — a stray request would reach the API as a real template id`,
  );
  for (const point of view.points) {
    assert(
      point.templateId === STOCK_VIEW_TEMPLATE_ID,
      `point ${point.pointKey} must carry the sentinel templateId`,
    );
  }
}

/**
 * 7. `version` is `0` and `stockVersion` carries the real number. A catalog
 * entry is not a row and has no row version; ADR 0052's two-stamps-two-reasons
 * note forbids conflating the two.
 */
export function runVersionIsZeroTests(): void {
  const view = stockEntryAsTemplate(ENTRY);
  assert(
    view.version === 0,
    `version must be 0 — a catalog entry has no row version; ${view.version} conflates it with stockVersion`,
  );
  assert(
    view.stockVersion === ENTRY.stockVersion,
    `stockVersion must carry the catalog's ${ENTRY.stockVersion}, got ${view.stockVersion}`,
  );
  assert(view.stockCode === ENTRY.code, "stockCode must name the catalog entry");
}

/** 8. `findStockEntry` — present, absent, and an empty list. */
export function runFindStockEntryTests(): void {
  const found = findStockEntry(CATALOG, "electrical-feeder");
  assert(found === ENTRY, "findStockEntry must return the entry with that code");
  assert(
    findStockEntry(CATALOG, "nope") === undefined,
    "an unknown code must resolve to undefined, not throw",
  );
  assert(findStockEntry([], "electrical-feeder") === undefined, "an empty list finds nothing");
}
