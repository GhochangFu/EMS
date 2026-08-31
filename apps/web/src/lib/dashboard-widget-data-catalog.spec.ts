import { METRIC_CATALOG } from "@bms/shared";
import type {
  DashboardDto,
  DashboardWidgetDto,
  DashboardWidgetPointDto,
  DashboardWidgetSourceDto,
  MetricCatalogValueDto,
} from "@bms/shared";

import { isRowsData, isScalarData } from "../components/widgets/dashboard-widget";

import {
  CATALOG_STALE_MS,
  catalogBindingKey,
  catalogIsStale,
  dashboardBindsCatalogSources,
  widgetDataFor,
  type CatalogResolution,
  type HistoryByRef,
  type LatestByRef,
} from "./dashboard-widget-data";

/**
 * `F3.35` Stage C Unit 5 — the catalog data path in the viewer (ADR 0048 decisions 1 and 2).
 *
 * Its own file rather than more of `dashboard-widget-data.spec.ts`, for the reason the Stage A
 * file gives: these assertions are about a branch that did not exist before this row, and the
 * fixture they need — a resolved catalog answer keyed by `(widgetId, catalogKey)` — is not one of the two
 * telemetry maps every assertion in that file uses. `dashboard-widget-data-catalog.test.ts` is
 * this file's Vitest wrapper (ADR 0014).
 *
 * **Two failures are what this file exists to hold, and both render rather than throw.** A
 * catalog-bound tile hitting the `points.length === 0` guard shows "No data bound." with a
 * correct number sitting unread in the response; a catalog-bound tile aged through `FRESH_MS`
 * shows "Offline" over that number for 35 seconds out of every 60. Neither logs anything.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_SOURCE_ID = "88888888-8888-4888-8888-888888888888";

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  points: [],
};

const POINT: DashboardWidgetPointDto = {
  id: "44444444-4444-4444-8444-444444444444",
  pointId: "55555555-5555-4555-8555-555555555555",
  role: "primary",
  sortOrder: 0,
  assetId: "66666666-6666-4666-8666-666666666666",
  pointKey: "power_kw",
  unit: "kW",
};

const SOURCE: DashboardWidgetSourceDto = {
  id: SOURCE_ID,
  catalogKey: "alarms.active.count",
  params: {},
  sortOrder: 0,
};

/** The key the viewer actually looks up: the widget that holds the binding, and the entry it
 * names. NOT `SOURCE_ID` — see `catalogBindingKey`'s docblock for the failure that taught us. */
const BINDING = catalogBindingKey(IDENTITY.id, SOURCE.catalogKey);

const EMPTY_LATEST: LatestByRef = new Map();
const EMPTY_HISTORY: HistoryByRef = new Map();

/** A `value_tile` bound to the given catalog sources and to no point. */
function tileWith(sources: DashboardWidgetSourceDto[]): DashboardWidgetDto {
  return {
    ...IDENTITY,
    widgetType: "value_tile",
    config: {},
    sources,
  } as DashboardWidgetDto;
}

/** A resolve answered `ageMs` before `NOW`. */
function resolution(
  values: [string, MetricCatalogValueDto][],
  ageMs = 1_000,
): CatalogResolution {
  return {
    byBinding: new Map(values),
    resolvedAt: new Date(NOW - ageMs).toISOString(),
  };
}

const COUNT_OF = (value: number | null): MetricCatalogValueDto => ({
  shape: "metric",
  key: "alarms.active.count",
  value,
  unit: null,
});

// ---------------------------------------------------------------------------
// `F3.35` Stage B — the dataset half.
// ---------------------------------------------------------------------------

const DATASET_SOURCE: DashboardWidgetSourceDto = {
  id: SOURCE_ID,
  catalogKey: "alarms.active",
  params: {},
  sortOrder: 0,
};

const DATASET_BINDING = catalogBindingKey(IDENTITY.id, DATASET_SOURCE.catalogKey);

/** The columns `METRIC_CATALOG["alarms.active"]` declares — imported, never restated. */
const DECLARED_COLUMNS = (() => {
  const entry = METRIC_CATALOG["alarms.active"];
  if (entry.shape !== "dataset") {
    throw new Error("alarms.active must be a dataset — this fixture is meaningless otherwise");
  }
  return entry.columns;
})();

