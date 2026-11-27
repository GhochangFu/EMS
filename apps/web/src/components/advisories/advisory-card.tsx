import { Link } from "react-router-dom";

import { assetLabelOf } from "@bms/shared";
import { ADVISORY_DISCLAIMER } from "@bms/shared/contracts";
import type { Advisory } from "@bms/shared/contracts";

import { advisoryConfidenceLabel, advisoryKindLabel } from "../../lib/advisories";
import { assetHistoryPath } from "../../lib/asset-history-range";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

type AdvisoryCardProps = {
  advisory: Advisory;
  /** The asset link; off on the asset's own history page. */
  showAsset?: boolean;
};

/**
 * `E1.6b` / ADR 0137 (plan T2.2) — one advisory: a `SectionCard` titled by its kind, the asset as
 * a link to its history page (`assetLabelOf`, ADR 0111), the server's headline, lines and context
 * exactly as sent (R-f: no number is formatted here), the confidence, the *Advisory* pill in the
 * info tone (never an alarm colour), the fixed disclaimer, and the assumptions in a closed
 * `<details>`.
 */
export function AdvisoryCard({ advisory, showAsset = true }: AdvisoryCardProps) {
  return (
    <div data-testid="advisory-card">
      <SectionCard
        title={advisoryKindLabel(advisory.kind)}
        actions={
          <>
            <span className="text-2xs text-ink-muted" data-testid="advisory-confidence">
              {advisoryConfidenceLabel(advisory.confidence)}
            </span>
            <StatusPill label="Advisory" tone="info" />
          </>
        }
      >
        <div className="space-y-2 text-sm">
          {showAsset ? (
            <p>
              <Link
                className="font-mono text-xs font-semibold text-accent-strong hover:underline"
                to={assetHistoryPath(advisory.assetId)}
              >
                {assetLabelOf(advisory)}
              </Link>
              <span className="ml-2 text-2xs text-ink-muted">{advisory.assetName}</span>
            </p>
          ) : null}
          <p className="font-semibold text-ink" data-testid="advisory-headline">
            {advisory.headline}
          </p>
          {advisory.lines.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {advisory.lines.map((line, i) => (
                <li key={i} data-testid="advisory-line">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {advisory.context.length > 0 ? (
            <ul className="space-y-1 text-xs text-ink-muted">
              {advisory.context.map((line, i) => (
                <li key={i} data-testid="advisory-context">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-ink-muted">{ADVISORY_DISCLAIMER}</p>
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">Assumptions</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {advisory.assumptions.map((line, i) => (
                <li key={i} data-testid="advisory-assumption">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </SectionCard>
    </div>
  );
}
