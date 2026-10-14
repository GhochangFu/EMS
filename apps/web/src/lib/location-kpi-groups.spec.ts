import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import {
  groupByOrganization,
  hasLiveTelemetry,
  orgSectionSummary,
  splitByLiveTelemetry,
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
    assetCount: 1,
    freshAssetCount: opts.freshAssetCount ?? 1,
    totalKw: 0,
    openAlarms: 0,
    criticalAlarms: 0,
    scopeLabel: "full",
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
