import { SectionCard } from "../section-card";

import { useHealthSummary } from "../../hooks/use-asset-health";
import { HealthSummaryDonut } from "./health-summary-donut";

type HealthSummarySectionProps = {
  /** Omit for the enterprise donut; pass a location id for the plant donut. */
  locationId?: string;
};

/**
 * `E1.3` — the fetching shell around {@link HealthSummaryDonut}.
 *
 * The donut itself is presentational and takes a `HealthSummaryResponse`, which
 * is what makes it testable under jsdom without a query client. This is the
 * other half: it owns the request, the three states, and nothing else.
 *
 * **An empty donut is a result, not an error.** `assetCount === 0` means the
 * caller can read no assets in this scope — a location-scoped operator looking
 * at another plant, or a fresh deployment. It renders as its own sentence
 * rather than as "unavailable", because those are different facts and only one
 * of them is worth investigating.
 *
 * The same distinction one level down is why the donut takes the whole response:
 * `unbandedAssetCount` and `unscoredAssetCount` are separate figures, and a
 * shell that collapsed either into "no data" before rendering would undo
 * Amendment 1 decision 3 without touching the component that implements it.
 */
export function HealthSummarySection({ locationId }: HealthSummarySectionProps) {
  const query = useHealthSummary(locationId);

  return (
    <SectionCard
      title="Asset health"
      subtitle="Share of samples inside every published threshold · ADR 0050"
      bodyClassName="p-3"
    >
      {query.isLoading ? (
        <div className="text-sm text-bms-muted">Loading asset health...</div>
      ) : query.isError ? (
        <div className="text-sm text-red-700">Asset health unavailable.</div>
      ) : query.data === undefined || query.data.assetCount === 0 ? (
        <div className="text-sm text-bms-muted">
          No assets in your access scope for this view.
        </div>
      ) : (
        <HealthSummaryDonut summary={query.data} />
      )}
    </SectionCard>
  );
}