function tableWith(sources: DashboardWidgetSourceDto[]): DashboardWidgetDto {
  return {
    ...IDENTITY,
    widgetType: "table",
    config: {},
    sources,
  } as DashboardWidgetDto;
}

const ALARM_ROWS: MetricCatalogValueDto = {
  shape: "dataset",
  key: "alarms.active",
  columns: [...DECLARED_COLUMNS],
  rows: [
    {
      assetCode: "RO-01",
      assetName: "RO Feed Pump",
      severity: "critical",
      message: "Feed pressure above design limit",
      raisedAt: "2026-01-01T00:05:00.000Z",
    },
  ],
  truncated: false,
};

/**
 * A table bound to a dataset reaches the renderer as ROWS, not as a number.
 *
 * The regression direction is precise: before Stage B, `catalogWidgetData` returned the scalar
 * arm unconditionally, so a table resolved perfectly and then rendered `primary: null` into a
 * component that draws no numbers — a blank card, with the rows sitting unread in the response.
 */
export function runDatasetBindingProducesRowsTests(): void {
  const data = widgetDataFor(
    tableWith([DATASET_SOURCE]),
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([[DATASET_BINDING, ALARM_ROWS]]),
  );

  assert(isRowsData(data), `a dataset binding must produce the rows arm, got ${data.status}`);
  if (!isRowsData(data)) return;

  assert(
    data.rows.length === 1 && data.rows[0]?.assetCode === "RO-01",
    "the resolved rows must reach the renderer unchanged",
  );
  assert(
    JSON.stringify(data.columns) === JSON.stringify([...DECLARED_COLUMNS]),
    `the resolved columns must reach the renderer, got ${JSON.stringify(data.columns)}`,
  );
  assert(data.truncated === false, "truncated must be carried, not inferred from row count");

  // The other half, and it is not symmetry: `isScalarData` and `isRowsData` must disagree about
  // every value. A guard that answered true to both would let a caller read `primary` off a
  // dataset and get `undefined` typed as `number | null`.
  assert(
    !isScalarData(data),
    "the rows arm must not also satisfy isScalarData — the two guards partition `ready`",
  );
}

/**
 * An UNANSWERED dataset still renders its header, and this is the assertion that argued the
 * implementation into keying off the declared shape.
 *
 * Keyed off the resolved answer instead, an unanswered table falls to the scalar arm, arrives at
 * `TableWidget` with no columns, and draws "No columns to show. Edit this widget and choose at
 * least one" — telling an author to repair a configuration that is correct, on every page load
 * before the first resolve returns. `METRIC_CATALOG` is code and the client holds it, so the
 * columns are knowable with no round trip at all.
 */
export function runUnansweredDatasetKeepsItsHeaderTests(): void {
  const data = widgetDataFor(
    tableWith([DATASET_SOURCE]),
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    undefined,
  );

  assert(
    isRowsData(data),
    "an unanswered dataset binding must still produce the rows arm, or the card tells the " +
      "author to fix a configuration that is not broken",
  );
  if (!isRowsData(data)) return;

  assert(
    JSON.stringify(data.columns) === JSON.stringify([...DECLARED_COLUMNS]),
    `the DECLARED columns must render before the first resolve, got ${JSON.stringify(data.columns)}`,
  );
  assert(data.rows.length === 0, "an unanswered dataset has no rows");
  assert(
    data.stale === true,
    "an unanswered resolve is stale — 'never contacted' is no better evidence of a live API " +
      "than 'contacted long ago'",
  );
}

/**
 * A catalog-bound widget is NOT the empty state, and the number reaches the renderer.
 *
 * **Written failing against the un-widened guard.** `widgetDataFor` opened with
 * `widget.points.length === 0`, and a metric tile has no points by construction — the two
 * binding kinds are exclusive — so every correctly configured tile returned `{status:
 * "empty"}` and drew "No data bound." with its answer sitting unread in the response map.
 */
