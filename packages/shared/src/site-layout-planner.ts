// Type-only, and erased at emit: the `./ingest` precedent for an import back from the index.
import type { SectionTemplateWidget, SiteLayoutOmittedTile, SiteTemplateTab, TemplateWidgetPlan } from "./index";

/**
 * `F3.73` plan D5 — the site-layout planner: which asset group each tab of a site template binds
 * at one site, which tabs the site cannot hold, and which Overview cards go with them.
 *
 * **Pure, and shared by the two writers of a copy**: the API's copy action
 * (`SiteLayoutService`) and the boot seed (`site-layout-seed.ts`). Both must make the same
 * layout from the same site, so the rule is written once, here. It holds no widget
 * configuration (the content is `@bms/shared/site-templates`), so the index exports it.
 *
 * **The order, per tab (OQ1, ruled 2026-09-30)**: (1) the caller's `choice` for the tab; (2) the
 * untaken group of the tab's domain whose code is the tab's `groupCode`; (3) the single untaken
 * group of the tab's domain; (4) else the tab is **ambiguous** when two or more remain and
 * **omitted** when none does. A tab with `domain: null` is the Overview and binds no group.
 *
 * **Each step runs over every tab before the next step starts.** So a choice or a `groupCode`
 * match is never pre-empted by an earlier tab that took the same group as its single candidate:
 * on a site that holds only `ups-battery`, the `ups` tab takes it by `groupCode` and `sld` is
 * omitted, where a tab-at-a-time walk would give it to `sld` and omit `ups`. Within one step the
 * tabs run in `sortOrder`.
 *
 * **A choice names a group by `id`**, never by code: the API body carries uuids, and a code is
 * not unique across sites. The seed resolves its codes to ids before it calls this.
 *
 * **A refused choice refuses the whole plan**, and the result says which guard fired. The
 * `status` union makes a caller read that before it can reach a tab: a planner that bound the
 * other tabs around a bad choice would make a layout nobody asked for.
 */

/** One asset group at the site, as the planner reads it. `domain` null = a formula group. */
export type SiteLayoutGroup = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly domain: string | null;
};

/** The tab fields the pick reads — `SiteTemplateTab` satisfies it. */
export type SiteLayoutTabSpec = {
  readonly key: string;
  readonly sortOrder: number;
  readonly domain: string | null;
  readonly groupCode?: string;
};

/** Tab key → the id of the group the caller picked for it. */
export type SiteLayoutChoice = Readonly<Record<string, string>>;

/** How a kept tab got its group. */
export type SiteLayoutResolvedVia = "overview" | "choice" | "group_code" | "single";

/**
 * Why a choice was refused. Closed: the copy action answers each with its own 400 sentence, and a
 * test asserts which one fired.
 */
export const SITE_LAYOUT_CHOICE_REFUSALS = [
  "unknown_tab",
  "overview_tab",
  "unknown_group",
  "wrong_domain",
  "taken",
] as const;
export type SiteLayoutChoiceRefusal = (typeof SITE_LAYOUT_CHOICE_REFUSALS)[number];

export type SiteLayoutPickedTab<T> = {
  readonly tab: T;
  readonly group: SiteLayoutGroup | null;
  readonly via: SiteLayoutResolvedVia;
};

export type SiteLayoutCandidate = { readonly id: string; readonly code: string; readonly name: string };

export type SiteLayoutAmbiguousTab = {
  readonly tabKey: string;
  readonly domain: string;
  readonly candidates: readonly SiteLayoutCandidate[];
};

export type SiteLayoutOmittedTab = { readonly tabKey: string; readonly domain: string };

export type SiteLayoutRefusedChoice = {
  readonly tabKey: string;
  readonly reason: SiteLayoutChoiceRefusal;
};

export type SiteLayoutPick<T> =
  | {
      readonly status: "planned";
      readonly tabs: readonly SiteLayoutPickedTab<T>[];
      readonly omitted: readonly SiteLayoutOmittedTab[];
    }
  | {
      readonly status: "ambiguous";
      readonly ambiguous: readonly SiteLayoutAmbiguousTab[];
      readonly omitted: readonly SiteLayoutOmittedTab[];
    }
  | { readonly status: "refused"; readonly refused: readonly SiteLayoutRefusedChoice[] };

