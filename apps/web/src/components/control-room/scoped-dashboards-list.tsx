import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchDashboards } from "../../api/dashboards";
import { SectionCard } from "../section-card";

type ScopedDashboardsListProps = {
  /** The organization level's id; omit at the estate. */
  organizationId?: string;
  /** The site level's id (`GET /dashboards?locationId=`, OQ6); omit above the site. */
  locationId?: string;
};

/**
 * `F3.72` (plan D7) — the library dashboards of one Control Room level: the estate reads with
 * no filter, the organization level by `organizationId`, the site by `locationId` as well. The
 * API narrows within the caller's read scope and answers `[]` for an unreadable id, so the list
 * decides nothing about access itself.
 *
 * Each row's Open link carries **the row's own** `organizationId`, not the prop: the estate list
 * spans organizations, and the viewer needs the organization to disambiguate a slug two
 * organizations share (`fetchDashboard`'s D5) — the same link `/dashboards` renders.
 */
export function ScopedDashboardsList({ organizationId, locationId }: ScopedDashboardsListProps) {
  const query = useQuery({
    queryKey: ["dashboards", "control-room", organizationId ?? null, locationId ?? null],
    queryFn: () => fetchDashboards(organizationId, undefined, undefined, locationId),
  });

  return (
    <SectionCard title="Dashboards" bodyClassName="p-3">
      {query.isPending ? (
        <p className="text-sm text-ink-muted">Loading dashboards…</p>
      ) : query.isError ? (
        <p className="text-sm text-critical-ink">Dashboards unavailable.</p>
      ) : query.data.items.length === 0 ? (
        <p className="text-sm text-ink-muted">No dashboards for this scope.</p>
      ) : (
        <ul className="divide-y divide-well-deep">
          {query.data.items.map((dashboard) => (
            <li key={dashboard.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm font-semibold text-ink">{dashboard.name}</span>
              <Link
                to={`/dashboards/${dashboard.slug}?organizationId=${dashboard.organizationId}`}
                className="surface-button px-2.5 py-1"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
