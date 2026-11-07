import type { SiteLayoutChoice, SiteLayoutHeldCopy, SiteLayoutReplaceOutcome } from "@bms/shared";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4) — the two pure rules of Replace, apart from
 * `SiteLayoutService` so a unit spec holds them without a database.
 */

/** A tab of the new version, as the carry rule reads it. */
export type ReplaceTab = { readonly key: string; readonly domain: string | null };

/** One tab of the copy being replaced: its key and the group it bound. */
export type ReplacedTab = { readonly tabKey: string; readonly assetGroupId: string | null };

/** One asset group at the site. */
export type ReplaceGroup = { readonly id: string; readonly domain: string | null };

/**
 * Decision 4 (S2) — the D5 tie-break choice a rebuilt copy runs with: the old copy's group for
 * every tab key the new version still has, and the request's `tabGroups` over it.
 *
 * An old pick is carried only where the planner would take it as a choice: the tab has a domain
 * (an Overview binds through its `groupCode`, and a choice on it is `overview_tab`), the group is
 * still at the site and of the tab's domain, and no other tab carries or chooses the same group
 * (`taken`). A pick that fails is dropped, so that tab falls back to the D5 rules instead of
 * refusing the Replace for a choice the admin never made.
 */
export function carriedTabGroups(
  tabs: readonly ReplaceTab[],
  oldTabs: readonly ReplacedTab[],
  groups: readonly ReplaceGroup[],
  choice: SiteLayoutChoice,
): SiteLayoutChoice {
  const tabByKey = new Map(tabs.map((tab) => [tab.key, tab]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const used = new Set<string>(Object.values(choice));
  const carried: Record<string, string> = {};
  for (const old of oldTabs) {
    if (old.assetGroupId === null || Object.hasOwn(choice, old.tabKey)) continue;
    const tab = tabByKey.get(old.tabKey);
    const group = groupById.get(old.assetGroupId);
    if (tab === undefined || tab.domain === null || group === undefined || group.domain !== tab.domain) continue;
    if (used.has(group.id)) continue;
    used.add(group.id);
    carried[old.tabKey] = group.id;
  }
  return { ...carried, ...choice };
}

/**
 * Decision 5 (S3) — what Replace does with the copy a site holds. Another template code is never
 * replaced; the same version is a skip in bulk and an explicit rebuild per site.
 */
export function replaceOutcome(
  held: SiteLayoutHeldCopy | null,
  template: { readonly code: string; readonly version: number },
  mode: "site" | "bulk",
): SiteLayoutReplaceOutcome {
  if (held === null) return "no_copy";
  if (held.templateCode !== template.code) return "other_template";
  if (mode === "bulk" && held.version === template.version) return "same_version";
  return "replace";
}