function inSortOrder<T extends SiteLayoutTabSpec>(tabs: readonly T[]): T[] {
  // `Array.prototype.sort` is stable, so equal `sortOrder`s keep the template's order.
  return [...tabs].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Bind each tab to at most one group of `groups` (plan D5). */
export function pickTabGroups<T extends SiteLayoutTabSpec>(
  tabs: readonly T[],
  groups: readonly SiteLayoutGroup[],
  choice: SiteLayoutChoice = {},
): SiteLayoutPick<T> {
  const ordered = inSortOrder(tabs);
  const byKey = new Map(ordered.map((tab) => [tab.key, tab]));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const taken = new Set<string>();
  const bound = new Map<string, { group: SiteLayoutGroup; via: SiteLayoutResolvedVia }>();

  // Step 1 — the caller's choices, validated in tab order, then any choice for no tab.
  const refused: SiteLayoutRefusedChoice[] = [];
  const chosenKeys = [
    // Own keys only: `in` would read `Object.prototype`, and `constructor` is a legal tab key.
    ...ordered.map((tab) => tab.key).filter((key) => Object.hasOwn(choice, key)),
    ...Object.keys(choice).filter((key) => !byKey.has(key)),
  ];
  for (const tabKey of chosenKeys) {
    const tab = byKey.get(tabKey);
    const group = byId.get(choice[tabKey] as string);
    const reason: SiteLayoutChoiceRefusal | null =
      tab === undefined
        ? "unknown_tab"
        : tab.domain === null
          ? "overview_tab"
          : group === undefined
            ? "unknown_group"
            : group.domain !== tab.domain
              ? "wrong_domain"
              : taken.has(group.id)
                ? "taken"
                : null;
    if (reason !== null || group === undefined) {
      refused.push({ tabKey, reason: reason ?? "unknown_group" });
      continue;
    }
    taken.add(group.id);
    bound.set(tabKey, { group, via: "choice" });
  }
  if (refused.length > 0) {
    return { status: "refused", refused };
  }

  const untaken = (domain: string): SiteLayoutGroup[] =>
    groups.filter((group) => group.domain === domain && !taken.has(group.id));
  const open = ordered.filter(
    (tab): tab is T & { domain: string } => tab.domain !== null && !bound.has(tab.key),
  );

  // Step 2 — the tab's own `groupCode`, within its domain.
  for (const tab of open) {
    const match = untaken(tab.domain).find((group) => group.code === tab.groupCode);
    if (tab.groupCode !== undefined && match !== undefined) {
      taken.add(match.id);
      bound.set(tab.key, { group: match, via: "group_code" });
    }
  }

  // Step 3 — the single untaken candidate; step 4 — ambiguous or omitted.
  const ambiguous: SiteLayoutAmbiguousTab[] = [];
  const omitted: SiteLayoutOmittedTab[] = [];
  for (const tab of open) {
    if (bound.has(tab.key)) continue;
    const candidates = untaken(tab.domain);
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      taken.add(only.id);
      bound.set(tab.key, { group: only, via: "single" });
    } else if (candidates.length === 0) {
      omitted.push({ tabKey: tab.key, domain: tab.domain });
    } else {
      ambiguous.push({
        tabKey: tab.key,
        domain: tab.domain,
        candidates: candidates.map(({ id, code, name }) => ({ id, code, name })),
      });
    }
  }
  if (ambiguous.length > 0) {
    return { status: "ambiguous", ambiguous, omitted };
  }

  const picked: SiteLayoutPickedTab<T>[] = [];
  for (const tab of ordered) {
    const hit = bound.get(tab.key);
    if (tab.domain === null) {
      picked.push({ tab, group: null, via: "overview" });
    } else if (hit !== undefined) {
      picked.push({ tab, group: hit.group, via: hit.via });
    }
  }
  return { status: "planned", tabs: picked, omitted };
}

/**
 * A `module_summary_card` removed because the tab it opens is not in the copy, or (`F3.74`) an
 * Overview `mimic` removed because the tab its `config.tabKey` resolves through is not;
 * `targetTabKey` is that tab.
 */
export type SiteLayoutDroppedCard = {
  readonly tabKey: string;
  readonly widgetKey: string;
  readonly targetTabKey: string;
};

export type SiteLayoutPlan =
  | {
      readonly status: "planned";
      readonly tabs: readonly SiteLayoutPickedTab<SiteTemplateTab>[];
      readonly omitted: readonly SiteLayoutOmittedTab[];
      readonly droppedCards: readonly SiteLayoutDroppedCard[];
    }
  | Exclude<SiteLayoutPick<SiteTemplateTab>, { status: "planned" }>;

