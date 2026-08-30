import { chartConfigSchema, valueTileConfigSchema } from "@bms/shared";
import type { DashboardDto } from "@bms/shared";

import { buildPutWidgetsPayload, dashboardRowsFromDto } from "./dashboard-builder-form";
import { buildDashboardsPayload, dashboardRowsFrom } from "./template-dashboard-form";

/**
 * `F3.35` Stage A — the builder surface, **both directions**.
 *
 * Assertions live here; `builder-config-round-trip.test.ts` is the vitest entry
 * point (ADR 0014).
 *
 * ## Why a round trip rather than two one-way assertions
 *
 * There are two mappers per authoring surface: one that turns an editable row
 * into a stored config, and one that reads a stored config back into a row. A
 * field present in the first and missing from the second is not merely
 * unauthorable — it is **silently destroyed on every edit-and-resave**. An
 * author opens a configured tile, changes its title, presses Save, and the
 * aggregate, the compare flag, the icon, the sub-line and the tone are gone.
 * No error is raised anywhere: the row simply never carried them, so the
 * payload never wrote them, so the `.strict()` schema never saw a problem.
 *
 * Asserting the forward direction alone passes in exactly that state. The round
 * trip is the only assertion that catches both directions at once, which is why
 * it is expressed as an identity over a config carrying **every** field rather
 * than as a list of field checks that a new field can quietly escape.
 *
 * **`runFixturesCoverEveryContractFieldTests` is what makes "every field" true**
 * (code review). The identity runs over the two hand-written constants below, so
 * a tenth field added to the contract and dropped by a mapper would round-trip
 * vacuously until somebody remembered to extend exactly the list this docblock
 * says needs no remembering. That assertion holds the fixtures equal to the
 * schemas' own key sets, so the reminder is a failing test rather than a habit.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: "Energy today",
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  points: [],
  // `F3.35` Stage C — the second binding array. This file round-trips *config*,
  // and a catalog binding is a row rather than a config field, so it stays empty:
  // the key-set assertion below reads the two config schemas, not the identity.
  sources: [],
};

/** Every field `F3.35` added to the tile, all set, all distinguishable. */
const TILE_CONFIG = {
  unit: "kWh",
  decimals: 2,
  abbreviate: true,
  aggregate: "sum",
  windowMinutes: 1_440,
  compareToPrevious: true,
  icon: "bolt",
  hint: "Since midnight",
  tone: "warning",
} as const;

/** Every field `F3.35` added to the chart, all set. */
const CHART_CONFIG = {
  unit: "MW",
  decimals: 1,
  series: "area",
  windowMinutes: 2_880,
  stacked: true,
  yAxisLabel: "Load",
  aggregate: "avg",
  footerStats: true,
} as const;

function dto(): DashboardDto {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: "33333333-3333-4333-8333-333333333333",
    slug: "overview",
    name: "Overview",
    description: null,
    locationId: null,
    assetGroupId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgets: [
      { ...IDENTITY, widgetType: "value_tile", config: TILE_CONFIG },
      {
        ...IDENTITY,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Plant load",
        widgetType: "chart",
        config: CHART_CONFIG,
      },
    ],
  } as DashboardDto;
}

/**
 * The two fixtures carry **every** field their schema declares.
 *
 * Without this, the identities below are only as complete as the constants
 * somebody last remembered to extend — a new contract field dropped by a mapper
 * would round-trip vacuously and report success. Read off `.shape` rather than
 * restated, so adding a field to the contract fails here on the next run.
 */
export function runFixturesCoverEveryContractFieldTests(): void {
  const tileFields = Object.keys(valueTileConfigSchema.shape).sort();
  const chartFields = Object.keys(chartConfigSchema.shape).sort();

  assert(
    JSON.stringify(Object.keys(TILE_CONFIG).sort()) === JSON.stringify(tileFields),
    "TILE_CONFIG must carry every field valueTileConfigSchema declares, or the round trip below " +
      `passes vacuously on whatever it omits. Fixture: ${JSON.stringify(Object.keys(TILE_CONFIG).sort())}, ` +
      `contract: ${JSON.stringify(tileFields)}`,
  );
  assert(
    JSON.stringify(Object.keys(CHART_CONFIG).sort()) === JSON.stringify(chartFields),
    "CHART_CONFIG must carry every field chartConfigSchema declares. Fixture: " +
      `${JSON.stringify(Object.keys(CHART_CONFIG).sort())}, contract: ${JSON.stringify(chartFields)}`,
  );
}