export function runCatalogBoundTileIsNotEmptyTests(): void {
  const widget = tileWith([SOURCE]);
  const data = widgetDataFor(
    widget,
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([[BINDING, COUNT_OF(7)]]),
  );

  assert(
    data.status === "ready",
    `a tile bound to a catalog entry must be readable, got "${data.status}" — the "empty" arm ` +
      'renders "No data bound.", which is the state reserved for a widget that lost its binding',
  );
  assert(
    isScalarData(data) && data.primary === 7,
    "the resolved count must reach the renderer as `primary`",
  );

  // The half that is NOT symmetry: a widget with neither kind of binding is still the empty
  // state. ADR 0047 Amendment 1 requires it, and a guard widened to `sources.length === 0`
  // alone — or deleted outright — would pass the assertion above while losing this.
  const bare = widgetDataFor({ ...tileWith([]) }, EMPTY_LATEST, EMPTY_HISTORY, NOW);
  assert(
    bare.status === "empty",
    `a widget binding NOTHING must stay the empty state, got "${bare.status}" — a cascaded ` +
      "point binding is what that arm exists for and this change must not take it away",
  );
}

/**
 * A catalog value ages against `resolvedAt`, on the catalog's own window.
 *
 * **`FRESH_MS` is 25,000 and the refresh interval is 60,000, so reusing `isStale` here would
 * mark every catalog tile "Offline" for 35 seconds out of every 60** with the API answering
 * perfectly — the bucketed-chart failure through a third door. The assertions below pin the
 * window to `CATALOG_STALE_MS`, and the first one fails against `isStale`.
 */
export function runCatalogStalenessTests(): void {
  const widget = tileWith([SOURCE]);
  const at = (ageMs: number) =>
    widgetDataFor(
      widget,
      EMPTY_LATEST,
      EMPTY_HISTORY,
      NOW,
      undefined,
      resolution([[BINDING, COUNT_OF(7)]], ageMs),
    );

  // 30 s is older than FRESH_MS (25 s) and well inside one refresh cycle. This is the exact
  // reading a page shows most of the time, and reading it as stale is the defect.
  const fresh = at(30_000);
  assert(
    fresh.status === "ready" && fresh.stale === false,
    "a value resolved 30 s ago is one ordinary refresh cycle old and must NOT read as stale — " +
      "FRESH_MS (25 s) is shorter than the refresh interval, so aging this through isStale " +
      "would show Offline for 35 s out of every 60 with the API answering perfectly",
  );

  const old = at(CATALOG_STALE_MS + 1_000);
  assert(
    old.status === "ready" && old.stale === true,
    "a value older than two missed refreshes must read as stale — a window that never expires " +
      "cannot notice a dead API, which is the only thing this flag is for",
  );

  // Not yet answered is stale: "never contacted" is no better evidence of a live API than
  // "contacted long ago". Same rule `isStale(null, …)` states one binding kind over.
  const unresolved = widgetDataFor(widget, EMPTY_LATEST, EMPTY_HISTORY, NOW, undefined, undefined);
  assert(
    isScalarData(unresolved) && unresolved.stale === true && unresolved.primary === null,
    "an unanswered resolve must stay READABLE with a null primary and a stale flag — not the " +
      "empty state, and not a fabricated number",
  );

  // The clamp, inherited from `readingTimestampMs`: a `resolvedAt` ahead of the browser's clock
  // is skew, not freshness forever.
  assert(
    catalogIsStale(new Date(NOW + 60 * 60_000).toISOString(), NOW) === false,
    "a resolvedAt an hour in the future is clock skew and must clamp to now, not read as stale",
  );
  assert(
    catalogIsStale("not a date", NOW) === true,
    "an unparsable resolvedAt is no evidence of freshness",
  );
  assert(catalogIsStale(null, NOW) === true, "a null resolvedAt reads as stale");
}

/**
 * A dataset resolved onto a single-number widget renders "no value", never a number.
 *
 * Unreachable through the builder (the picker filters by shape) and through the API
 * (`eachSourceFitsTheWidget` refuses it), but a row stored before that rule existed must not
 * put a fabricated number in front of an operator.
 */
export function runDatasetOnATileRendersNoValueTests(): void {
  const widget = tileWith([{ ...SOURCE, catalogKey: "alarms.active" }]);
  const data = widgetDataFor(
    widget,
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([
      [
        catalogBindingKey(IDENTITY.id, "alarms.active"),
        {
          shape: "dataset",
          key: "alarms.active",
          columns: ["assetCode"],
          rows: [{ assetCode: "A-1" }, { assetCode: "A-2" }],
          truncated: false,
        },
      ],
    ]),
  );

  assert(
    isScalarData(data) && data.primary === null,
    "a dataset on a single-number widget must render no value — a row count dressed up as a " +
      "metric is a number the author never chose",
  );
}

