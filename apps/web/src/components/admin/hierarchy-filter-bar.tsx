import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { fetchAdminAssets } from "../../api/admin/assets";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchAdminRtus } from "../../api/admin/rtus";
import { isGlobalAdmin } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

export type HierarchySelection = {
  organizationId?: string;
  locationId?: string;
  rtuId?: string;
  assetId?: string;
};

type HierarchyFilterBarProps = {
  user: AuthUser;
  levels: Array<"organization" | "location" | "rtu" | "asset">;
  selection: HierarchySelection;
  onNavigate: (selection: HierarchySelection) => void;
  /** When false, dropdown changes only update local selection without route changes. */
  syncRoutes?: boolean;
};

/** Cascading org → location → RTU → asset filter controls for master data screens. */
export function HierarchyFilterBar({
  user,
  levels,
  selection,
  onNavigate,
  syncRoutes = true,
}: HierarchyFilterBarProps) {
  const navigate = useNavigate();
  const showOrg = levels.includes("organization");
  const showLocation = levels.includes("location");
  const showRtu = levels.includes("rtu");
  const showAsset = levels.includes("asset");

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: showOrg || showLocation || showRtu || showAsset,
  });

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", selection.organizationId],
    queryFn: () => fetchAdminLocations("true", selection.organizationId),
    enabled: (showLocation || showRtu || showAsset) && Boolean(selection.organizationId),
  });

  const rtusQ = useQuery({
    queryKey: ["admin", "rtus", "true", selection.locationId],
    queryFn: () => fetchAdminRtus("true", selection.locationId),
    enabled: (showRtu || showAsset) && Boolean(selection.locationId),
  });

  const assetsQ = useQuery({
    queryKey: ["admin", "assets", "true", selection.locationId, selection.rtuId],
    queryFn: () => fetchAdminAssets("true", selection.locationId, selection.rtuId),
    // A gateway-less asset has no rtuId to select — when "rtu" isn't one of
    // the requested levels at all, locationId alone must be enough to load
    // the asset list, not an rtuId the caller never asked for.
    enabled: showAsset && Boolean(selection.locationId) && (!showRtu || Boolean(selection.rtuId)),
  });

  const orgLocked = !isGlobalAdmin(user.role) && (orgsQ.data?.items.length ?? 0) <= 1;

  const effectiveOrgId = useMemo(() => {
    if (selection.organizationId) {
      return selection.organizationId;
    }
    if (orgLocked && orgsQ.data?.items[0]) {
      return orgsQ.data.items[0].id;
    }
    return "";
  }, [orgLocked, orgsQ.data?.items, selection.organizationId]);

  function updateSelection(next: HierarchySelection): void {
    onNavigate(next);
    if (!syncRoutes) {
      return;
    }
    if (next.assetId && next.locationId && next.rtuId) {
      navigate(`/admin/assets/${next.assetId}/points`);
      return;
    }
    if (next.rtuId && next.locationId) {
      navigate(`/admin/locations/${next.locationId}/rtus/${next.rtuId}/assets`);
      return;
    }
    if (next.locationId && next.organizationId) {
      navigate(`/admin/locations/${next.locationId}/rtus`);
      return;
    }
    if (next.organizationId) {
      navigate(`/admin/organizations/${next.organizationId}/locations`);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {showOrg ? (
        <select
          className="rounded border border-gray-200 px-3 py-1.5 text-xs"
          value={effectiveOrgId}
          disabled={orgLocked}
          onChange={(event) => {
            updateSelection({
              organizationId: event.target.value,
              locationId: undefined,
              rtuId: undefined,
              assetId: undefined,
            });
          }}
        >
          <option value="">Select organization</option>
          {(orgsQ.data?.items ?? []).map((org) => (
            <option key={org.id} value={org.id}>
              {org.code} · {org.name}
            </option>
          ))}
        </select>
      ) : null}

      {showLocation ? (
        <select
          className="rounded border border-gray-200 px-3 py-1.5 text-xs"
          value={selection.locationId ?? ""}
          disabled={!effectiveOrgId}
          onChange={(event) => {
            updateSelection({
              organizationId: effectiveOrgId || selection.organizationId,
              locationId: event.target.value || undefined,
              rtuId: undefined,
              assetId: undefined,
            });
          }}
        >
          <option value="">Select location</option>
          {(locationsQ.data?.items ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      ) : null}

      {showRtu ? (
        <select
          className="rounded border border-gray-200 px-3 py-1.5 text-xs"
          value={selection.rtuId ?? ""}
          disabled={!selection.locationId}
          onChange={(event) => {
            updateSelection({
              organizationId: effectiveOrgId || selection.organizationId,
              locationId: selection.locationId,
              rtuId: event.target.value || undefined,
              assetId: undefined,
            });
          }}
        >
          <option value="">Select RTU</option>
          {(rtusQ.data?.items ?? []).map((rtu) => (
            <option key={rtu.id} value={rtu.id}>
              {rtu.displayName}
            </option>
          ))}
        </select>
      ) : null}

      {showAsset ? (
        <select
          className="rounded border border-gray-200 px-3 py-1.5 text-xs"
          value={selection.assetId ?? ""}
          disabled={showRtu ? !selection.rtuId : !selection.locationId}
          onChange={(event) => {
            updateSelection({
              organizationId: effectiveOrgId || selection.organizationId,
              locationId: selection.locationId,
              rtuId: selection.rtuId,
              assetId: event.target.value || undefined,
            });
          }}
        >
          <option value="">Select asset</option>
          {(assetsQ.data?.items ?? []).map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.code} · {asset.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
