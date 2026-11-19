import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import {
  anyEnergyShown,
  groupByOrganization,
  groupSitesByParent,
  hasLiveTelemetry,
  orgSectionSummary,
  siteGroupRollup,
  siteLocations,
  splitByLiveTelemetry,
  splitGroupsByLive,
} from "./location-kpi-groups";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function site(opts: {
  id: string;
  name: string;
  organization: { id: string; code: string; name: string };
  freshAssetCount?: number;
  totalKw?: number | null;
  energyShown?: boolean;
  assetCount?: number;
  openAlarms?: number;
  parentId?: string | null;
}): LocationKpiSummary {
  return locationKpiSummarySchema.parse({
    id: opts.id,
    name: opts.name,
    code: `SITE-${opts.id}`,
    type: "smoc_campus",
    typeLabel: "SMOC campus",
    province: null,
    organization: opts.organization,
    rtuCount: 0,
    assetCount: opts.assetCount ?? 1,
    freshAssetCount: opts.freshAssetCount ?? 1,
    totalKw: opts.totalKw === undefined ? 0 : opts.totalKw,
    energyShown: opts.energyShown ?? true,
    primaryMetric: opts.energyShown === false ? "health" : "kw",
    healthScore: null,
    openAlarms: opts.openAlarms ?? 0,
    criticalAlarms: 0,
    scopeLabel: "full",
    parentId: opts.parentId ?? null,
  });
}

const ORG_A = { id: "org-a", code: "AAA", name: "Alpha" };

/** `K1` — `freshLocationCount` counts only the sites reporting fresh telemetry. */
export function runK1(): void {
  const locations = [
    site({ id: "a1", name: "A1", organization: ORG_A, freshAssetCount: 1 }),
    site({ id: "a2", name: "A2", organization: ORG_A, freshAssetCount: 0 }),
    site({ id: "a3", name: "A3", organization: ORG_A, freshAssetCount: 3 }),
  ];
  const summary = orgSectionSummary(locations);
  assert(
    summary.freshLocationCount === 2,
    `freshLocationCount must count only freshAssetCount > 0 — got ${summary.freshLocationCount}`,
  );
}

/** `K2` — organizations sort by code, and each organization's sites sort by name. */
export function runK2(): void {
  const ORG_Z = { id: "org-z", code: "ZZZ", name: "Zulu" };
  const items = [
    site({ id: "z1", name: "Zed", organization: ORG_Z }),
    site({ id: "a2", name: "Bravo Site", organization: ORG_A }),
    site({ id: "a1", name: "Alpha Site", organization: ORG_A }),
  ];
  const groups = groupByOrganization(items);
  assert(
    groups.map((g) => g.organization.code).join(",") === "AAA,ZZZ",
    `organizations must sort by code — got ${groups.map((g) => g.organization.code).join(",")}`,
  );
  assert(
    groups[0].locations.map((l) => l.name).join(",") === "Alpha Site,Bravo Site",
    `sites must sort by name within an organization — got ${groups[0].locations.map((l) => l.name).join(",")}`,
  );
}

/** `K3` (`F4.259`) — a site is live from one fresh asset; none is not live. */
export function runK3(): void {
  const none = site({ id: "n", name: "N", organization: ORG_A, freshAssetCount: 0 });
  const one = site({ id: "o", name: "O", organization: ORG_A, freshAssetCount: 1 });
  assert(!hasLiveTelemetry(none), "a site with no fresh asset must not be live");
  assert(hasLiveTelemetry(one), "a site with one fresh asset must be live");
}

/** `K4` (`F4.259`) — the split puts each site in one list and keeps the input order in both. */
export function runK4(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A, freshAssetCount: 0 }),
    site({ id: "a2", name: "A2", organization: ORG_A, freshAssetCount: 2 }),
    site({ id: "a3", name: "A3", organization: ORG_A, freshAssetCount: 0 }),
    site({ id: "a4", name: "A4", organization: ORG_A, freshAssetCount: 1 }),
  ];
  const { live, notLive } = splitByLiveTelemetry(items);
  const ids = (list: LocationKpiSummary[]) => list.map((l) => l.id).join(",");
  assert(ids(live) === "a2,a4", `live must be a2,a4 in order — got ${ids(live)}`);
  assert(ids(notLive) === "a1,a3", `notLive must be a1,a3 in order — got ${ids(notLive)}`);
}

/**
 * `K5` (`F4.364`, plan ruling Q4) — the section's kW sums the numbers over the locations that show
 * energy: a `null` (shown, no meter) adds nothing and a hidden location adds nothing even if a
 * number reached it.
 */
export function runK5(): void {
  const summary = orgSectionSummary([
    site({ id: "a1", name: "A1", organization: ORG_A, totalKw: 10 }),
    site({ id: "a2", name: "A2", organization: ORG_A, totalKw: null }),
    site({ id: "a3", name: "A3", organization: ORG_A, totalKw: 5, energyShown: false }),
    site({ id: "a4", name: "A4", organization: ORG_A, totalKw: 2.5 }),
  ]);
  assert(summary.totalKw === 12.5, `totalKw must be 12.5 (10 + 2.5) — got ${summary.totalKw}`);
}

