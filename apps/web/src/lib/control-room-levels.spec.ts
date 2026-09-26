import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import {
  controlRoomCrumbs,
  controlRoomEntryTarget,
  organizationCards,
  organizationEntryTarget,
} from "./control-room-levels";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG_A = { id: "org-a", code: "AAA", name: "Alpha" };
const ORG_B = { id: "org-b", code: "BBB", name: "Bravo" };

function site(opts: {
  id: string;
  name: string;
  organization: { id: string; code: string; name: string };
  freshAssetCount?: number;
  openAlarms?: number;
}): LocationKpiSummary {
  return locationKpiSummarySchema.parse({
    id: opts.id,
    name: opts.name,
    code: `SITE-${opts.id}`,
    type: "smoc_campus",
    province: null,
    organization: opts.organization,
    rtuCount: 0,
    assetCount: 1,
    freshAssetCount: opts.freshAssetCount ?? 1,
    totalKw: 0,
    openAlarms: opts.openAlarms ?? 0,
    criticalAlarms: 0,
    scopeLabel: "full",
  });
}

/** `L1` — two organizations: the entry lands on the organizations list. */
export function runL1(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "b1", name: "B1", organization: ORG_B }),
  ];
  assert(
    controlRoomEntryTarget(items).level === "organizations",
    "two organizations must land on the organizations list",
  );
}

/** `L2` — one organization, two sites: the entry skips to that organization. */
export function runL2(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a2", name: "A2", organization: ORG_A }),
  ];
  const target = controlRoomEntryTarget(items);
  assert(
    target.level === "organization" && target.organizationId === ORG_A.id,
    "one organization with two sites must skip to that organization",
  );
}

/** `L3` — one organization, one site: the entry skips straight to the site. */
export function runL3(): void {
  const items = [site({ id: "a1", name: "A1", organization: ORG_A })];
  const target = controlRoomEntryTarget(items);
  assert(
    target.level === "site" && target.locationId === "a1",
    "one organization with one site must skip to the site",
  );
}

/** `L4` — an empty list lands on the empty target. */
export function runL4(): void {
  assert(controlRoomEntryTarget([]).level === "empty", "an empty list is the empty target");
}

/** `L5` — organization A holds two sites: entering it does not skip. */
export function runL5(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a2", name: "A2", organization: ORG_A }),
  ];
  const target = organizationEntryTarget(items, ORG_A.id);
  assert(target.level === "organization", "two sites must not skip the organization level");
}

/** `L6` — organization A holds one site: entering it skips to the site. */
export function runL6(): void {
  const items = [site({ id: "a1", name: "A1", organization: ORG_A })];
  const target = organizationEntryTarget(items, ORG_A.id);
  assert(
    target.level === "site" && target.locationId === "a1",
    "one site must skip to the site",
  );
}

/** `L7` — an organization id absent from the list is the empty target. */
export function runL7(): void {
  const items = [site({ id: "b1", name: "B1", organization: ORG_B })];
  assert(
    organizationEntryTarget(items, ORG_A.id).level === "empty",
    "an organization id outside the list must resolve to empty, never to org B's sites",
  );
}

/** `L8` — organization A's card totals count only the fresh site as online. */
export function runL8(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A, freshAssetCount: 1, openAlarms: 1 }),
    site({ id: "a2", name: "A2", organization: ORG_A, freshAssetCount: 0, openAlarms: 2 }),
  ];
  const [card] = organizationCards(items);
  assert(card.siteCount === 2, `siteCount must be 2 — got ${card.siteCount}`);
  assert(card.sitesOnline === 1, `sitesOnline must count only the fresh site — got ${card.sitesOnline}`);
  assert(card.openAlarms === 3, `openAlarms must sum both sites — got ${card.openAlarms}`);
}

/** `C1` — two organizations, at the organization level: root + organization. */
export function runC1(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a2", name: "A2", organization: ORG_A }),
    site({ id: "b1", name: "B1", organization: ORG_B }),
  ];
  const crumbs = controlRoomCrumbs(items, { organizationId: ORG_A.id });
  assert(
    crumbs.length === 2 && crumbs[0].label === "Control Room" && crumbs[0].to === "/control-room",
    "the root crumb must not be omitted",
  );
  assert(crumbs[1].label === ORG_A.name && crumbs[1].to === undefined, "the org crumb is the current page");
}

/** `C2` — two organizations, at the site level: root + organization + site. */
export function runC2(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a2", name: "A2", organization: ORG_A }),
    site({ id: "b1", name: "B1", organization: ORG_B }),
  ];
  const crumbs = controlRoomCrumbs(items, { locationId: "a1" });
  assert(crumbs.length === 3, `must hold the root, org, and site crumbs — got ${crumbs.length}`);
  assert(
    crumbs[1].label === ORG_A.name && crumbs[1].to === `/control-room/org/${ORG_A.id}`,
    "the org crumb must be omitted only when the org level is skipped",
  );
  assert(crumbs[2].label === "A1" && crumbs[2].to === undefined, "the site crumb is the current page");
}

/** `C3` — one organization, two sites, at the site level: the org crumb is omitted. */
export function runC3(): void {
  const items = [
    site({ id: "a1", name: "A1", organization: ORG_A }),
    site({ id: "a2", name: "A2", organization: ORG_A }),
  ];
  const crumbs = controlRoomCrumbs(items, { locationId: "a1" });
  assert(
    crumbs.length === 2 && crumbs[0].label === "Control Room" && crumbs[1].label === "A1",
    `a skipped organization level must always omit its crumb — got ${JSON.stringify(crumbs)}`,
  );
}

/** `C4` — one organization, one site, at the site level: one crumb only. */
export function runC4(): void {
  const items = [site({ id: "a1", name: "A1", organization: ORG_A })];
  const crumbs = controlRoomCrumbs(items, { locationId: "a1" });
  assert(
    crumbs.length === 1,
    `a skipped organization and site level must leave one crumb — got ${JSON.stringify(crumbs)}`,
  );
}

/** The review fixture: A holds two sites, B holds one. */
const ONE_SITE_ORG_AMONG_SEVERAL = [
  site({ id: "a1", name: "A1", organization: ORG_A }),
  site({ id: "a2", name: "A2", organization: ORG_A }),
  site({ id: "b1", name: "B1", organization: ORG_B }),
];

/**
 * `C5` — two organizations, at the site of the one-site organization B: B's
 * level is skipped (it redirects to its only site), so B gets no crumb, but
 * the organizations level was not skipped, so the site crumb stays.
 */
export function runC5(): void {
  const crumbs = controlRoomCrumbs(ONE_SITE_ORG_AMONG_SEVERAL, { locationId: "b1" });
  const expected = [{ label: "Control Room", to: "/control-room" }, { label: "B1" }];
  assert(
    JSON.stringify(crumbs) === JSON.stringify(expected),
    `a one-site organization among several must give root + site — got ${JSON.stringify(crumbs)}`,
  );
}

/** `C6` — the same fixture at a1: root, the linked organization, the site. */
export function runC6(): void {
  const crumbs = controlRoomCrumbs(ONE_SITE_ORG_AMONG_SEVERAL, { locationId: "a1" });
  const expected = [
    { label: "Control Room", to: "/control-room" },
    { label: ORG_A.name, to: `/control-room/org/${ORG_A.id}` },
    { label: "A1" },
  ];
  assert(
    JSON.stringify(crumbs) === JSON.stringify(expected),
    `a two-site organization among several must give three crumbs — got ${JSON.stringify(crumbs)}`,
  );
}
