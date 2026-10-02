import {
  isUnboundRoleTile,
  packAfterRemoval,
  type SectionTemplateContent,
  type SectionTemplateWidget,
} from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  canonicalJson,
  type GridRect,
  OVERVIEW_TAB_KEY,
  SLD_TAB_KEY,
  siteWidgetIdentity,
  smocStandardV2Content,
  smocStandardV3Content,
} from "./site-layout-stock-history";

/**
 * The per-tab steps of the SMOC standard site layout's seed upgrade chain that reshape a tab by
 * its config as well as its rects: the v2 → v3 Overview (`F3.77`, ADR 0087 Amendment 3) and the
 * v3 → v4 Overview and electrical tab (`F3.74`, ADR 0088 Amendment 2). One planner,
 * {@link planTabUpgrade}, holds the gate all three share; the wrappers say what "as the copy rule
 * left it" means for each tab and version. The runner is `site-layout-seed-upgrade.ts`.
 *
 * **The gate (ADR 0088 Amendment 2, "What untouched means for v4").** A tab moves only while its
 * stored widgets equal the previous version's tab as the copy rule left it: the same identities
 * (tab key, widget type, title), none repeated, nothing added, nothing deleted, the same rects,
 * the same `config` compared without key order, and the binding rows the copy rule wrote. Anything
 * else is an administrator's tab, left whole. Each tab is gated on its own (OQ-A: per tab).
 *
 * **Both shapes go through the copy rule.** The previous and the next tab are packed by the same
 * `packAfterRemoval` and the same keep rule the copy action runs, so an upgraded tab lands where a
 * fresh copy of the next version would.
 */

/** One stored widget of a copy, with its `config` and its point and source row counts. */
export type TabCopyWidget = GridRect & {
  readonly id: string;
  readonly tabKey: string;
  readonly widgetType: string;
  readonly title: string | null;
  readonly points: number;
  readonly sources: number;
  readonly config: unknown;
};

/** Whether a stored widget holds the binding rows the copy rule wrote for its template widget. */
export type TabBindingRule = (template: SectionTemplateWidget, row: TabCopyWidget) => boolean;

/** A tab step's writes. Every op carries the values read, for the write's predicate. */
export type TabUpgradePlan = {
  /** Widgets the next version no longer holds. */
  readonly deletes: readonly { id: string; widgetType: string; from: GridRect; config: unknown }[];
  /** Widgets whose config changes (their rect may change too). */
  readonly updates: readonly {
    id: string;
    title: string | null;
    from: GridRect;
    fromConfig: unknown;
    to: GridRect;
    toConfig: unknown;
  }[];
  /** Widgets whose rect alone changes. */
  readonly moves: readonly { id: string; from: GridRect; to: GridRect }[];
  /** Widgets new in the next version: no binding and no source row, by construction. */
  readonly inserts: readonly { tabKey: string; widgetType: string; title: string | null; to: GridRect; config: unknown }[];
};

const NONE: TabUpgradePlan = { deletes: [], updates: [], moves: [], inserts: [] };

function sameRect(a: GridRect, b: GridRect): boolean {
  return a.gridX === b.gridX && a.gridY === b.gridY && a.gridW === b.gridW && a.gridH === b.gridH;
}

const rectOf = (widget: GridRect): GridRect => ({
  gridX: widget.gridX,
  gridY: widget.gridY,
  gridW: widget.gridW,
  gridH: widget.gridH,
});

/**
 * Tab `tabKey`'s writes, from `expected` (the previous version's tab as the copy rule left it) to
 * `target` (the next version's tab as the copy rule leaves it), or nothing when the stored tab is
 * not exactly `expected` (the gate above; `bound` is the binding rule). In a matching tab, a widget
 * `target` lacks is deleted, one whose config differs is updated, one whose rect alone differs is
 * moved, and a widget only `target` holds is inserted. Ops come in `expected`'s order, inserts in
 * `target`'s.
 *
 * A widget new in `target` that holds a binding or a source throws: the runner inserts the widget
 * row only, and such a widget would land with nothing bound.
 */
