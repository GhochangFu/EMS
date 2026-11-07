import {
  MAX_DASHBOARD_WIDGETS,
  placeTrendStrip,
  TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT,
  TREND_STRIP_WIDGET_MAX_POINTS,
} from "@bms/shared";
import type {
  AppendTrendStripWidgetsBody,
  SeriesRole,
  TrendStripPointStyle,
  SiteTrendPointsDto,
  TrendStripRange,
  TrendStripWidgetConfig,
} from "@bms/shared";

import { blankDashboardWidgetRow, type DashboardWidgetRow } from "./dashboard-builder-form";
import { WIDGET_CATALOG } from "./widget-catalog";
import { blankConfigRow, readTrendStripSelection } from "./widget-config-form";

/**
 * `F4.306` PR 2 U11 (ADR 0108 Amendment 7 items 5 and 6) — the trend strip wizard's pure half.
 * The dialog (`components/dashboards/trend-strip-wizard.tsx`) holds the steps; this module holds
 * every rule they apply: which tabs can take a strip, the default selection, the 30-point cap,
 * the stored config, where a strip lands in the builder's draft, and the append route's body.
 *
 * Both entry points read it: the builder passes its rows (`tabKey`) and the site view the stored
 * DTO (`tabId`), and {@link tabWidgetsOf} reads either shape. No segment or point code is named
 * here (§5.4 guard): the codes are data, read from the site's lists.
 */

/** One tab as either entry point holds it: the DTO's tab (with `id`) or the builder's write row. */
export type WizardTabInput = {
  readonly id?: string;
  readonly key: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly assetGroupId: string | null;
};

/** One widget as either entry point holds it: the DTO's (`tabId`) or the builder row's (`tabKey`). */
export type WizardWidgetInput = {
  readonly widgetType: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridH: number;
  readonly tabId?: string | null;
  readonly tabKey?: string;
};

export type WizardDashboard = {
  readonly tabs: readonly WizardTabInput[];
  readonly widgets: readonly WizardWidgetInput[];
};

/** One row of the Tabs step. `key: null` is a dashboard without tabs (its single canvas). */
export type WizardTab = {
  readonly key: string | null;
  readonly label: string;
  readonly assetGroupId: string | null;
  /** The tab holds a `trend_strip`, so the wizard replaces it. */
  readonly hasStrip: boolean;
  readonly count: number;
  /** Full and nothing to replace: an insert would be refused (409), so the step disables it. */
  readonly atCap: boolean;
};

/** The wizard's working selection. Empty lists mean "not chosen" and are never stored as `[]`. */
export type WizardSelection = {
  readonly segments: readonly string[];
  readonly points: readonly string[];
  readonly colors: Readonly<Record<string, SeriesRole>>;
  /** `F4.322` PR 3 (ADR 0108 Amendment 8) — a draw style per chosen point; absent is `line`. */
  readonly styles?: Readonly<Record<string, TrendStripPointStyle>>;
};

/** The label of a dashboard's single canvas when it has no tabs. */
export const TABLESS_TAB_LABEL = "Dashboard";

/** The selection key of one point: `<segment>:<point code>`, the stored form. */
export function selectionKey(segment: string, code: string): string {
  return `${segment}:${code}`;
}

/** The segment half of a selection key. A catalog code holds no `:`, so the first one splits. */
function segmentOf(key: string): string {
  return key.slice(0, key.indexOf(":"));
}

/**
 * The widgets on one tab, from either shape: a builder row by its `tabKey`, a DTO widget by its
 * `tabId`. `tab === null` (a dashboard without tabs) is every widget.
 */
export function tabWidgetsOf<W extends WizardWidgetInput>(
  widgets: readonly W[],
  tab: Pick<WizardTabInput, "id" | "key"> | null,
): W[] {
  if (tab === null) return [...widgets];
  return widgets.filter((widget) =>
    widget.tabKey !== undefined ? widget.tabKey === tab.key : widget.tabId != null && widget.tabId === tab.id,
  );
}

function tabRow(
  key: string | null,
  label: string,
  assetGroupId: string | null,
  widgets: readonly WizardWidgetInput[],
): WizardTab {
  const hasStrip = widgets.some((widget) => widget.widgetType === "trend_strip");
  const count = widgets.length;
  return { key, label, assetGroupId, hasStrip, count, atCap: count >= MAX_DASHBOARD_WIDGETS && !hasStrip };
}

