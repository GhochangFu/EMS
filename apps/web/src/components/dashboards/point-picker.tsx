import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { AdminAssetPointDto, UserRole } from "@bms/shared";

import { fetchAdminAssetPoints } from "../../api/admin/asset-points";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAssetPoints, fetchAssets } from "../../api/assets";
import { isMasterDataAdmin } from "../../lib/admin-access";

type PointPickerProps = {
  role: UserRole;
  organizationId: string;
  onAdd: (point: AdminAssetPointDto) => void;
};

/**
 * `F3.1d` Unit 7 — the location→points chain (plan §7); `F3.63` Unit 6 — the
 * asset→points chain beside it (ADR 0047 Amendment 6 §Q1 point 4).
 *
 * **Two chains, forked on `isMasterDataAdmin(role)`.** The location chain
 * reads `GET /admin/locations` then `GET /admin/asset-points`, and both are
 * gated server-side by `requireMasterDataUser` — `admin`,
 * `organization_admin`, `location_admin`: exactly `isMasterDataAdmin`'s
 * membership. So that predicate is not a stand-in for the endpoint gate, it
 * IS the endpoint gate, and it is the fork here for that reason.
 * `canChooseLocationDashboardScope` (`admin-access.ts`) has the same three
 * roles today but answers a different question (whether the location scope
 * radio exists), and a future change to it must not silently move which
 * endpoints this picker calls. For every other role — today
 * `asset_group_admin` — the chain is `GET /assets?organizationId=` (the
 * narrowing the controller already accepts) then
 * `GET /assets/:assetId/points`, both gated on the caller's own readable
 * scope (`canReadAsset`), not on master data.
 *
 * **Neither points endpoint carries an organization id, so both chains
 * filter structurally at the first select.** Every location `GET
 * /admin/locations?organizationId=` lists, and every asset `GET
 * /assets?organizationId=` lists, belongs to that organization, and every
 * point reached through one of them belongs to an asset in it. A point
 * reached either way cannot be one `assertBoundPointsInOrganization`
 * refuses — that guard stays the enforcement; this picker is the second line
 * of defence. All four queries are declared on every render (hooks stay
 * unconditional); the fork lives in their `enabled:` clauses and in the JSX,
 * so the other chain's fetches never fire for a role.
 *
 * Carries no `widgetType` — cardinality is enforced by the caller
 * (`WidgetInspector` stops rendering this component once
 * `WIDGET_CATALOG[type].points.max` is reached, per §7's "the Add point
 * control disappears at the maximum"), so this picker only ever needs to know
 * which organization it may not cross. The `onAdd` contract is the same for
 * both chains: one `AdminAssetPointDto`.
 */
export function PointPicker({ role, organizationId, onAdd }: PointPickerProps) {
  const masterData = isMasterDataAdmin(role);
  const [locationId, setLocationId] = useState("");
  const [assetId, setAssetId] = useState("");

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "dashboard-scope", organizationId],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: masterData && organizationId !== "",
  });

  const adminPointsQ = useQuery({
    queryKey: ["admin", "asset-points", "dashboard-scope", locationId],
    queryFn: () => fetchAdminAssetPoints("true", undefined, locationId),
    enabled: masterData && locationId !== "",
  });

  const assetsQ = useQuery({
    queryKey: ["assets", "dashboard-scope", organizationId],
    queryFn: () => fetchAssets(organizationId),
    enabled: !masterData && organizationId !== "",
  });

  const assetPointsQ = useQuery({
    queryKey: ["assets", "points", "dashboard-scope", assetId],
    queryFn: () => fetchAssetPoints(assetId),
    enabled: !masterData && assetId !== "",
  });

  if (organizationId === "") {
    return (
      <p className="text-[11px] text-bms-muted">Choose the dashboard's scope before binding points.</p>
    );
  }

  const pointsQ = masterData ? adminPointsQ : assetPointsQ;
  const chosen = masterData ? locationId : assetId;

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-300 p-2">
      {masterData ? (
        <select
          aria-label="Location"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="">Choose a location…</option>
          {(locationsQ.data?.items ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label="Asset"
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="">Choose an asset…</option>
          {(assetsQ.data ?? []).map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} ({asset.code})
            </option>
          ))}
        </select>
      )}
      {chosen !== "" ? (
        <select
          aria-label="Add point"
          value=""
          onChange={(event) => {
            const point = pointsQ.data?.items.find((item) => item.id === event.target.value);
            if (point) {
              onAdd(point);
            }
          }}
          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="" disabled>
            {pointsQ.isLoading ? "Loading points…" : "Add a point…"}
          </option>
          {(pointsQ.data?.items ?? []).map((point) => (
            <option key={point.id} value={point.id}>
              {point.unit ? `${point.pointKey} (${point.unit})` : point.pointKey} — {point.assetName}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