export function planTabUpgrade(
  tabKey: string,
  widgets: readonly TabCopyWidget[],
  expected: readonly SectionTemplateWidget[],
  target: readonly SectionTemplateWidget[],
  bound: TabBindingRule,
): TabUpgradePlan {
  const identity = (widget: { widgetType: string; title: string | null }): string =>
    siteWidgetIdentity(tabKey, widget.widgetType, widget.title);
  const stored = widgets.filter((widget) => widget.tabKey === tabKey);
  const byIdentity = new Map(stored.map((widget) => [identity(widget), widget]));
  if (byIdentity.size !== stored.length || stored.length !== expected.length) return NONE;
  const exact = expected.every((widget) => {
    const row = byIdentity.get(identity(widget));
    return (
      row !== undefined &&
      sameRect(row, widget) &&
      canonicalJson(row.config) === canonicalJson(widget.config) &&
      bound(widget, row)
    );
  });
  if (!exact) return NONE;

  const next = new Map(target.map((widget) => [identity(widget), widget]));
  const previous = new Set(expected.map(identity));
  const deletes: TabUpgradePlan["deletes"][number][] = [];
  const updates: TabUpgradePlan["updates"][number][] = [];
  const moves: TabUpgradePlan["moves"][number][] = [];
  for (const widget of expected) {
    const row = byIdentity.get(identity(widget)) as TabCopyWidget;
    const to = next.get(identity(widget));
    if (to === undefined) {
      deletes.push({ id: row.id, widgetType: row.widgetType, from: rectOf(row), config: row.config });
    } else if (canonicalJson(row.config) !== canonicalJson(to.config)) {
      updates.push({ id: row.id, title: row.title, from: rectOf(row), fromConfig: row.config, to: rectOf(to), toConfig: to.config });
    } else if (!sameRect(row, to)) {
      moves.push({ id: row.id, from: rectOf(row), to: rectOf(to) });
    }
  }
  const inserts = target
    .filter((widget) => !previous.has(identity(widget)))
    .map((widget) => {
      if (widget.bindings.length > 0 || widget.sources.length > 0) {
        throw new Error(`planTabUpgrade: ${identity(widget)} is new and holds a binding or a source, which a step does not insert`);
      }
      return { tabKey, widgetType: widget.widgetType, title: widget.title, to: rectOf(widget), config: widget.config };
    });
  return { deletes, updates, moves, inserts };
}

function tabOf(content: SectionTemplateContent, key: string): SectionTemplateContent["tabs"][number] | undefined {
  return content.tabs.find((tab) => tab.key === key);
}

/**
 * The Overview's copy rule: a module card is kept only when its target tab is one of the copy's
 * tabs, and a mimic that names a tab (`config.tabKey`) only when that tab is (`planSiteLayout`).
 */
function overviewKeep(copyTabKeys: readonly string[]): (widget: SectionTemplateWidget) => boolean {
  const tabs = new Set(copyTabKeys);
  return (widget) => {
    if (widget.widgetType === "module_summary_card") return tabs.has(widget.config.targetTabKey);
    if (widget.widgetType === "mimic" && widget.config.tabKey !== undefined) return tabs.has(widget.config.tabKey);
    return true;
  };
}

/** The Overview's bindings as the copy wrote them: no point row, a source row per template source. */
const overviewBound: TabBindingRule = (template, row) => row.points === 0 && row.sources === template.sources.length;

function planOverview(
  widgets: readonly TabCopyWidget[],
  copyTabKeys: readonly string[],
  from: SectionTemplateContent,
  to: SectionTemplateContent,
): TabUpgradePlan {
  const fromTab = tabOf(from, OVERVIEW_TAB_KEY);
  const toTab = tabOf(to, OVERVIEW_TAB_KEY);
  if (!fromTab || !toTab) return NONE;
  const keep = overviewKeep(copyTabKeys);
  return planTabUpgrade(
    OVERVIEW_TAB_KEY,
    widgets,
    packAfterRemoval(fromTab.widgets, keep),
    packAfterRemoval(toTab.widgets, keep),
    overviewBound,
  );
}

/** The v2 → v3 Overview step's writes: deletes, updates (rect or config) and inserts. */
export type OverviewV3UpgradePlan = Pick<TabUpgradePlan, "deletes" | "updates" | "inserts">;

/**
 * The v2 → v3 Overview step (`F3.77` plan D5, ADR 0087 Amendment 3): `from` defaults to the frozen
 * v2, `to` to the frozen v3, never the live entry (v4 since `F3.74`). In a matching Overview, v3
 * deletes every module card and updates everything else; a rect-only change is an update here,
 * and the updates keep `from`'s template order, as the step always wrote them.
 */
