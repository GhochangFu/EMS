import type { AssetHealthResponse } from "@bms/shared";
import type { AssetHealthInputsResponse } from "@bms/shared/contracts";

import {
  advisoryLine,
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthBandDisplay,
  healthInputRows,
  healthWindowCoverage,
  unscoredTagMessage,
} from "../../lib/asset-health-view";
import { formatBucketWidth } from "../../lib/widget-value";
import { StatusPill } from "../status-pill";

type AssetHealthCardProps = {
  title?: string;
  data: AssetHealthResponse;
  /**
   * `E1.8b` (ADR 0050 Amendment 5) — the SOW §4.3 five inputs. Absent (not read yet, or the read
   * failed): the card is exactly what it was before, with no error text.
   */
  inputs?: AssetHealthInputsResponse;
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
export function AssetHealthCard({ title = "Asset Health", data, inputs }: AssetHealthCardProps) {
  const hasScore = data.score !== null;
  const coverage = healthWindowCoverage(data.coveredBuckets, data.expectedBuckets);
  // R-b: from the score this card shows, never from another number.
  const advisory = inputs ? advisoryLine(data.score, inputs.anomalyHistory) : null;

  return (
    <div className="flex h-full flex-col surface-raised p-3">
      <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-muted">{title}</h3>

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

      {/* `E1.8b` — after the score and smaller, never in its place. No band colour: it has no band. */}
      {advisory !== null ? (
        <div data-testid="health-advisory-line" className="mt-1 text-xs text-ink-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-ink">{advisory.text}</span>
            <StatusPill label="Advisory" tone="info" />
          </div>
          <p className="mt-0.5 text-2xs">{advisory.caption}</p>
        </div>
      ) : null}

      {data.scoredTags.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-3xs font-semibold uppercase tracking-wide text-ink-muted">Scored tags</h4>
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
          <h4 className="text-3xs font-semibold uppercase tracking-wide text-ink-muted">
            Unscored tags
          </h4>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            {data.unscoredTags.map((tag) => (
              <li key={tag.pointKey}>{unscoredTagMessage(tag)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {inputs ? (
        <div data-testid="health-inputs" className="mt-3">
          <h4 className="text-3xs font-semibold uppercase tracking-wide text-ink-muted">
            Health inputs (SOW §4.3)
          </h4>
          <ul className="mt-1 space-y-1 text-xs">
            {healthInputRows(data, inputs).map((row) => (
              <li key={row.key}>
                <span data-input-label className="text-ink">
                  {row.label}
                </span>
                {row.detail !== null ? <span className="block text-ink-muted">{row.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-well-deep pt-2 text-2xs text-ink-muted">
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
        <p className="mt-2 rounded border border-warning-line bg-warning-wash px-2 py-1 text-2xs leading-snug text-warning-ink">
          {coverage.warning}
        </p>
      ) : null}
    </div>
  );
}
