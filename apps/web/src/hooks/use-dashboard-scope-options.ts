import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { UserRole } from "@bms/shared";

import { adminAssetGroupsQueryKey, fetchAdminAssetGroups } from "../api/admin/asset-groups";
import { fetchAdminLocations } from "../api/admin/locations";
import type { ScopeLocationOption } from "../components/dashboards/dashboard-scope-fields";
import {
  canChooseAssetGroupDashboardScope,
  canChooseLocationDashboardScope,
  isMasterDataAdmin,
} from "../lib/admin-access";
import { scopeAssetGroupOptions, type ScopeAssetGroupOption } from "../lib/dashboard-scope";
import { useAuthStore } from "../stores/auth-store";

export type DashboardScopeOptions = {
  readonly locations: readonly ScopeLocationOption[];
  readonly assetGroups: readonly ScopeAssetGroupOption[];
};

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 2, plan §4.2) — the two option lists
 * `DashboardScopeFields` is fed, read by ROLE, for its three callers (the create page, the edit
 * page, the duplicate dialog). Before this hook each caller issued `GET /admin/locations` and
 * `GET /admin/asset-groups` unconditionally, under three different query keys for one payload.
 *
 * **Which role reads which source, and why.**
 *
 * - `locations`: `GET /admin/locations?active=true[&organizationId=]`, only for the roles
 *   `canChooseLocationDashboardScope` admits (`admin`, `organization_admin`, `location_admin`).
 *   For `asset_group_admin` the read is a 403 (`requireMasterDataUser`) AND the fields render no
 *   location radio for it, so nothing would read the list. The key is `PointPicker`'s
 *   `["admin", "locations", "dashboard-scope", organizationId]` for the same fetch, so the
 *   cache is shared (plan §11 Q6); `"all"` stands in for an unnarrowed read.
 * - `assetGroups`, for the master-data roles (`isMasterDataAdmin`): `GET /admin/asset-groups`
 *   under `adminAssetGroupsQueryKey()`, narrowed here to `organizationId` when given (the
 *   endpoint filters by location only) — but ONLY when `canChooseAssetGroupDashboardScope`
 *   admits the role too. A `location_admin` is master-data but is refused the group scope, so
 *   it no longer issues the unread `GET /admin/asset-groups` on every builder load that
 *   `F3.34`'s closure recorded as a residual.
 * - `assetGroups`, otherwise (today: `asset_group_admin`): `/auth/me`'s `scope.assetGroups`
 *   from the auth store, through `scopeAssetGroupOptions` — the one list the role may read;
 *   `GET /admin/asset-groups` stays refused for it. A null store scope (no session yet) is `[]`.
 *
 * Every hook below is called unconditionally, on every render, whatever the role: the fork is
 * in the `enabled` clauses and in the value selected, never in the hook count.
 */
export function useDashboardScopeOptions({
  role,
  organizationId,
  enabled = true,
}: {
  role: UserRole;
  organizationId?: string;
  enabled?: boolean;
}): DashboardScopeOptions {
  const masterData = isMasterDataAdmin(role);

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "dashboard-scope", organizationId ?? "all"],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: enabled && canChooseLocationDashboardScope(role),
  });

  const adminAssetGroupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(),
    queryFn: () => fetchAdminAssetGroups(),
    enabled: enabled && canChooseAssetGroupDashboardScope(role) && masterData,
  });

  const storeScope = useAuthStore((state) => state.scope);

  const adminItems = adminAssetGroupsQ.data?.items;
  const assetGroups = useMemo<readonly ScopeAssetGroupOption[]>(() => {
    if (masterData) {
      return (adminItems ?? [])
        .filter((group) => organizationId === undefined || group.organizationId === organizationId)
        .map((group) => ({
          id: group.id,
          name: group.name,
          organizationId: group.organizationId,
          locationName: group.locationName,
        }));
    }
    return storeScope ? scopeAssetGroupOptions(storeScope, organizationId) : [];
  }, [masterData, adminItems, storeScope, organizationId]);

  return { locations: locationsQ.data?.items ?? [], assetGroups };
}
