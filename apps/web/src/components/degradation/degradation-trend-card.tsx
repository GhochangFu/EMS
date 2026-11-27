import { Link } from "react-router-dom";

import { assetLabelOf } from "@bms/shared";
import { DEGRADATION_CARD_TITLE, DEGRADATION_DISCLAIMER } from "@bms/shared/contracts";

import { useDegradationList } from "../../hooks/use-degradation";
import { assetHistoryPath } from "../../lib/asset-history-range";
import { cardRowsOf, shownOfSentence } from "../../lib/degradation";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

type DegradationTrendCardProps = {
  organizationId?: string;
  locationId?: string;
};

/**
 * `E1.5b` / ADR 0138 (plan T2.4; decisions 3–5, R-p, R-q, Q3 (a)) — the *Trending toward a limit —
 * advisory* card on the control-room organization and site pages, directly after *Bad actors*
 * and never on the wall. One row per asset with a crossing (`cardRowsOf`: the server's order, at
 * most `DEGRADATION_CARD_MAX`): the asset linked to its history page, its location, the nearest
 * indicator's summary as sent and the *Advisory* pill in the info tone — role classes only, never
 * a severity colour. A `beyond_horizon` indicator is never drawn here. With no crossing, while
 * loading, or on a failed read (a refused heavy route included), nothing is drawn.
 */
export function DegradationTrendCard({ organizationId, locationId }: DegradationTrendCardProps) {
  const query = useDegradationList({ organizationId, locationId }, true);
  const data = query.data;
  if (data === undefined || query.isError) {
    return null;
  }
  const rows = cardRowsOf(data);
  if (rows.length === 0) {
    return null;
  }
  const shown = shownOfSentence(data.considered, data.candidates);
  return (
    <SectionCard title={DEGRADATION_CARD_TITLE} bodyClassName="p-3">
      <ul>
        {rows.map(({ asset, indicator }) => (
          <li key={asset.assetId} data-testid="degradation-row" className="space-y-0.5 border-b border-line py-2 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link className="font-semibold text-accent-strong hover:underline" to={assetHistoryPath(asset.assetId)}>
                {assetLabelOf(asset)}
              </Link>
              <span className="text-xs text-ink-muted">{asset.assetLocationName}</span>
              <StatusPill label="Advisory" tone="info" />
            </div>
            <p className="text-xs text-ink">{indicator.summary}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">{DEGRADATION_DISCLAIMER}</p>
      {shown !== null ? <p className="text-xs tabular-nums text-ink-muted">{shown}</p> : null}
    </SectionCard>
  );
}
