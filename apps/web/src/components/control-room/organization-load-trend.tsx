import { useQuery } from "@tanstack/react-query";

import { fetchLoadTrend } from "../../api/dashboard";
import { LoadTrendChart } from "../load-trend-chart";
import { SectionCard } from "../section-card";

type OrganizationLoadTrendProps = {
  organizationId: string;
};

/**
 * `F3.72` (plan D3) — the organization level's load card: `GET /dashboard/load-trend` narrowed
 * by `organizationId`, re-read every minute. It opens no socket and shows no stale pill, unlike
 * the estate's card on `/`: the telemetry socket's kW sum is estate-wide, so merging it here
 * would draw other organizations' load on this organization's line.
 *
 * The points go to the chart as the API returns them. `useExecutiveDashboard` re-keys and sorts
 * only to merge the socket's points into the read; with no socket there is nothing to merge.
 */
export function OrganizationLoadTrend({ organizationId }: OrganizationLoadTrendProps) {
  const query = useQuery({
    queryKey: ["dashboard", "load-trend", "60m", organizationId],
    queryFn: () => fetchLoadTrend("60m", organizationId),
    refetchInterval: 60_000,
  });
  const points = query.data?.points ?? [];
  const status = query.isPending
    ? "loading"
    : query.isError
      ? "error"
      : points.length === 0
        ? "empty"
        : "ready";

  return (
    <SectionCard
      title="Load · last 60 minutes"
      subtitle="1-minute buckets · total kW (this organization)"
      bodyClassName="p-3"
    >
      <LoadTrendChart points={points} status={status} />
    </SectionCard>
  );
}
