import {
  ASSET_LABEL_SEPARATOR,
  assetLabelOf,
  assetLabelParts,
  type SiteTrendStripDto,
  type TrendStripPointDto,
  type TrendStripRange,
  type TrendStripSegmentDto,
  type TrendStripWidgetConfig,
} from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { fetchSiteTrendStrip, type TrendStripRequest } from "../../api/trend-strip";
import { downloadTrendStripExport } from "../../api/view-exports";
import { formatPointValue } from "../../lib/generated-site-view";
import { siteAssetsPath } from "../../lib/smoc-pages";
import { historyHref, lastValue, pointStyleFor, strokeRoleFor, stripWindowLabel } from "../../lib/trend-strip";
import { SectionCard } from "../section-card";
import { ExportMenu } from "../view-actions/export-menu";
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

/** `F4.306` (ADR 0108 Amendment 7): a stored strip's selection; absent is the `F4.305` strip. */
export type TrendStripSelection = Pick<TrendStripWidgetConfig, "segments" | "points" | "colors" | "styles">;

/** The read's request: the selection's two lists only when present, so no selection is the `F4.305` request. */
function stripRequest(
  range: TrendStripRange,
  assetGroupId: string | null,
  selection: TrendStripSelection | undefined,
): TrendStripRequest {
  return {
    range,
    assetGroupId,
    ...(selection?.segments !== undefined ? { segments: selection.segments } : {}),
    ...(selection?.points !== undefined ? { points: selection.points } : {}),
  };
}

function PointRow({
  point,
  domain,
  colors,
  styles,
  range,
  locationId,
}: {
  point: TrendStripPointDto;
  /** The segment the point is in: with the point's code, the `colors` and `styles` key. */
  domain: string;
  colors: TrendStripSelection["colors"];
  /** `F4.322` PR 3 — each point's draw style; absent is `line`. */
  styles: TrendStripSelection["styles"];
  range: TrendStripRange;
  locationId: string;
}) {
  const stroke = strokeRoleFor(colors, domain, point.code);
  const drawStyle = pointStyleFor(styles, domain, point.code);
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
          const label = assetLabelOf(asset);
          // `F4.316` (ADR 0111): the `· where` part wraps under a narrow tile and is never truncated.
          const { code, where } = assetLabelParts({
            code: asset.assetCode,
            rtuName: asset.assetRtuName,
            locationName: asset.assetLocationName,
          });
          return (
            <li key={asset.assetId} className="flex flex-col gap-1">
              <Link
                to={historyHref(asset.assetId, range, point.code)}
                aria-label={`${label} ${point.name}: open history`}
                title={asset.assetName}
                className="rounded hover:bg-well focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Sparkline buckets={asset.buckets} label={`${label} ${point.name}`} stroke={stroke} drawStyle={drawStyle} />
              </Link>
              <span className="flex justify-between gap-2 text-[11px]">
                <span data-role="asset-label" className="min-w-0 break-words font-semibold text-ink-muted">
                  {code}
                  {where === null ? null : <span className="font-normal">{`${ASSET_LABEL_SEPARATOR}${where}`}</span>}
                </span>
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
  colors,
  styles,
  range,
  locationId,
}: {
  segment: TrendStripSegmentDto;
  colors: TrendStripSelection["colors"];
  styles: TrendStripSelection["styles"];
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
          <PointRow
            key={point.code}
            point={point}
            domain={segment.domain}
            colors={colors}
            styles={styles}
            range={range}
            locationId={locationId}
          />
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
  /**
   * `F4.303` U7 (ADR 0108 Amendment 6 item 3): draws the Export group. The fixed mount and the
   * widget pass `!wall` (a wall screen has no actions); no Link, Pin or Schedule on the strip.
   */
  exportable: boolean;
  /**
   * `F4.306` U9 (ADR 0108 Amendment 7, items 4 and 7): a stored strip's selection. `segments` and
   * `points` go in the read and its query key; `colors` strokes each point. Absent is `F4.305`.
   */
  selection?: TrendStripSelection;
};

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, plan call C7) — the strip without its mount: the range state,
 * the one read and the segments. The fixed mount (`TrendStrip`, `trend-strip.tsx`) and the
 * `trend_strip` dashboard widget (`widgets/trend-strip-widget.tsx`) both draw this, so the read,
 * the click target and the fixed failure sentences are written once.
 */
export function TrendStripBody({
  locationId,
  assetGroupId,
  defaultRange,
  heading,
  exportable,
  selection,
}: TrendStripBodyProps) {
  const [range, setRange] = useState<TrendStripRange>(defaultRange);
  const query = useQuery({
    queryKey: [
      "control-room",
      "trend-strip",
      locationId,
      assetGroupId,
      range,
      selection?.segments ?? null,
      selection?.points ?? null,
    ],
    queryFn: () => fetchSiteTrendStrip(locationId, stripRequest(range, assetGroupId, selection)),
    refetchInterval: 60_000,
  });
  const strip = query.data;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-wrap items-center gap-3 ${heading === undefined ? "justify-end" : "justify-between"}`}
      >
        {heading}
        {exportable ? (
          <ExportMenu onExport={(format) => downloadTrendStripExport(format, locationId, stripRequest(range, assetGroupId, selection))} />
        ) : null}
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
              <SegmentCard
                key={segment.domain}
                segment={segment}
                colors={selection?.colors}
                styles={selection?.styles}
                range={strip.range}
                locationId={locationId}
              />
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