/** `K6` (`F4.364`) — no location shows energy, or none that does has a kW value: the section's kW is `null`, not `0`. */
export function runK6(): void {
  const summary = orgSectionSummary([
    site({ id: "a1", name: "A1", organization: ORG_A, totalKw: null, energyShown: false }),
    site({ id: "a2", name: "A2", organization: ORG_A, totalKw: null, energyShown: false }),
  ]);
  assert(summary.totalKw === null, `totalKw must be null when no location shows energy — got ${summary.totalKw}`);
  // ADR 0133 decision 4 / ruling Q4: "no meter" is null, never 0 — an `on` section whose locations
  // have no kW value is null too, so the header shows no "0.0 kW".
  const shownNoMeter = orgSectionSummary([site({ id: "a3", name: "A3", organization: ORG_A, totalKw: null })]);
  assert(shownNoMeter.totalKw === null, `shown locations with no kW value must give null — got ${shownNoMeter.totalKw}`);
}

/** `K7` (`F4.375`, Q5/Q7) — some location shows energy; none, or an empty list, is `false`. */
export function runK7(): void {
  const hidden = site({ id: "a1", name: "A1", organization: ORG_A, totalKw: null, energyShown: false });
  const shown = site({ id: "a2", name: "A2", organization: ORG_A, totalKw: null });
  assert(anyEnergyShown([hidden, shown]), "one shown location must answer true");
  assert(!anyEnergyShown([hidden]), "only hidden locations must answer false");
  assert(!anyEnergyShown([]), "no location must answer false");
}

// ---------------------------------------------------------------------------
// `F4.240` (ADR 0139 decisions 13–16, plan D11) — site cards grouped under their parent.
// ---------------------------------------------------------------------------

const ids = (list: readonly LocationKpiSummary[]) => list.map((l) => l.id).join(",");

/** An asset-less parent: no asset, so no fresh asset. */
function parent(id: string, name: string, parentId: string | null = null): LocationKpiSummary {
  return site({ id, name, organization: ORG_A, assetCount: 0, freshAssetCount: 0, totalKw: null, parentId });
}

/** Six asset-less stations over twelve RTU sites (PHEWB after release C); `s1-1` alone is live. */
function phewbSplit(): LocationKpiSummary[] {
  const items: LocationKpiSummary[] = [];
  for (let station = 1; station <= 6; station += 1) {
    items.push(parent(`s${station}`, `Station ${station}`));
    for (const rtu of [1, 2]) {
      items.push(
        site({
          id: `s${station}-${rtu}`,
          name: `Station ${station} ${rtu === 1 ? "I" : "II"}`,
          organization: ORG_A,
          assetCount: 4,
          freshAssetCount: station === 1 && rtu === 1 ? 4 : 0,
          parentId: `s${station}`,
        }),
      );
    }
  }
  return items;
}

/** `G1` — no item has a parent: no group, every item loose in the input order, the summary as today. */
export function runG1(): void {
  const items = [
    site({ id: "a2", name: "A2", organization: ORG_A, freshAssetCount: 0 }),
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a3", name: "A3", organization: ORG_A, assetCount: 0, freshAssetCount: 0 }),
  ];
  const grouped = groupSitesByParent(items);
  assert(grouped.groups.length === 0, `no item has a parent, so no group — got ${grouped.groups.length}`);
  assert(ids(grouped.loose) === "a2,a1,a3", `every item loose in input order — got ${ids(grouped.loose)}`);
  const summary = orgSectionSummary(items);
  assert(
    summary.locationCount === 3 && summary.freshLocationCount === 1,
    `a flat list counts every item — got ${JSON.stringify(summary)}`,
  );
}

/**
 * `G2` — six asset-less parents over twelve children: 12 sites, 6 groups, no loose card, no card
 * for a parent; the summary counts 12 sites and one fresh site.
 */
export function runG2(): void {
  const items = phewbSplit();
  assert(siteLocations(items).length === 12, `12 sites, not 18 — got ${siteLocations(items).length}`);
  const grouped = groupSitesByParent(items);
  assert(grouped.groups.length === 6, `6 groups — got ${grouped.groups.length}`);
  assert(grouped.loose.length === 0, `no loose card — got ${ids(grouped.loose)}`);
  const cards = grouped.groups.flatMap((group) => group.sites);
  assert(cards.length === 12, `12 cards — got ${cards.length}`);
  assert(!cards.some((card) => /^s\d$/.test(card.id)), `no card for a parent — got ${ids(cards)}`);
  assert(
    ids(grouped.groups.map((group) => group.parent)) === "s1,s2,s3,s4,s5,s6",
    "the groups keep the parents' input order",
  );
  assert(ids(grouped.groups[0].sites) === "s1-1,s1-2", `children in input order — got ${ids(grouped.groups[0].sites)}`);
  const summary = orgSectionSummary(items);
  assert(summary.locationCount === 12, `locationCount must count sites — got ${summary.locationCount}`);
  assert(summary.freshLocationCount === 1, `freshLocationCount counts sites — got ${summary.freshLocationCount}`);
}

