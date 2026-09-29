import type { AssetHealthResponse } from "@bms/shared";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthBandDisplay,
  healthWindowCoverage,
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
  const coverage = healthWindowCoverage(data.coveredBuckets, data.expectedBuckets);

  return (
    <div className="flex h-full flex-col surface-raised p-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{title}</h3>

      <div className="flex items-baseline gap-2">
        <span className="font-condensed text-3xl font-bold tabular-nums text-ink">
          {formatHealthScorePercent(data.score)}
        </span>
        <span className="text-xs text-ink-muted">
          {hasScore
            ? healthBandDisplay(data.band)
            : "Not scorable — no tag on this asset carries an evaluatable rule"}
        </span>
      </div>

      {data.scoredTags.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Scored tags</h4>
          <ul className="mt-1 space-y-1 text-xs text-ink">
            {data.scoredTags.map((tag) => (
              <li key={tag.pointKey} className="flex items-center justify-between gap-2">
                <span>{tag.pointKey}</span>
                <span className="tabular-nums text-ink-muted">
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
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Unscored tags
          </h4>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            {data.unscoredTags.map((tag) => (
              <li key={tag.pointKey}>{unscoredTagMessage(tag)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-well-deep pt-2 text-[11px] text-ink-muted">
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Granularity</dt>
          <dd className="text-ink">{formatBucketWidth(data.bucketSeconds)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Current to</dt>
          <dd className="text-ink">{formatHealthComputedAt(data.computedAt)}</dd>
        </div>
        {/* `F4.72` — the pair, always shown. `computedAt` is the NEWEST instant
            read, so on its own it reports a half-covered window exactly as it
            reports a whole one (ADR 0050 Amendment 2 decision 1). */}
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Coverage</dt>
          <dd className="tabular-nums text-ink">{coverage.detail}</dd>
        </div>
      </dl>

      {coverage.warning !== null ? (
        <p className="mt-2 rounded border border-warning-line bg-warning-wash px-2 py-1 text-[11px] leading-snug text-warning-ink">
          {coverage.warning}
        </p>
      ) : null}
    </div>
  );
}
