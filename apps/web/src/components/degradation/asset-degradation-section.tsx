import { useId } from "react";

import {
  DEGRADATION_DISCLAIMER,
  DEGRADATION_ESTIMATED_LABEL,
  DEGRADATION_NAME,
  DEGRADATION_SECTION_TITLE,
} from "@bms/shared/contracts";

import { useAssetDegradation } from "../../hooks/use-degradation";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

type AssetDegradationSectionProps = {
  assetId: string;
};

/**
 * `E1.5b` / ADR 0138 (plan T2.2) — the asset history page's degradation section. Per indicator:
 * the name *Time to limit (trend)*, *Estimated*, the *Advisory* pill in the info tone (never a
 * severity colour), the server's sentence and detail exactly as sent (R-m: no number is formatted
 * here; R-h: no single date exists to print), the disclaimer and the assumptions in a closed
 * `<details>`; then the asset's first schedule note. A `beyond_horizon` indicator draws its
 * sentence here and only here (Q3 (a)). R-p: with no indicator, while loading, or when the read
 * fails, nothing is drawn — no heading, no empty sentence, no banner.
 */
export function AssetDegradationSection({ assetId }: AssetDegradationSectionProps) {
  const headingId = useId();
  const asset = useAssetDegradation(assetId)?.assets[0];
  if (asset === undefined || asset.indicators.length === 0) {
    return null;
  }
  const note = asset.scheduleNotes[0];
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="font-condensed text-sm font-bold text-ink">
        {DEGRADATION_SECTION_TITLE}
      </h2>
      {asset.indicators.map((indicator) => (
        <div key={indicator.id} data-testid="degradation-indicator">
          <SectionCard
            title={DEGRADATION_NAME}
            actions={
              <>
                <span className="text-2xs text-ink-muted">{DEGRADATION_ESTIMATED_LABEL}</span>
                <StatusPill label="Advisory" tone="info" />
              </>
            }
          >
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-ink" data-testid="degradation-sentence">
                {indicator.sentence}
              </p>
              <p className="text-xs text-ink-muted" data-testid="degradation-detail">
                {indicator.detail}
              </p>
              <p className="text-xs text-ink-muted">{DEGRADATION_DISCLAIMER}</p>
              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer">Assumptions</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {indicator.assumptions.map((line, i) => (
                    <li key={i} data-testid="degradation-assumption">
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </SectionCard>
        </div>
      ))}
      {note ? (
        <p className="text-xs text-ink-muted" data-testid="degradation-schedule-note">
          {note.sentence}
        </p>
      ) : null}
    </section>
  );
}