/** `G3` — a parent that holds an asset: its own card is first in its group, and it counts as a site. */
export function runG3(): void {
  const items = [
    site({ id: "c1", name: "Child One", organization: ORG_A, parentId: "p" }),
    site({ id: "p", name: "Parent", organization: ORG_A, assetCount: 2 }),
    site({ id: "c2", name: "Child Two", organization: ORG_A, parentId: "p" }),
  ];
  assert(ids(siteLocations(items)) === "c1,p,c2", `a parent with an asset is a site — got ${ids(siteLocations(items))}`);
  const grouped = groupSitesByParent(items);
  assert(grouped.groups.length === 1 && grouped.loose.length === 0, "one group, no loose card");
  assert(ids(grouped.groups[0].sites) === "p,c1,c2", `the parent's card first — got ${ids(grouped.groups[0].sites)}`);
  assert(orgSectionSummary(items).locationCount === 3, "three sites");
}

/** `G4` — the roll-up sums live sites, sites, assets and alarms over the group. */
export function runG4(): void {
  const items = [
    parent("p", "Parent"),
    site({ id: "c1", name: "C1", organization: ORG_A, assetCount: 4, freshAssetCount: 3, openAlarms: 2, parentId: "p" }),
    site({ id: "c2", name: "C2", organization: ORG_A, assetCount: 5, freshAssetCount: 0, openAlarms: 1, parentId: "p" }),
    site({ id: "c3", name: "C3", organization: ORG_A, assetCount: 1, freshAssetCount: 1, openAlarms: 0, parentId: "p" }),
    site({ id: "x", name: "Other", organization: ORG_A, assetCount: 9, openAlarms: 7 }),
  ];
  const [group] = groupSitesByParent(items).groups;
  const rollup = siteGroupRollup(group);
  assert(
    JSON.stringify(rollup) === JSON.stringify({ liveSites: 2, sites: 3, assets: 10, alarms: 3 }),
    `the roll-up must be 2 of 3 live, 10 assets, 3 alarms — got ${JSON.stringify(rollup)}`,
  );
}

/** `G5` — a group with one live site of two is live: the whole group sits in Live. */
export function runG5(): void {
  const items = [
    parent("p", "Parent"),
    site({ id: "c1", name: "C1", organization: ORG_A, freshAssetCount: 0, parentId: "p" }),
    site({ id: "c2", name: "C2", organization: ORG_A, freshAssetCount: 1, parentId: "p" }),
    parent("q", "Quiet"),
    site({ id: "d1", name: "D1", organization: ORG_A, freshAssetCount: 0, parentId: "q" }),
    site({ id: "l1", name: "Loose live", organization: ORG_A, freshAssetCount: 1 }),
    site({ id: "l2", name: "Loose dark", organization: ORG_A, freshAssetCount: 0 }),
  ];
  const { live, notLive } = splitGroupsByLive(groupSitesByParent(items));
  assert(ids(live.groups.map((g) => g.parent)) === "p", "the group with one live site is live");
  assert(ids(live.groups[0].sites) === "c1,c2", "the whole group moves, its not-live site too");
  assert(ids(notLive.groups.map((g) => g.parent)) === "q", "the group with no live site is not live");
  assert(ids(live.loose) === "l1" && ids(notLive.loose) === "l2", "loose cards split by their own state");
}

/** `G6` — a child whose `parentId` is `null` (an unreadable parent) is loose. */
export function runG6(): void {
  const items = [
    site({ id: "c1", name: "C1", organization: ORG_A, parentId: null }),
    site({ id: "c2", name: "C2", organization: ORG_A, parentId: null }),
  ];
  const grouped = groupSitesByParent(items);
  assert(grouped.groups.length === 0 && ids(grouped.loose) === "c1,c2", "both children are loose");
}

/**
 * `G7` — three levels: the nearest parent is the header; a parent with no card under it (the
 * grandparent, whose only child is itself a parent) draws no header.
 */
export function runG7(): void {
  const items = [
    parent("g", "Grandparent"),
    parent("p", "Parent", "g"),
    site({ id: "c1", name: "C1", organization: ORG_A, parentId: "p" }),
    site({ id: "c2", name: "C2", organization: ORG_A, parentId: "p" }),
  ];
  const grouped = groupSitesByParent(items);
  assert(ids(grouped.groups.map((g) => g.parent)) === "p", `only the nearest parent heads a group — got ${ids(grouped.groups.map((g) => g.parent))}`);
  assert(ids(grouped.groups[0].sites) === "c1,c2" && grouped.loose.length === 0, "the children sit under p");
  assert(orgSectionSummary(items).locationCount === 2, "two sites");
}