/** The binding read is the lowest `sortOrder`, and an unanswered `sourceId` is not an error. */
export function runCatalogBindingSelectionTests(): void {
  const widget = tileWith([
    { ...SOURCE, id: OTHER_SOURCE_ID, catalogKey: "workorders.open.count", sortOrder: 5 },
    { ...SOURCE, id: SOURCE_ID, sortOrder: 1 },
  ]);
  const data = widgetDataFor(
    widget,
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([
      [BINDING, COUNT_OF(3)],
      [catalogBindingKey(IDENTITY.id, "workorders.open.count"), COUNT_OF(99)],
    ]),
  );
  assert(
    isScalarData(data) && data.primary === 3,
    "the binding with the lowest stored sortOrder is the one read — array position is not row " +
      "order, and `dashboard_widget_sources` guarantees none",
  );

  // A `sourceId` the resolve did not answer is a widget deleted between the two calls, which
  // the response contract names as a legitimate state.
  const dropped = widgetDataFor(
    tileWith([SOURCE]),
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([]),
  );
  assert(
    isScalarData(dropped) && dropped.primary === null,
    "a binding the resolve did not answer renders no value, not an error",
  );
}

/**
 * A binding still resolves after a save has regenerated its row id.
 *
 * **This is the assertion that would have caught keying on `sourceId`** (correctness review,
 * Medium). `putWidgets` REPLACES a widget's bindings — `DELETE` by `widget_id`, then re-INSERT
 * — and `dashboard_widget_sources.id` is `defaultRandom()`, so editing a tile's TITLE mints a
 * new id for a binding nobody touched. The catalog query polls every minute and the dashboard
 * query does not poll at all, so a display that never regains focus holds stale ids while the
 * catalog answers with fresh ones. Every tile then falls to a confident "no value".
 *
 * The fixture below is exactly that state: the widget still carries the OLD `sourceId`, and the
 * resolve answers under the same widget and the same catalog key. It must resolve.
 */
export function runBindingSurvivesARegeneratedSourceIdTests(): void {
  const widget = tileWith([SOURCE]);

  const afterResave = widgetDataFor(
    widget,
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    // The resolve's own row id has moved on; the widget id and the catalog key have not.
    resolution([[catalogBindingKey(IDENTITY.id, SOURCE.catalogKey), COUNT_OF(11)]]),
  );
  assert(
    isScalarData(afterResave) && afterResave.primary === 11,
    "a binding whose row id was regenerated by an unrelated save must still resolve — keying on " +
      "`sourceId` makes every tile read `null` after any widget edit, with `stale: false`",
  );

  // The other direction: a resolve for a DIFFERENT widget must not leak into this one. The key
  // is the pair, not the catalog key alone — two widgets may bind the same entry.
  const otherWidgetsAnswer = widgetDataFor(
    widget,
    EMPTY_LATEST,
    EMPTY_HISTORY,
    NOW,
    undefined,
    resolution([[catalogBindingKey(OTHER_SOURCE_ID, SOURCE.catalogKey), COUNT_OF(999)]]),
  );
  assert(
    isScalarData(otherWidgetsAnswer) && otherWidgetsAnswer.primary === null,
    "another widget's answer for the same catalog entry must NOT resolve here — two tiles may " +
      "bind the same key, and the widget id is what separates them",
  );
}

/** The whole second data path is gated on a dashboard actually binding something. */
export function runCatalogGateTests(): void {
  const dashboard = (widgets: DashboardWidgetDto[]): DashboardDto =>
    ({
      id: IDENTITY.dashboardId,
      organizationId: IDENTITY.organizationId,
      slug: "overview",
      name: "Overview",
      description: null,
      locationId: null,
      assetGroupId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      widgets,
    }) as DashboardDto;

  const pointOnly = { ...IDENTITY, widgetType: "value_tile", config: {}, points: [POINT], sources: [] } as DashboardWidgetDto;

  assert(
    dashboardBindsCatalogSources(dashboard([pointOnly])) === false,
    "a dashboard saved before F3.35 binds no catalog entry and must issue NO catalog request — " +
      "the read count for every existing dashboard is unchanged by this row",
  );
  assert(
    dashboardBindsCatalogSources(dashboard([])) === false,
    "an empty dashboard binds no catalog entry",
  );
  assert(
    dashboardBindsCatalogSources(dashboard([pointOnly, tileWith([SOURCE])])) === true,
    "one bound metric anywhere on the dashboard turns the path on",
  );
}
