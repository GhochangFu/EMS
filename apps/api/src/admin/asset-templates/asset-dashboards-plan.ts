import { createHash } from "node:crypto";

import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS } from "@bms/shared";
import type {
  TemplateDashboardView,
  TemplateDashboardWidget,
  TemplateWidgetResolutionDto,
  WidgetPointRole,
} from "@bms/shared";
import { BadRequestException } from "@nestjs/common";

/**
 * `F3.2` / ADR 0067 — the pure half of "an asset template's dashboard views
 * become one dashboard per view, per asset".
 *
 * Everything here is a function of its arguments: no database, no NestJS
 * provider, no transaction. `AssetDashboardsInstantiateService` (Task 6) calls
 * `planView` once per view per asset inside the caller's `withTenant`
 * transaction and writes what it returns. Keeping the derivation out of that
 * service is what `template-alarm-rules.ts` does one table over, and for the
 * same reason: `bms.dashboards.slug` is `varchar(64)` and unique on
 * `(organization_id, slug)`, so a bad derivation is a failed instantiation of up
 * to 200 assets rather than a cosmetic defect — and a pure module is provable
 * against every input the content contract permits rather than only against
 * whatever a fixture holds.
 *
 * **The tile lattice reads `DASHBOARD_GRID` and never restates the canvas.**
 * `tests/f3.1d-grid-bounds-single-source.test.ts` scans this file: a bare `11`,
 * `12` or `24` beside a `gridX`/`gridY`/`gridW`/`gridH` token is a fifth
 * declaration of a bound that is declared once, in
 * `packages/shared/src/contracts/dashboard-builder.ts`.
 */

/** `bms.dashboards.slug` is `varchar(64)`. */
const SLUG_MAX_LENGTH = 64;

/**
 * The floor, and it is D2's choice rather than a schema's: no exported contract
 * requires a minimum slug length today, but a one-character path segment derived
 * from punctuation reads as a bug in a URL an operator has to share. Two empty
 * parts join to a single `-`, which is the only input that can reach it — the
 * hash branch always lands on exactly {@link SLUG_MAX_LENGTH}.
 */
const SLUG_MIN_LENGTH = 2;

/** D2 step 3: `55 + 1 + 8 = 64`, the column's whole width. */
const SLUG_TRUNCATED_LENGTH = 55;
const SLUG_HASH_LENGTH = 8;

/** `bms.dashboards.name` is `varchar(255)`, and Postgres counts CHARACTERS. */
const NAME_MAX_CODE_POINTS = 255;

/** The separator between the asset's name and the view's — D3. */
const NAME_SEPARATOR = " · ";

/** A fallback tile's width in canvas columns. */
export const TILE_W = 3;

/** A fallback tile's height in canvas rows. */
export const TILE_H = 2;

/**
 * How many fallback tiles fit across the canvas. **Derived, not counted**: the
 * lattice widens by itself if the canvas ever does.
 */
export const TILES_PER_ROW = DASHBOARD_GRID.columns / TILE_W;

/**
 * Ceiling on `dashboard_widgets` rows one instantiate call may create.
 *
 * **This bounds the transaction, not a bind-parameter count**, and that is the
 * difference from `MAX_POINT_ROWS` and `MAX_RULE_ROWS`, whose numbers come from
 * Postgres' 65,535 parameters per statement. D6 inserts **per widget** — one
 * statement each — so no statement here approaches that ceiling. What a large
 * batch costs instead is one long-held transaction holding row locks on
 * `dashboards`, `dashboard_widgets` and `dashboard_widget_points` at once. The
 * figure is `MAX_POINT_ROWS`' 8,000, chosen because the contract permits 200
 * assets x 40 widgets exactly, and because a caller meeting this bound should
 * meet the same order of magnitude it already met on points.
 */
export const MAX_DASHBOARD_WIDGET_ROWS = 8_000;

/** One resolved binding: the template's point key and the asset's row id for it. */
export interface PlannedPoint {
  readonly pointKey: string;
  readonly pointId: string;
}

