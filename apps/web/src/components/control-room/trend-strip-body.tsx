import type { SiteTrendStripDto, TrendStripPointDto, TrendStripRange, TrendStripSegmentDto } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { formatPointValue } from "../../lib/generated-site-view";
import { siteAssetsPath } from "../../lib/smoc-pages";
import { historyHref, lastValue, stripWindowLabel } from "../../lib/trend-strip";
import { SectionCard } from "../section-card";
import { Sparkline } from "./sparkline";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2, items 5–9) — the trend strip's body: one section per segment
 * the response carries, one row per trend point, one sparkline per asset (the server caps them), a
 * range switch, and the window line. Every label comes from the response — the strip names no
 * segment and never falls back to a literal one. One read per (tab, range), refreshed each minute:
 * a 24 h sparkline does not move in seconds.
 *
 * `F4.305` review (AGENTS.md §4.2, one exported component per file) — moved out of
 * `trend-strip.tsx` when a second file (`widgets/trend-strip-widget.tsx`) came to need it.
 */

const RANGES: readonly { readonly key: TrendStripRange; readonly label: string }[] = [
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 d" },
  { key: "30d", label: "30 d" },
];

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The trim line. `fitSeries` lowers the points cap only once the assets cap is at 1, so a
 * strip at 1 asset per point names the points cap too; its last phase drops trailing points,
 * which is the only way a segment arrives with `points: []`, so that case says points are hidden.
 */
function trimLine(strip: SiteTrendStripDto): string {
  const assets = `Trimmed to ${plural(strip.assetsPerPoint, "asset")} per point`;
  if (strip.assetsPerPoint > 1) return assets;
  const points = `${assets} and ${plural(strip.pointsPerSegment, "point")} per segment`;
  return strip.segments.some((segment) => segment.points.length === 0)
    ? `${points}; some points are not shown`
    : points;
}

function PointRow({
  point,
  range,
  locationId,
}: {
  point: TrendStripPointDto;
  range: TrendStripRange;
  locationId: string;
}) {
  return (
    <li aria-label={point.name} className="flex flex-col gap-2 border-t border-well-deep pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-ink">{point.name}</span>
        {point.unit !== null ? (
          <span data-role="point-unit" className="text-[11px] text-ink-muted">
            {point.unit}
          </span>
        ) : null}
      </div>
      <ul className="flex flex-wrap items-end gap-4">
        {point.assets.map((asset) => {
          const value = lastValue(asset.buckets);
          return (
            <li key={asset.assetId} className="flex flex-col gap-1">
              <Link
                to={historyHref(asset.assetId, range, point.code)}
                aria-label={`${asset.assetCode} ${point.name}: open history`}
                title={asset.assetName}
                className="rounded hover:bg-well focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Sparkline buckets={asset.buckets} label={`${asset.assetCode} ${point.name}`} />
              </Link>
              <span className="flex justify-between gap-2 text-[11px]">
                <span className="font-semibold text-ink-muted">{asset.assetCode}</span>
                <span className="tabular-nums text-ink">
                  {value === null || asset.unit === null
                    ? formatPointValue(value)
                    : `${formatPointValue(value)} ${asset.unit}`}
                </span>
              </span>
            </li>
          );
        })}
        {point.moreAssets > 0 ? (
          <li className="self-center">
            <Link
              to={siteAssetsPath(locationId)}
              className="text-xs font-semibold text-accent-strong hover:underline"
            >
              {`+${point.moreAssets} more`}
            </Link>
          </li>
        ) : null}
      </ul>
    </li>
  );
}

function SegmentCard({
  segment,
  range,
  locationId,
}: {
  segment: TrendStripSegmentDto;
  range: TrendStripRange;
  locationId: string;
}) {
  return (
    <SectionCard
      title={segment.label}
      subtitle={segment.source === "organization" ? "Organization list" : "Catalog default"}
    >
      <ul className="flex flex-col gap-3">
        {segment.points.map((point) => (
          <PointRow key={point.code} point={point} range={range} locationId={locationId} />
        ))}
      </ul>
    </SectionCard>
  );
}

type TrendStripBodyProps = {
  locationId: string;
  /** `null` is the whole site and sends no key. */
  assetGroupId: string | null;
  /** The range the switch starts on; the switch then owns it. */
  defaultRange: TrendStripRange;
  /** Drawn at the left of the range switch: the fixed mount's `h2`; a widget's frame has its own. */
  heading?: ReactNode;
};

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, plan call C7) — the strip without its mount: the range state,
 * the one read and the segments. The fixed mount (`TrendStrip`, `trend-strip.tsx`) and the
 * `trend_strip` dashboard widget (`widgets/trend-strip-widget.tsx`) both draw this, so the read,
 * the click target and the fixed failure sentences are written once.
 */
export function TrendStripBody({ locationId, assetGroupId, defaultRange, heading }: TrendStripBodyProps) {
  const [range, setRange] = useState<TrendStripRange>(defaultRange);
  const query = useQuery({
    queryKey: ["control-room", "trend-strip", locationId, assetGroupId, range],
    queryFn: () => fetchSiteTrendStrip(locationId, { range, assetGroupId }),
    refetchInterval: 60_000,
  });
  const strip = query.data;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-wrap items-center gap-3 ${heading === undefined ? "justify-end" : "justify-between"}`}
      >
        {heading}
        <nav aria-label="Trend range" className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={r.key === range}
              onClick={() => setRange(r.key)}
              className={`rounded border px-2 py-1 text-xs ${
                r.key === range ? "border-accent bg-accent text-on-accent font-semibold" : "border-line-strong"
              }`}
            >
              {r.label}
            </button>
          ))}
        </nav>
      </div>
      {query.isPending ? (
        <p role="status" className="text-xs text-ink-muted">
          Loading trends…
        </p>
      ) : strip === undefined ? (
        <p role="alert" className="text-xs text-critical">
          Could not load the trend strip.
        </p>
      ) : (
        <>
          {query.isError ? (
            <p role="alert" className="text-[11px] text-critical">
              Could not refresh the trend strip; showing the last read.
            </p>
          ) : null}
          {strip.segments.length === 0 ? (
            <p className="text-xs text-ink-muted">No trend points for the assets on this tab.</p>
          ) : (
            strip.segments.map((segment) => (
              <SegmentCard key={segment.domain} segment={segment} range={strip.range} locationId={locationId} />
            ))
          )}
          {strip.trimmed ? (
            <p className="text-[11px] text-ink-muted">{trimLine(strip)}</p>
          ) : null}
          <p className="text-[11px] text-ink-muted">
            {`Window: ${stripWindowLabel(strip.from, strip.to, strip.bucketSeconds, strip.timeZone)}`}
          </p>
        </>
      )}
    </div>
  );
}
