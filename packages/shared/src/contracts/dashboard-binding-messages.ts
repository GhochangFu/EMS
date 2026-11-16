import type { CatalogEntryMeta } from "./dashboard-builder";

/*
 * The five binding messages of the dashboard widget contract, moved unchanged out of
 * `dashboard-builder.ts` (E1.4c, plan section 16) and re-exported from there, so no importer
 * changes. Each is a sentence two surfaces (the builder and the API) must say identically.
 */

/**
 * The two halves of the exactly-one-binding-kind rule, as message templates.
 *
 * **Here rather than in each surface, because two surfaces state the same rule and an author
 * meets both.** `apps/web`'s builder shows the first as an inline error while the author types;
 * `apps/api`'s `putDashboardWidgetsBodySchema` answers a 400 carrying the second if the form is
 * bypassed. Written independently, the two texts drift, and a 400 whose wording differs from the
 * inline error the author already read presents as a second, unrelated problem.
 *
 * The substitution differs on purpose and is not drift: the web passes the catalog's human label
 * ("Value Tile"), the API has only `widgetType` ("value_tile"). One template, two nouns.
 *
 * The rule itself is `WIDGET_POINT_CARDINALITY` and `WIDGET_SOURCE_CARDINALITY` read together —
 * a widget binds a point or a catalog entry, never both, and never neither.
 */
export const bindingRequiredMessage = (label: string): string =>
  `A ${label} widget needs a bound point or a named metric.`;

export const bindingExclusiveMessage = (label: string): string =>
  `A ${label} widget shows a bound point or a named metric, not both. Remove one.`;

/**
 * The third binding message, for a catalog entry whose shape the widget cannot draw.
 *
 * Here beside `bindingRequiredMessage`/`bindingExclusiveMessage` and for the identical reason:
 * two surfaces state this rule and one author meets both, so the builder's inline error and the
 * API's 400 must read as one problem rather than two. The substitution differs the same way —
 * the web passes the catalog's human label, the API has only `widgetType`.
 *
 * Both arms are written now although only the first can fire today. Stage B's `table` fires the
 * second, and a message added at the same time as the widget type that needs it is a message
 * written to match that widget type rather than to match this sentence.
 */
export const bindingShapeMessage = (
  label: string,
  catalogKey: string,
  shape: CatalogEntryMeta["shape"],
): string =>
  shape === "dataset"
    ? `A ${label} widget shows one number, and "${catalogKey}" returns rows. Choose a metric.`
    : `A ${label} widget shows rows, and "${catalogKey}" returns one number. Choose a dataset.`;

/**
 * The fourth binding message: a `table` projecting a column its dataset does not declare
 * (`F3.35` Stage B).
 *
 * Here with the other three because two surfaces state it and one author meets both — and this
 * one is reachable in ordinary use rather than only by a hand-written payload. An author picks
 * four columns of `alarms.active`, then rebinds the widget to `workorders.open`: the source is
 * legal, its shape is legal, and the stored projection now names columns the new dataset has
 * never heard of. The builder catches it as the author rebinds; the API catches the same state
 * arriving from anywhere else.
 *
 * The message names the column AND the entry, because "that column does not exist" is not
 * actionable when the author is looking at a picker that offered it a moment ago.
 */
export const columnNotDeclaredMessage = (column: string, catalogKey: string): string =>
  `"${catalogKey}" does not have a column named "${column}". Choose from the columns it returns.`;

/**
 * The fifth binding message: the same column chosen twice on one table.
 *
 * Beside the other four because the same author meets it on both surfaces, and here rather than
 * only in `apps/api` for the reason `noDuplicateSources` is: a duplicate is a constraint-shaped
 * refusal, and it should read as one sentence whichever surface says it.
 */
export const duplicateColumnMessage = (column: string): string =>
  `"${column}" is already chosen. Each column appears once.`;