/** A planned widget's layout half — the columns `dashboard_widgets` holds. */
export interface PlannedWidgetIdentity {
  /** `title` is nullable in the column and optional in the template. */
  readonly title: string | null;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  /** Which slot of the renderer every bound point feeds — D4. */
  readonly pointRole: WidgetPointRole;
  /** The keys that resolved, in template key order. May be empty. */
  readonly points: readonly PlannedPoint[];
}

/**
 * The type-and-config pair, kept paired.
 *
 * Distributive on purpose: `TemplateDashboardWidget` is an intersection with the
 * shared widget union, and a plain `Pick` over a union collapses to one object
 * with two independent union fields — which would let a chart's config arrive
 * beside `value_tile`. The `Exclude<…, "table">` rule that makes a widget
 * template-authorable is **not** restated here; it is inherited from
 * `TemplateDashboardWidget`, which is where §4.8 puts it.
 */
type SpecOf<W> = W extends { widgetType: infer T; config: infer C }
  ? { readonly widgetType: T; readonly config: C }
  : never;

export type PlannedWidgetSpec = SpecOf<TemplateDashboardWidget>;

/** One `bms.dashboard_widgets` row, with the `dashboard_widget_points` rows it carries. */
export type PlannedWidget = PlannedWidgetIdentity & PlannedWidgetSpec;

/** One view's whole plan: what to write, and what to report about it. */
export interface ViewPlan {
  /** The key of the view inside `content.dashboards`. */
  readonly view: string;
  readonly widgets: readonly PlannedWidget[];
  /** One entry per planned widget, in the same order — ADR 0067 decision 5. */
  readonly resolutions: readonly TemplateWidgetResolutionDto[];
  /**
   * How many `featured` keys the fallback could not lay out, because the view
   * declares more than a dashboard may hold.
   *
   * ADR 0067 decision 3 asks the view's report to say that it was cut;
   * `templateWidgetResolutionDtoSchema`'s `truncated` is a **per-widget**
   * outcome and cannot carry it (a widget never has more candidates than keys
   * for one asset). Ruled 2026-09-16 (plan §12 Q3): the count lives here.
   */
  readonly omittedFeatured: number;
}

