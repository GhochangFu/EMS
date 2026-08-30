import type { AssetHealthResponse } from "@bms/shared";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthBandDisplay,
  unscoredTagMessage,
} from "../../lib/asset-health-view";
import { formatBucketWidth } from "../../lib/widget-value";

type AssetHealthCardProps = {
  title?: string;
  data: AssetHealthResponse;
};

/**
 * `E1.3` Unit 8 — one asset's score, its band, and the tag breakdown behind
 * it (ADR 0050 + Amendment 1 decision 5).
 *
 * **The two null cases render as two different sentences, not one.**
 * `data.score === null` (absence 1 — nothing on this asset could be scored)
 * shows no band at all, because there is no score for a band to describe.
 * `data.score !== null && data.band === null` (absence 2 — the template
 * configures no bands) shows the real score AND says the band is
 * unconfigured. Collapsing these into one "no data" reading is exactly the
 * failure `packages/shared/src/contracts/health.ts`'s docblock names.
 */
export function AssetHealthCard({ title = "Asset Health", data }: AssetHealthCardProps) {
  const hasScore = data.score !== null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-bms-muted">{title}</h3>

      <div className="flex items-baseline gap-2">
        <span className="font-condensed text-3xl font-bold tabular-nums text-bms-ink">
          {formatHealthScorePercent(data.score)}
        </span>
        <span className="text-xs text-bms-muted">
          {hasScore
            ? healthBandDisplay(data.band)
            : "Not scorable — no tag on this asset carries an evaluatable rule"}
        </span>
      </div>

      {data.scoredTags.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-bms-muted">Scored tags</h4>
          <ul className="mt-1 space-y-1 text-xs text-bms-ink">
            {data.scoredTags.map((tag) => (
              <li key={tag.pointKey} className="flex items-center justify-between gap-2">
                <span>{tag.pointKey}</span>
                <span className="tabular-nums text-bms-muted">
                  {formatHealthScorePercent(tag.score, 1)} · {tag.inRangeCount}/{tag.sampleCount} · weight{" "}
                  {tag.weight}
                  {tag.skippedRuleCount > 0 ? ` · ${tag.skippedRuleCount} rule(s) skipped` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.unscoredTags.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-bms-muted">
            Unscored tags
          </h4>
          <ul className="mt-1 space-y-1 text-xs text-bms-muted">
            {data.unscoredTags.map((tag) => (
              <li key={tag.pointKey}>{unscoredTagMessage(tag)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-bms-muted">
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Granularity</dt>
          <dd className="text-bms-ink">{formatBucketWidth(data.bucketSeconds)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Current to</dt>
          <dd className="text-bms-ink">{formatHealthComputedAt(data.computedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