/** The Tabs step's rows, in `sortOrder`; a dashboard without tabs is one row, `key: null`. */
export function wizardTabs(dashboard: WizardDashboard): WizardTab[] {
  if (dashboard.tabs.length === 0) {
    return [tabRow(null, TABLESS_TAB_LABEL, null, dashboard.widgets)];
  }
  return [...dashboard.tabs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((tab) => tabRow(tab.key, tab.label, tab.assetGroupId, tabWidgetsOf(dashboard.widgets, tab)));
}

/**
 * The selection the Points step opens on (plan D1): the first active points of each chosen
 * segment in list order — the whole-site strip's own count, `TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT`
 * — with segments in the order given, cut at `TREND_STRIP_WIDGET_MAX_POINTS` across them.
 */
export function defaultSelection(
  lists: SiteTrendPointsDto["segments"],
  segments: readonly string[],
): WizardSelection {
  const points: string[] = [];
  for (const code of segments) {
    const list = lists.find((entry) => entry.domain === code);
    if (list === undefined) continue;
    const first = list.points.filter((point) => point.active).slice(0, TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT);
    for (const point of first) points.push(selectionKey(code, point.code));
  }
  return { segments: [...segments], points: points.slice(0, TREND_STRIP_WIDGET_MAX_POINTS), colors: {} };
}

/**
 * Entering the Points step again: keep every chosen point and colour, and add the default points
 * ({@link defaultSelection}) only for `fresh` — the chosen segments that have not had their default
 * yet. The added points go after the kept ones and stop at `TREND_STRIP_WIDGET_MAX_POINTS`.
 */
export function addDefaultsFor(
  lists: SiteTrendPointsDto["segments"],
  selection: WizardSelection,
  fresh: readonly string[],
): WizardSelection {
  const added = defaultSelection(lists, fresh).points.filter((key) => !selection.points.includes(key));
  return { ...selection, points: [...selection.points, ...added].slice(0, TREND_STRIP_WIDGET_MAX_POINTS) };
}

/** Whether one more point fits under the cap. */
export function canAddPoint(selection: WizardSelection): boolean {
  return selection.points.length < TREND_STRIP_WIDGET_MAX_POINTS;
}

function withoutColors(
  colors: WizardSelection["colors"],
  drop: (key: string) => boolean,
): Record<string, SeriesRole> {
  return Object.fromEntries(Object.entries(colors).filter(([key]) => !drop(key)));
}

function withoutStyles(
  styles: WizardSelection["styles"],
  drop: (key: string) => boolean,
): Record<string, TrendStripPointStyle> {
  return Object.fromEntries(Object.entries(styles ?? {}).filter(([key]) => !drop(key)));
}

/** Choose a point, or unchoose it with its colour. A point past the cap is refused: no change. */
export function togglePoint(selection: WizardSelection, key: string): WizardSelection {
  if (selection.points.includes(key)) {
    return {
      segments: selection.segments,
      points: selection.points.filter((point) => point !== key),
      colors: withoutColors(selection.colors, (colored) => colored === key),
      ...(selection.styles ? { styles: withoutStyles(selection.styles, (styled) => styled === key) } : {}),
    };
  }
  if (!canAddPoint(selection)) return selection;
  return { ...selection, points: [...selection.points, key] };
}

/** Choose a segment (no point yet), or unchoose it with its points and their colours. */
export function toggleSegment(selection: WizardSelection, code: string): WizardSelection {
  if (!selection.segments.includes(code)) {
    return { ...selection, segments: [...selection.segments, code] };
  }
  return {
    segments: selection.segments.filter((segment) => segment !== code),
    points: selection.points.filter((key) => segmentOf(key) !== code),
    colors: withoutColors(selection.colors, (key) => segmentOf(key) === code),
    ...(selection.styles ? { styles: withoutStyles(selection.styles, (key) => segmentOf(key) === code) } : {}),
  };
}

/** Set a point's colour role; `null` (the "Default" option) deletes the key, so it draws `accent`. */
export function setPointColor(selection: WizardSelection, key: string, role: SeriesRole | null): WizardSelection {
  const colors = withoutColors(selection.colors, (colored) => colored === key);
  return { ...selection, colors: role === null ? colors : { ...colors, [key]: role } };
}

/** `F4.322` PR 3 — the style choice as the wizard names it: plain words, line first (the default). */
export const POINT_STYLE_LABELS: Readonly<Record<TrendStripPointStyle, string>> = {
  line: "Line",
  area: "Area",
  bar: "Bars",
};

/** `F4.322` PR 3 — set a point's draw style; `line` (the default) deletes the key. */
export function setPointStyle(selection: WizardSelection, key: string, style: TrendStripPointStyle): WizardSelection {
  const styles = withoutStyles(selection.styles, (styled) => styled === key);
  return { ...selection, styles: style === "line" ? styles : { ...styles, [key]: style } };
}

/**
 * The stored config for one tab, in the schema's key order. `tabKey` only on a tab bound to an
 * asset group (Amendment 3 item 4: the Overview draws the whole site); each selection field only
 * when non-empty (`.min(1)` refuses `[]`), and a colour only for a chosen point.
 */
export function stripConfigFor(
  selection: WizardSelection,
  range: TrendStripRange,
  tab: Pick<WizardTab, "key" | "assetGroupId">,
): TrendStripWidgetConfig {
  const colors = withoutColors(selection.colors, (key) => !selection.points.includes(key));
  const styles = withoutStyles(selection.styles, (key) => !selection.points.includes(key));
  return {
    ...(tab.key !== null && tab.assetGroupId !== null ? { tabKey: tab.key } : {}),
    defaultRange: range,
    ...(selection.segments.length > 0 ? { segments: [...selection.segments] } : {}),
    ...(selection.points.length > 0 ? { points: [...selection.points] } : {}),
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
  };
}

/**
 * The builder's draft with one tab's strip set (`tabKey` undefined: a dashboard without tabs).
 * `placeTrendStrip` (shared with the append route, owner OQ1) decides over that tab's rows only.
 * Replace keeps the row and rewrites its six strip fields (`styles` since `F4.322`), each `undefined` when the config lacks
 * it so a stale stored field goes; insert adds a strip at `gridX 0`, the tab's foot, the catalog's
 * size. Every other row is returned as it was.
 */
export function placeInDraft(
  rows: readonly DashboardWidgetRow[],
  tabKey: string | undefined,
  config: TrendStripWidgetConfig,
): DashboardWidgetRow[] {
  const positions = rows.flatMap((row, position) =>
    tabKey === undefined || row.tabKey === tabKey ? [position] : [],
  );
  const placement = placeTrendStrip(positions.map((position) => rows[position]));
  if (placement.kind === "replace") {
    const target = positions[placement.index];
    return rows.map((row, position) =>
      position !== target
        ? row
        : {
            ...row,
            config: {
              ...row.config,
              stripTabKey: config.tabKey,
              stripRange: config.defaultRange,
              stripSegments: config.segments,
              stripPoints: config.points,
              stripColors: config.colors,
              stripStyles: config.styles,
            },
          },
    );
  }
  const { w, h } = WIDGET_CATALOG.trend_strip.defaultSize;
  const inserted: DashboardWidgetRow = {
    ...blankDashboardWidgetRow("trend_strip"),
    ...(tabKey !== undefined ? { tabKey } : {}),
    gridX: 0,
    gridY: placement.gridY,
    gridW: w,
    gridH: h,
    config: {
      ...blankConfigRow(),
      ...(config.tabKey !== undefined ? { stripTabKey: config.tabKey } : {}),
      stripRange: config.defaultRange,
      ...readTrendStripSelection(config),
    },
  };
  return [...rows, inserted];
}

/** The append route's trend arm: one strip per chosen tab, in the order given (the Tabs step's). */
export function appendBodyFor(
  selection: WizardSelection,
  range: TrendStripRange,
  tabs: readonly Pick<WizardTab, "key" | "assetGroupId">[],
): AppendTrendStripWidgetsBody {
  return {
    widgetType: "trend_strip",
    strips: tabs.map((tab) => ({
      ...(tab.key !== null ? { tabKey: tab.key } : {}),
      config: stripConfigFor(selection, range, tab),
    })),
  };
}