/** Lower-cases, collapses every run outside the class, and strips the edges. */
function normalisePart(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * The slug for one view of one asset's default dashboard — ADR 0067, plan D2.
 *
 * The output always satisfies `varchar(64)` and `[a-z0-9-]` for every input the
 * content contract permits: `assets.code` carries no character restriction and a
 * view key is up to 64 characters, so a naive join overflows the column and can
 * carry anything.
 *
 * Two things differ from `seededRuleCode`, which this copies, and both are the
 * charset:
 *
 * - **The digest is LOWER-case hex.** That function upper-cases it because
 *   `ruleCodeSchema` accepts `[A-Z0-9_-]` only. Here the opposite is true — a
 *   slug is `[a-z0-9-]` — so an upper-cased digest would emit a slug this
 *   module's own rule refuses.
 * - **There is no `R_` prefix**, because nothing requires a slug to start
 *   alphanumeric.
 *
 * The hash is taken over the **untruncated** join. Taking it over the cut prefix
 * would make every pair of inputs that agrees to character 55 collide, which is
 * the one collision this branch exists to prevent. A genuine collision is still
 * possible (two assets whose codes differ only in punctuation) and becomes the
 * ADR 0049 409 on `dashboards_organization_slug_key` — D6.
 *
 * Slicing cannot split a surrogate pair here, and that is a property of the
 * order rather than luck: the class filter has already removed every non-ASCII
 * code point by the time the cut happens. `dashboardName` has no such filter,
 * which is why it counts code points instead.
 */
export function dashboardSlug(assetCode: string, viewName: string): string {
  const joined = `${normalisePart(assetCode)}-${normalisePart(viewName)}`;
  if (joined.length <= SLUG_MAX_LENGTH) {
    return joined.padEnd(SLUG_MIN_LENGTH, "-");
  }
  const digest = createHash("sha256").update(joined).digest("hex").slice(0, SLUG_HASH_LENGTH);
  return `${joined.slice(0, SLUG_TRUNCATED_LENGTH)}-${digest}`;
}

/**
 * The dashboard's display name — D3.
 *
 * Cut by **code point**, not by `String.prototype.slice`: `varchar(255)` counts
 * characters, and `slice` counts UTF-16 code units, so a cut landing inside a
 * surrogate pair emits a lone surrogate. That value still fits the column and
 * still typechecks; it renders as a replacement glyph in front of an operator.
 */
export function dashboardName(assetName: string, viewName: string): string {
  const joined = `${assetName}${NAME_SEPARATOR}${viewName}`;
  const codePoints = Array.from(joined);
  return codePoints.length <= NAME_MAX_CODE_POINTS
    ? joined
    : codePoints.slice(0, NAME_MAX_CODE_POINTS).join("");
}

/** A chart draws series; every other authorable type draws one primary value. */
function pointRoleFor(widgetType: PlannedWidgetSpec["widgetType"]): WidgetPointRole {
  return widgetType === "chart" ? "series" : "primary";
}

/**
 * The per-widget report — ADR 0067 decision 5, with the constants ruled on
 * 2026-09-16 (plan §12 Q2).
 *
 * `assetRoleCodes` is empty and `matchedMembers` is `1` because an **asset**
 * template instantiates onto exactly one asset: the role vocabulary belongs to
 * the dashboard-template path (ADR 0049), which resolves a widget against the
 * members of an asset group. `widgetKey` is `<view>#<index>`, because a template
 * widget carries no key of its own and its position is the only stable identity
 * it has inside one view.
 *
 * **`bound` with `boundPoints: 0` is a real state, not a defect.** A
 * `value_tile` may declare no point key at all —
 * `WIDGET_POINT_CARDINALITY.value_tile.min` is `0`, and that contract's docblock
 * calls it "a legal authored state rather than a broken one". Such a widget is
 * short of nothing, so it is not `unresolved`: `unresolved` means the keys it
 * asked for all missed.
 */
function resolutionFor(
  viewName: string,
  index: number,
  requestedKeys: number,
  boundPoints: number,
): TemplateWidgetResolutionDto {
  const outcome =
    boundPoints === requestedKeys ? "bound" : boundPoints === 0 ? "unresolved" : "partial";
  return {
    widgetKey: `${viewName}#${index}`,
    assetRoleCodes: [],
    matchedMembers: 1,
    boundPoints,
    outcome,
  };
}

/**
 * The keys of one widget that the asset actually carries, in template order,
 * **once each**.
 *
 * The dedupe is a schema constraint rather than tidiness.
 * `dashboard_widget_points` is unique on `(widget_id, point_id, role)` and every
 * binding of one planned widget carries the same role, so a template widget
 * authored `pointKeys: ["kw", "kw"]` — which the content contract accepts, since
 * it bounds the array's length per type and nothing else — would write two
 * identical rows and make **every** instantiation of that template a 500 naming
 * a constraint. Found by the code review of 2026-09-17.
 *
 * Keyed by the resolved **point id**, not by the key string: two keys that
 * resolved to one point would collide in the same column triple, and the id is
 * what the constraint counts.
 */
function resolvePoints(
  pointKeys: readonly string[],
  pointIdByPointKey: ReadonlyMap<string, string>,
): PlannedPoint[] {
  const resolved: PlannedPoint[] = [];
  const bound = new Set<string>();
  for (const pointKey of pointKeys) {
    const pointId = pointIdByPointKey.get(pointKey);
    if (pointId !== undefined && !bound.has(pointId)) {
      bound.add(pointId);
      resolved.push({ pointKey, pointId });
    }
  }
  return resolved;
}

/**
 * What a widget actually asked for — the count its report is graded against.
 *
 * Distinct, because {@link resolvePoints} binds distinct points: grading a
 * deduped binding count against the raw `pointKeys.length` would report
 * `partial` for `["kw", "kw"]` with `kw` resolved, which is a widget short of
 * nothing.
 */
function requestedKeyCount(pointKeys: readonly string[]): number {
  return new Set(pointKeys).size;
}

/** A view's own widgets, one planned widget each, layout and config verbatim. */
function planAuthoredWidgets(
  viewName: string,
  widgets: readonly TemplateDashboardWidget[],
  pointIdByPointKey: ReadonlyMap<string, string>,
): ViewPlan {
  const planned: PlannedWidget[] = [];
  const resolutions: TemplateWidgetResolutionDto[] = [];

  for (const [index, widget] of widgets.entries()) {
    const points = resolvePoints(widget.pointKeys, pointIdByPointKey);
    // `spec` is read out as one value rather than field by field, so the type
    // and the config stay paired through the assignment.
    const spec: PlannedWidgetSpec = widget;
    planned.push({
      ...spec,
      title: widget.title ?? null,
      gridX: widget.gridX,
      gridY: widget.gridY,
      gridW: widget.gridW,
      gridH: widget.gridH,
      pointRole: pointRoleFor(widget.widgetType),
      points,
    });
    resolutions.push(
      resolutionFor(viewName, index, requestedKeyCount(widget.pointKeys), points.length),
    );
  }

  // Not `featured.length - planned.length`: `featured` is not the source on this
  // branch, so nothing of it was omitted. A view may legitimately declare fifty
  // featured keys and draw three widgets.
  return { view: viewName, widgets: planned, resolutions, omittedFeatured: 0 };
}

/**
 * The fallback: one value tile per featured key, laid left to right.
 *
 * **One tile binds exactly one key**, because `WIDGET_POINT_CARDINALITY.value_tile.max`
 * is `1` and `F3.1b`'s write path refuses a second binding. That number is
 * **not** read here: a `[key].slice(0, max)` would be dead code — the array is
 * length one by construction — and would read as a single-source use while
 * constraining nothing. The spec pins the equality instead, so a widened
 * vocabulary reddens there rather than passing silently through a lattice that
 * was derived for one key per tile.
 */
function planFeaturedTiles(
  viewName: string,
  featured: readonly string[],
  pointIdByPointKey: ReadonlyMap<string, string>,
): ViewPlan {
  const laid = Math.min(featured.length, MAX_DASHBOARD_WIDGETS);
  const planned: PlannedWidget[] = [];
  const resolutions: TemplateWidgetResolutionDto[] = [];

  for (let index = 0; index < laid; index += 1) {
    const pointKey = featured[index] ?? "";
    const points = resolvePoints([pointKey], pointIdByPointKey);
    planned.push({
      widgetType: "value_tile",
      config: {},
      // The key itself, not a prettier label: a template `featured` entry has no
      // label, and the point's own label lives on the asset rather than on the
      // template. Flagged in the plan as a decision taken inside the boundary.
      title: pointKey,
      gridX: (index % TILES_PER_ROW) * TILE_W,
      gridY: Math.floor(index / TILES_PER_ROW) * TILE_H,
      gridW: TILE_W,
      gridH: TILE_H,
      pointRole: pointRoleFor("value_tile"),
      points,
    });
    resolutions.push(resolutionFor(viewName, index, 1, points.length));
  }

  return {
    view: viewName,
    widgets: planned,
    resolutions,
    omittedFeatured: featured.length - laid,
  };
}

/**
 * Everything one view of one asset becomes — D4.
 *
 * `pointIdByPointKey` is keyed by the **bare** point key of **one** asset. The
 * service loads its map once per call keyed `${assetId}::${pointKey}` (D5) and
 * must narrow it per asset before calling this: a composite-keyed map resolves
 * nothing, every widget reports `unresolved`, and no surface raises an error.
 * The parameter is named for the key it takes so that mistake is visible at the
 * call site.
 *
 * A view with a non-empty `widgets` array is drawn as the author laid it out. An
 * absent **or empty** array falls back to `featured`, because an empty array
 * carries no layout and a dashboard with no widgets is not what a default is
 * for.
 */
export function planView(
  viewName: string,
  view: TemplateDashboardView,
  pointIdByPointKey: ReadonlyMap<string, string>,
): ViewPlan {
  const widgets = view.widgets ?? [];
  return widgets.length > 0
    ? planAuthoredWidgets(viewName, widgets, pointIdByPointKey)
    : planFeaturedTiles(viewName, view.featured, pointIdByPointKey);
}

/**
 * The order the views of one template are written in — ADR 0067 decision 3.
 *
 * **A stated order, because there is no stored one.** `asset_templates.content`
 * is `jsonb`, which does NOT preserve the authored key order: Postgres stores
 * object keys by length and then bytewise, so a template authored
 * `overview, trends` comes back `trends, overview`. Record order is therefore
 * unrecoverable at any cost, and the choice is between Postgres' internal
 * ordering and one this repository states. A stated one, because the report's
 * array order and the order the rows are written in are both observable, and
 * pinning them to a storage detail would make them change under a Postgres
 * upgrade with no line of this repository edited.
 *
 * **Code points, not code units, and not `localeCompare`.** The ADR says code
 * point, and the two differ: `<` on strings compares UTF-16 code units, which
 * sorts every astral character (a `D800`–`DBFF` lead surrogate) below `U+E000`
 * and above — `U+1F600` before `U+FB00`. ICU collation is refused for the same
 * reason the order is stated at all: it moves with the Node build.
 *
 * Lives here rather than in the service because it is a function of its
 * argument, and a sort no test can reach is a sort that drifts.
 */
export function sortedViewNames(views: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(views).sort(compareByCodePoint);
}

/**
 * `a` against `b`, one code point at a time.
 *
 * Written as a loop over `Array.from` rather than as a comparison of the two
 * arrays: `[...a] < [...b]` coerces both back to strings and compares code
 * units again, which is the bug this function exists to avoid.
 */
function compareByCodePoint(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const x = a[index]?.codePointAt(0) ?? 0;
    const y = b[index]?.codePointAt(0) ?? 0;
    if (x !== y) {
      return x - y;
    }
  }
  return a.length - b.length;
}

