import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { EnergyOrganizationViews, EnergyViewQuery } from "@bms/shared";

import { fetchEnergyOrganizationViews } from "../api/energy-view";

function organizationViewsOf(query: EnergyViewQuery | null): Promise<EnergyOrganizationViews> {
  // Unreachable: the query is disabled while `query` is null.
  return query === null ? Promise.reject(new Error("no energy view query")) : fetchEnergyOrganizationViews(query);
}

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan Task 2.5) — `GET /reports/energy/organization-views`
 * for one energy query, moved verbatim out of `SiteEnergyView` so the station's Trends & Energy tab
 * reads the range pickers' zone from the very cache entry the energy view mounts (one key, one
 * fetcher, one set of options), and adds no request.
 */
export function useEnergyOrganizationViews(query: EnergyViewQuery | null) {
  return useQuery({
    queryKey: ["energy", "organization-views", query],
    queryFn: () => organizationViewsOf(query),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
