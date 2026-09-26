import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import { groupByOrganization, orgSectionSummary } from "./location-kpi-groups";

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
