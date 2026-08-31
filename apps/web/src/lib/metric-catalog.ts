import { METRIC_CATALOG, WIDGET_SOURCE_SHAPES } from "@bms/shared";
import type { MetricCatalogKey, WidgetType } from "@bms/shared";

/**
 * `F3.35` Stage C — the metric catalog's presentation half.
 *
 * **This file is named by two committed docblocks in `@bms/shared`**, both of which reserved it
 * before it existed: `WIDGET_SOURCE_CARDINALITY`'s ("the labels an author reads stays in
 * `apps/web/src/lib/metric-catalog.ts`") and `METRIC_CATALOG`'s ("the label belongs to
 * `apps/web`, which is the only place that renders one"). The split is the same one
 * `widget-catalog.ts` draws for widget types: shape and columns are a contract both sides must
 * agree on and live in `@bms/shared`; a label is presentation and lives here.
 *
 * **No shape and no column list is restated below.** Both come from `METRIC_CATALOG`, so a key
 * whose shape changes cannot keep an old description here — the shape is read, never copied.
 *
 * The `Record` over `MetricCatalogKey` is compiler-forced, so Stage B's keys fail the build at
 * this declaration rather than rendering a raw `alarms.active` string in a picker.
 * `tests/f3.35-metric-catalog-labels.test.ts` holds the reverse direction, which the compiler
 * cannot see — an entry here that no longer matches an enum member.
 */
type MetricCatalogPresentation = {
  /** What an author picks from a list. Sentence case, no key syntax — an author does not read dots. */
  readonly label: string;
  /** One line under the label, saying what the number or the table counts. */
  readonly description: string;
};

export const METRIC_CATALOG_PRESENTATION: Readonly<
  Record<MetricCatalogKey, MetricCatalogPresentation>
> = {
  "alarms.active.count": {
    label: "Active alarms",
    // "Unacknowledged" rather than "unresolved", because that is what the resolver actually
    // reads: `bms.alarms` carries no cleared column, and `activeAlarmWhere` is
    // `acknowledged_at IS NULL`. A label promising "unresolved" would describe a different
    // number from the one the tile shows.
    description: "How many alarms are raised and not yet acknowledged.",
  },
  "alarms.active": {
    label: "Active alarm list",
    description: "The raised, unacknowledged alarms, one row each.",
  },
  "workorders.open.count": {
    label: "Open work orders",
    // The resolver defines open as the NEGATIVE — not resolved, not closed — so a status added
    // later counts by default. The label says "still open" rather than naming three statuses,
    // which would go stale the day a fourth is added.
    description: "How many work orders are still open.",
  },
  "workorders.open": {
    label: "Open work order list",
    description: "The work orders that are still open, one row each.",
  },
  "assets.health.score": {
    label: "Asset health score",
    // `E1.3` returns a null mean when no tag carries a published threshold rule, and `F4.69` is
    // the open row for the seed gap that makes that the current state. The tile renders "no
    // value" rather than a fabricated zero, so the description must not promise a number.
    description: "The weighted mean health score across the assets in scope.",
  },
};

/** The label alone — the common read, and the one a picker option and an inline error share. */
export function metricCatalogLabel(key: MetricCatalogKey): string {
  return METRIC_CATALOG_PRESENTATION[key].label;
}

/**
 * The catalog entries a widget type can actually bind, for the builder's picker.
 *
 * **Filtered by shape, not only by cardinality, and that ordering matters.** A `value_tile`'s
 * cardinality is a count (`{min: 0, max: 1}`), which a `dataset` entry satisfies exactly as well
 * as a `metric` one — so a picker built from the cardinality alone would offer "Active alarm
 * list" for a tile that draws one number. `WIDGET_SOURCE_SHAPES` is what narrows it, and the
 * write path reads the same record (`eachSourceFitsTheWidget` in `dashboards.schema.ts`), so
 * this list and the 400 cannot disagree.
 *
 * Returns `[]` for a type that binds no catalog entry — a gauge, a tank, a chart — which is the
 * caller's signal to render no picker at all rather than an empty one.
 */
export function catalogKeysFor(widgetType: WidgetType): MetricCatalogKey[] {
  const drawable = WIDGET_SOURCE_SHAPES[widgetType];
  return (Object.keys(METRIC_CATALOG) as MetricCatalogKey[]).filter((key) =>
    drawable.includes(METRIC_CATALOG[key].shape),
  );
}

/**
 * A dataset column, as an operator reads it (`F3.35` Stage B, AGENTS.md §5).
 *
 * **`assetCode` is a field name, not a column heading.** The Nexus mock's own tables head their
 * columns *"WO ID"*, *"Area / Asset"*, *"Priority"*, *"Status"*, *"SLA"* — and Sheet 02's claim
 * is that an administrator with no programming skill composes these cards. A header row reading
 * `assetCode  assetName  raisedAt` puts the API's field names in front of that person.
 *
 * **Here, not in `METRIC_CATALOG`.** A label is presentation, and presentation is the frontend's
 * — the same split `METRIC_CATALOG_PRESENTATION` above draws for the entries themselves, and the
 * reason `packages/shared` carries the column NAMES (both sides must agree on those) but not
 * their labels.
 *
 * **Keyed by plain string, and gated by a test rather than by the compiler.** `CatalogEntryMeta`
 * types `columns` as `readonly string[]`, so there is no literal union to build a `Record` over —
 * making one would mean an `as const` on `METRIC_CATALOG`, which is an ADR 0048 shape change.
 * `tests/f3.35-metric-catalog-labels.test.ts` holds both directions instead: every declared
 * column has a label, and no label here is orphaned.
 */
export const METRIC_CATALOG_COLUMN_LABELS: Readonly<Record<string, string>> = {
  assetCode: "Asset ID",
  assetName: "Asset",
  severity: "Severity",
  message: "Message",
  raisedAt: "Raised",
  status: "Status",
  priority: "Priority",
  title: "Title",
  dueAt: "Due",
};

/**
 * The heading for one dataset column.
 *
 * **Falls back to the raw name rather than to an empty string.** An unlabelled column is a gap
 * in the map above, and the test named there fails on it — but if one ever reaches a running
 * card, `assetCode` is a poor heading and a blank one is a broken table.
 */
export function metricCatalogColumnLabel(column: string): string {
  return METRIC_CATALOG_COLUMN_LABELS[column] ?? column;
}