export function planOverviewV3Upgrade(
  widgets: readonly TabCopyWidget[],
  copyTabKeys: readonly string[],
  from: SectionTemplateContent = smocStandardV2Content(),
  to: SectionTemplateContent = smocStandardV3Content(),
): OverviewV3UpgradePlan {
  const plan = planOverview(widgets, copyTabKeys, from, to);
  const rows = new Map(widgets.map((widget) => [widget.id, widget]));
  const toConfig = new Map(
    (tabOf(to, OVERVIEW_TAB_KEY)?.widgets ?? []).map((widget) => [
      siteWidgetIdentity(OVERVIEW_TAB_KEY, widget.widgetType, widget.title),
      widget.config,
    ]),
  );
  const order = new Map(
    (tabOf(from, OVERVIEW_TAB_KEY)?.widgets ?? []).map((widget, index) => [
      siteWidgetIdentity(OVERVIEW_TAB_KEY, widget.widgetType, widget.title),
      index,
    ]),
  );
  const identityOf = (id: string): string => {
    const row = rows.get(id) as TabCopyWidget;
    return siteWidgetIdentity(OVERVIEW_TAB_KEY, row.widgetType, row.title);
  };
  const moved = plan.moves.map((op) => {
    const row = rows.get(op.id) as TabCopyWidget;
    return { id: op.id, title: row.title, from: op.from, fromConfig: row.config, to: op.to, toConfig: toConfig.get(identityOf(op.id)) };
  });
  const updates = [...plan.updates, ...moved].sort(
    (a, b) => (order.get(identityOf(a.id)) ?? 0) - (order.get(identityOf(b.id)) ?? 0),
  );
  return { deletes: plan.deletes, updates, inserts: plan.inserts };
}

/**
 * The v3 → v4 Overview step (ADR 0088 Amendment 2): one insert, the compact electrical diagram at
 * `(0, 9)`, and one move, the class strip from `(0, 9, 12, 2)` to `(6, 9, 6, 2)`. A copy with no
 * `sld` tab gets no diagram, and its strip is packed to `(0, 9, 6, 2)`, as a fresh copy has it.
 */
export function planOverviewV4Upgrade(
  widgets: readonly TabCopyWidget[],
  copyTabKeys: readonly string[],
  from: SectionTemplateContent = smocStandardV3Content(),
  to: SectionTemplateContent = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent,
): TabUpgradePlan {
  return planOverview(widgets, copyTabKeys, from, to);
}

/** A role tile: a value tile that binds a role and reads no catalog source. */
const isRoleTile = (widget: SectionTemplateWidget): boolean => isUnboundRoleTile(widget, 0);

/**
 * The v3 → v4 electrical step (ADR 0088 Amendment 2): the mimic's config from
 * `electrical_distribution` to `lv_single_line`, the "Breakers" table inserted under it, and the
 * alarm rail and asset table moved down by its height. The copy rule is the copy's
 * `omitUnboundTiles`: a role tile the store does not hold counts as left out, and both sides are
 * packed without it. A role tile present must hold a point row; every other widget holds none,
 * and each holds a source row per template source.
 */
export function planElectricalV4Upgrade(
  widgets: readonly TabCopyWidget[],
  from: SectionTemplateContent = smocStandardV3Content(),
  to: SectionTemplateContent = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent,
): TabUpgradePlan {
  const fromTab = tabOf(from, SLD_TAB_KEY);
  const toTab = tabOf(to, SLD_TAB_KEY);
  if (!fromTab || !toTab) return NONE;
  const held = new Set(
    widgets
      .filter((widget) => widget.tabKey === SLD_TAB_KEY)
      .map((widget) => siteWidgetIdentity(SLD_TAB_KEY, widget.widgetType, widget.title)),
  );
  const keep = (widget: SectionTemplateWidget): boolean =>
    !isRoleTile(widget) || held.has(siteWidgetIdentity(SLD_TAB_KEY, widget.widgetType, widget.title));
  const bound: TabBindingRule = (template, row) =>
    (isRoleTile(template) ? row.points >= 1 : row.points === 0) && row.sources === template.sources.length;
  return planTabUpgrade(
    SLD_TAB_KEY,
    widgets,
    packAfterRemoval(fromTab.widgets, keep),
    packAfterRemoval(toTab.widgets, keep),
    bound,
  );
}