/**
 * The live builder: read a stored dashboard into rows, build the write payload
 * back out, and every config must be **identical**.
 *
 * The comparison is over the whole object rather than field by field, and
 * `runFixturesCoverEveryContractFieldTests` above holds the fixture equal to the
 * contract — so a field forgotten in `configRowFromDto` fails here rather than
 * escaping through a fixture nobody extended.
 */
export function runLiveBuilderRoundTripTests(): void {
  const payload = buildPutWidgetsPayload(dashboardRowsFromDto(dto()));

  const tile = payload.widgets.find((w) => w.widgetType === "value_tile");
  assert(tile !== undefined, "the tile survived the round trip at all");
  assert(
    JSON.stringify(tile?.config) === JSON.stringify(TILE_CONFIG),
    "a tile's config must survive an edit-and-resave unchanged. Got " +
      `${JSON.stringify(tile?.config)}, expected ${JSON.stringify(TILE_CONFIG)}. A field ` +
      "missing from configRowFromDto is destroyed silently on every save.",
  );

  const chart = payload.widgets.find((w) => w.widgetType === "chart");
  assert(
    JSON.stringify(chart?.config) === JSON.stringify(CHART_CONFIG),
    "a chart's config must survive an edit-and-resave unchanged. Got " +
      `${JSON.stringify(chart?.config)}, expected ${JSON.stringify(CHART_CONFIG)}.`,
  );
}

/**
 * The template-authoring tab, through the same identity.
 *
 * This mapper is the more dangerous of the two: `widgetRowFrom` reads an
 * **unvalidated** `z.record(z.unknown())` blob rather than a parsed DTO, so it
 * needs a `typeof` or membership guard per field and a missing guard reads as a
 * missing field.
 */
export function runTemplateBuilderRoundTripTests(): void {
  const stored = {
    Overview: {
      featured: ["kw"],
      widgets: [
        { widgetType: "value_tile", title: "Energy today", pointKeys: ["kwh"], config: TILE_CONFIG },
        { widgetType: "chart", title: "Plant load", pointKeys: ["kw"], config: CHART_CONFIG },
      ],
    },
  };

  const payload = buildDashboardsPayload(dashboardRowsFrom(stored)) as Record<
    string,
    { widgets: { widgetType: string; config: unknown }[] }
  >;
  const widgets = payload.Overview?.widgets ?? [];

  const tile = widgets.find((w) => w.widgetType === "value_tile");
  assert(
    JSON.stringify(tile?.config) === JSON.stringify(TILE_CONFIG),
    "a template tile's config must survive an edit-and-resave unchanged. Got " +
      `${JSON.stringify(tile?.config)}, expected ${JSON.stringify(TILE_CONFIG)}.`,
  );

  const chart = widgets.find((w) => w.widgetType === "chart");
  assert(
    JSON.stringify(chart?.config) === JSON.stringify(CHART_CONFIG),
    "a template chart's config must survive an edit-and-resave unchanged. Got " +
      `${JSON.stringify(chart?.config)}, expected ${JSON.stringify(CHART_CONFIG)}.`,
  );
}

/**
 * A config from before `F3.35` round-trips to itself, gaining nothing.
 *
 * The failure this guards is the opposite of the one above: a builder that
 * writes `aggregate: ""` or `compareToPrevious: false` rather than omitting
 * them. Both write surfaces compose the schema with `.strict()`, so an empty
 * string is a **400** — and it would be a 400 on saving a dashboard the author
 * had only opened and closed.
 */
export function runUnsetFieldsAreOmittedTests(): void {
  const legacy = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: "33333333-3333-4333-8333-333333333333",
    slug: "overview",
    name: "Overview",
    description: null,
    locationId: null,
    assetGroupId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgets: [
      { ...IDENTITY, widgetType: "value_tile", config: { unit: "kW" } },
      {
        ...IDENTITY,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        widgetType: "chart",
        config: { series: "line" },
      },
    ],
  } as DashboardDto;

  const payload = buildPutWidgetsPayload(dashboardRowsFromDto(legacy));
  const tile = payload.widgets.find((w) => w.widgetType === "value_tile");
  assert(
    JSON.stringify(tile?.config) === JSON.stringify({ unit: "kW" }),
    `a pre-F3.35 tile must round-trip to itself, not gain empty keys. Got ${JSON.stringify(tile?.config)}`,
  );

  const chart = payload.widgets.find((w) => w.widgetType === "chart");
  assert(
    JSON.stringify(chart?.config) === JSON.stringify({ series: "line" }),
    `a pre-F3.35 chart must round-trip to itself. Got ${JSON.stringify(chart?.config)}`,
  );
}
