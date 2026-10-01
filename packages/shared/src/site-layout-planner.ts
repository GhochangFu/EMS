// Type-only, and erased at emit: the `./ingest` precedent for an import back from the index.
import type { SectionTemplateWidget, SiteTemplateTab } from "./index";

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

/** A `module_summary_card` removed because the tab it opens is not in the copy. */
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
  const keepsItsTarget = (tabKey: string, widget: SectionTemplateWidget): boolean => {
    if (widget.widgetType !== "module_summary_card" || kept.has(widget.config.targetTabKey)) {
      return true;
    }
    droppedCards.push({ tabKey, widgetKey: widget.key, targetTabKey: widget.config.targetTabKey });
    return false;
  };
  const planned = pick.tabs.map((row) => ({
    ...row,
    tab: { ...row.tab, widgets: row.tab.widgets.filter((widget) => keepsItsTarget(row.tab.key, widget)) },
  }));
  return { status: "planned", tabs: planned, omitted: pick.omitted, droppedCards };
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