/**
 * Pick the groups, then drop every `module_summary_card` whose `targetTabKey` is not a kept tab.
 *
 * The write path refuses a card naming no tab of the dashboard (plan D2), so a card left
 * pointing at an omitted tab would make the copy unsaveable. The kept tabs' widgets are new
 * arrays; the template's content is never mutated.
 *
 * `F3.74` (plan D7) — an Overview `mimic` whose `config.tabKey` names a tab that is not kept is
 * dropped and reported the same way: the write path refuses it (`MIMIC_TAB_MESSAGE`), and it
 * would draw every node unassigned. A mimic on a kept domain tab stays: its own tab's group wins.
 */
export function planSiteLayout(
  tabs: readonly SiteTemplateTab[],
  groups: readonly SiteLayoutGroup[],
  choice: SiteLayoutChoice = {},
): SiteLayoutPlan {
  const pick = pickTabGroups(tabs, groups, choice);
  if (pick.status !== "planned") {
    return pick;
  }
  const kept = new Set(pick.tabs.map((row) => row.tab.key));
  const droppedCards: SiteLayoutDroppedCard[] = [];
  const keepsItsTarget = (tab: SiteTemplateTab, widget: SectionTemplateWidget): boolean => {
    const tabKey = tab.key;
    // A mimic on a domain tab resolves through its own tab's group first, so only the Overview's
    // (no group of its own) depends on the tab it names.
    const target =
      widget.widgetType === "module_summary_card"
        ? widget.config.targetTabKey
        : widget.widgetType === "mimic" && tab.domain === null
          ? widget.config.tabKey
          : undefined;
    if (target === undefined || kept.has(target)) {
      return true;
    }
    droppedCards.push({ tabKey, widgetKey: widget.key, targetTabKey: target });
    return false;
  };
  const planned = pick.tabs.map((row) => ({
    ...row,
    tab: { ...row.tab, widgets: packAfterRemoval(row.tab.widgets, (widget) => keepsItsTarget(row.tab, widget)) },
  }));
  return { status: "planned", tabs: planned, omitted: pick.omitted, droppedCards };
}

/** The rect fields the pack reads and writes. */
export type SiteLayoutGridBox = {
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
};

/**
 * The widgets `keep` accepts, packed so a removal leaves no hole (the F3.73 design critique: a
 * PHE Overview kept its `sld` and `env` cards at columns 0 and 8, four empty slots apart).
 *
 * **Left, per row.** In each row (`gridY`) a removed widget stood in, the kept widgets of that row
 * move left in their order there, edge to edge from the row's first column. A row nothing was
 * removed from keeps its gaps: those are the template's, not the copy's. A kept widget of another
 * row that shares grid rows with the one moving (a tall widget reaching down from above, or one
 * below that a tall mover reaches into) is stepped around, never overlapped: no writer of a copy
 * checks for overlap, and the canvas draws one.
 *
 * **Up, per emptied row.** A grid row a removed widget covered and no kept widget covers is gone,
 * and every kept widget below it moves up one. The canvas places each widget at its own `gridY`
 * and does not compact, so a tab that lost its whole tile row would otherwise open on a blank
 * band.
 *
 * Pure: the widgets come back as new objects, in input order, and the input is never mutated
 * (it is the shared stock template's own content).
 */
