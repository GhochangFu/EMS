import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { AdminAssetPointDto } from "@bms/shared";

import { fetchAdminAssetPoints } from "../../api/admin/asset-points";
import { fetchAdminLocations } from "../../api/admin/locations";

type PointPickerProps = {
  organizationId: string;
  onAdd: (point: AdminAssetPointDto) => void;
};

/**
 * `F3.1d` Unit 7 — the location→points chain (plan §7).
 *
 * **Neither points endpoint carries an organization id, so this filters by
 * location instead — structurally, not as a guess.** `GET /admin/locations`
 * is filtered to `organizationId` here, and every point `GET
 * /admin/asset-points` returns for a chosen location belongs to an asset in
 * that location, therefore to that organization. A point reached this way
 * cannot be one `assertBoundPointsInOrganization` refuses — that guard stays
 * the enforcement; this picker is the second line of defence.
 *
 * Carries no `widgetType` — cardinality is enforced by the caller
 * (`WidgetInspector` stops rendering this component once
 * `WIDGET_CATALOG[type].points.max` is reached, per §7's "the Add point
 * control disappears at the maximum"), so this picker only ever needs to know
 * which organization it may not cross.
 */
export function PointPicker({ organizationId, onAdd }: PointPickerProps) {
  const [locationId, setLocationId] = useState("");

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "dashboard-scope", organizationId],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: organizationId !== "",
  });

  const pointsQ = useQuery({
    queryKey: ["admin", "asset-points", "dashboard-scope", locationId],
    queryFn: () => fetchAdminAssetPoints("true", undefined, locationId),
    enabled: locationId !== "",
  });

  if (organizationId === "") {
    return (
      <p className="text-[11px] text-bms-muted">Choose the dashboard's scope before binding points.</p>
    );
  }

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-300 p-2">
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
      {locationId !== "" ? (
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
