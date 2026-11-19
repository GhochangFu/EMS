import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchDashboard, fetchDashboards } from "../../api/dashboards";
import { SectionCard } from "../section-card";

type ScopedDashboardsListProps = {
  /** The organization level's id; omit at the estate. */
  organizationId?: string;
  /** The site level's id (`GET /dashboards?locationId=`, OQ6); omit above the site. */
  locationId?: string;
  /**
   * `F4.240` part b (ADR 0140 decision 3h, owner ruling Q1 (a)) — leave out a dashboard scoped
   * at `locationId` whose detail carries a `templateId`: the station's old site-layout copy. Only
   * the station page sets it.
   */
  omitTemplateCopies?: boolean;
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
 *
 * `F4.240` part b (ADR 0140 decision 3h, plan Task 1.5, owner ruling Q1 (a)) — with
 * `omitTemplateCopies`, each row scoped at `locationId` is detail-read (the list DTO carries no
 * template stamp; the detail's `templateId` does), under the key and read `SiteDashboardView`
 * uses, with no poll. A row whose detail carries a `templateId` is left out; a failed detail read
 * keeps its row; the card shows its loading line until every detail read has settled.
 */
export function ScopedDashboardsList({ organizationId, locationId, omitTemplateCopies = false }: ScopedDashboardsListProps) {
  const query = useQuery({
    queryKey: ["dashboards", "control-room", organizationId ?? null, locationId ?? null],
    queryFn: () => fetchDashboards(organizationId, undefined, undefined, locationId),
  });
  const candidates =
    omitTemplateCopies && locationId !== undefined
      ? (query.data?.items ?? []).filter((dashboard) => dashboard.locationId === locationId)
      : [];
  const details = useQueries({
    queries: candidates.map((dashboard) => ({
      queryKey: ["dashboards", "detail", dashboard.slug, dashboard.organizationId] as const,
      queryFn: () => fetchDashboard(dashboard.slug, dashboard.organizationId),
    })),
  });
  const templateCopyIds = new Set(
    candidates.flatMap((dashboard, index) =>
      (details[index]?.data?.templateId ?? null) !== null ? [dashboard.id] : [],
    ),
  );
  const detailsPending = details.some((detail) => detail.isPending);
  const rows = (query.data?.items ?? []).filter((dashboard) => !templateCopyIds.has(dashboard.id));

  return (
    <SectionCard title="Dashboards" bodyClassName="p-3">
      {query.isPending || detailsPending ? (
        <p className="text-sm text-ink-muted">Loading dashboards…</p>
      ) : query.isError ? (
        <p className="text-sm text-critical-ink">Dashboards unavailable.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No dashboards for this scope.</p>
      ) : (
        <ul className="divide-y divide-well-deep">
          {rows.map((dashboard) => (
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
