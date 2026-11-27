import { useId } from "react";

import { useAssetAdvisories } from "../../hooks/use-asset-advisories";
import { AdvisoryCard } from "./advisory-card";

type AssetAdvisoriesSectionProps = {
  assetId: string;
};

/**
 * `E1.6b` / ADR 0137 (plan T2.5) — the asset history page's advisories: the asset's cards under a
 * heading "Advisories", without the asset link (the page is the asset's own). R-l: with no
 * advisory, while loading, or when the read fails, nothing is drawn — no heading, no empty
 * sentence, no banner.
 */
export function AssetAdvisoriesSection({ assetId }: AssetAdvisoriesSectionProps) {
  const headingId = useId();
  const advisories = useAssetAdvisories(assetId);
  if (advisories === undefined || advisories.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="font-condensed text-sm font-bold text-ink">
        Advisories
      </h2>
      {advisories.map((advisory) => (
        <AdvisoryCard key={advisory.id} advisory={advisory} showAsset={false} />
      ))}
    </section>
  );
}