/**
 * How many `dashboard_widgets` rows one asset costs, across every view.
 *
 * Counted with the same branch `planView` takes, so the bound below is measured
 * against what will actually be written rather than against the authored widget
 * lists only — a template whose views are all `featured`-driven would otherwise
 * be counted as zero.
 */
export function dashboardWidgetRowsFor(
  views: Readonly<Record<string, TemplateDashboardView>>,
): number {
  let rows = 0;
  for (const view of Object.values(views)) {
    const widgets = view.widgets ?? [];
    rows +=
      widgets.length > 0 ? widgets.length : Math.min(view.featured.length, MAX_DASHBOARD_WIDGETS);
  }
  return rows;
}

/**
 * Keeps one instantiate transaction inside {@link MAX_DASHBOARD_WIDGET_ROWS}.
 *
 * A `BadRequestException`, because an over-large batch is the caller's own
 * request rather than a server fault, and because the shape matches
 * `assertBatchFits`' two existing bounds one table over — a caller that splits
 * its batch for points should read the same sentence when it must split it for
 * dashboards.
 */
export function assertDashboardBatchFits(assetCount: number, widgetCount: number): void {
  const rows = assetCount * widgetCount;
  if (rows > MAX_DASHBOARD_WIDGET_ROWS) {
    throw new BadRequestException(
      `This batch would create ${rows} dashboard widgets (${assetCount} assets × ` +
        `${widgetCount} widgets per asset), over the ${MAX_DASHBOARD_WIDGET_ROWS} limit for ` +
        "one call. Split it into smaller batches.",
    );
  }
}