export function packAfterRemoval<W extends SiteLayoutGridBox>(
  widgets: readonly W[],
  keep: (widget: W, index: number) => boolean,
): W[] {
  const kept = widgets.map((widget, index) => keep(widget, index));
  const removed = widgets.filter((_, index) => !kept[index]);
  const newX = new Map<number, number>();
  const xOf = (index: number): number => newX.get(index) ?? (widgets[index] as W).gridX;
  const spansMeet = (a: W, b: W): boolean => a.gridY < b.gridY + b.gridH && b.gridY < a.gridY + a.gridH;
  for (const rowY of [...new Set(removed.map((widget) => widget.gridY))].sort((a, b) => a - b)) {
    const row = widgets.flatMap((widget, index) => (widget.gridY === rowY ? [index] : []));
    let x = Math.min(...row.map((index) => (widgets[index] as W).gridX));
    const keptRow = row
      .filter((index) => kept[index])
      .sort((a, b) => (widgets[a] as W).gridX - (widgets[b] as W).gridX || a - b);
    for (const index of keptRow) {
      const widget = widgets[index] as W;
      // A kept widget of another row that shares grid rows with this one is an obstacle: one
      // from a higher row reaching down, or one below that this widget reaches into.
      const obstacles = widgets.flatMap((other, at) =>
        kept[at] && other.gridY !== rowY && spansMeet(widget, other) ? [{ x: xOf(at), w: other.gridW }] : [],
      );
      let placed = x;
      for (let moved = true; moved; ) {
        moved = false;
        for (const obstacle of obstacles) {
          if (placed < obstacle.x + obstacle.w && obstacle.x < placed + widget.gridW) {
            placed = obstacle.x + obstacle.w;
            moved = true;
          }
        }
      }
      // Never right of where the template put it: that place was free, the rows before it only
      // moved left.
      placed = Math.min(placed, widget.gridX);
      newX.set(index, placed);
      x = placed + widget.gridW;
    }
  }
  const covers = (widget: W, y: number): boolean => y >= widget.gridY && y < widget.gridY + widget.gridH;
  const emptied = new Set<number>();
  for (const widget of removed) {
    for (let y = widget.gridY; y < widget.gridY + widget.gridH; y += 1) {
      if (!widgets.some((other, index) => kept[index] && covers(other, y))) emptied.add(y);
    }
  }
  return widgets.flatMap((widget, index) => {
    if (!kept[index]) return [];
    const lift = [...emptied].filter((y) => y < widget.gridY).length;
    return [{ ...widget, gridX: newX.get(index) ?? widget.gridX, gridY: widget.gridY - lift }];
  });
}

/**
 * Whether a widget is a role-bound value tile that bound no point: it names a role, reads no
 * catalog source, and resolved nothing. **Zero points, not the `unresolved` outcome**: a role
 * whose members all lack the point key reports `partial` and binds nothing just the same.
 * Such a tile shows "—" for good and fails the builder's save rule
 * (`bindingRequiredMessage`), so a copy never carries one.
 */
export function isUnboundRoleTile(
  widget: Pick<SectionTemplateWidget, "widgetType" | "bindings" | "sources">,
  boundPoints: number,
): boolean {
  return (
    widget.widgetType === "value_tile" && widget.bindings.length > 0 && widget.sources.length === 0 && boundPoints === 0
  );
}

/**
 * One tab's widget plans without its unbound role tiles ({@link isUnboundRoleTile}), the rest
 * packed by {@link packAfterRemoval}. Runs after `planTemplateWidget`, in both writers of a copy
 * (the API's `SiteLayoutService` and the seed), so the two leave out the same tiles.
 */
export function omitUnboundTiles(
  tabKey: string,
  plans: readonly TemplateWidgetPlan[],
): { plans: TemplateWidgetPlan[]; omittedTiles: SiteLayoutOmittedTile[] } {
  const omit = plans.map((plan) => isUnboundRoleTile(plan.widget, plan.points.length));
  const omittedTiles = plans.flatMap((plan, index) => (omit[index] ? [{ tabKey, widgetKey: plan.widget.key }] : []));
  const packed = packAfterRemoval(
    plans.map((plan) => plan.widget),
    (_, index) => !omit[index],
  );
  const keptPlans = plans.filter((_, index) => !omit[index]);
  return {
    plans: keptPlans.map((plan, index) => ({ ...plan, widget: packed[index] as SectionTemplateWidget })),
    omittedTiles,
  };
}

/** The asset domains present at a site, sorted and unique; an asset with no domain adds none. */
export function domainsPresent(assets: readonly { readonly domain: string | null }[]): string[] {
  const domains = new Set<string>();
  for (const asset of assets) {
    if (asset.domain !== null) domains.add(asset.domain);
  }
  return [...domains].sort();
}

/** One group the copy action makes on a site that has none (plan D6). */
export type SiteLayoutGroupToCreate = {
  readonly code: string;
  readonly domain: string;
  readonly assetIds: readonly string[];
};

/**
 * The groups to make before the pick — plan D6, read literally: **only when the site holds no
 * group at all**, one per domain present, `code = domain`, members = the site's assets of that
 * domain, roles NULL (the caller writes them). A site with any group gets none, so a copy never
 * adds a second group beside one an administrator made; its domains without a group are omitted
 * tabs, which the result reports.
 */
export function groupsToCreate(
  assets: readonly { readonly id: string; readonly domain: string | null }[],
  existingGroups: readonly unknown[],
): SiteLayoutGroupToCreate[] {
  if (existingGroups.length > 0) {
    return [];
  }
  return domainsPresent(assets).map((domain) => ({
    code: domain,
    domain,
    assetIds: assets.filter((asset) => asset.domain === domain).map((asset) => asset.id),
  }));
}
