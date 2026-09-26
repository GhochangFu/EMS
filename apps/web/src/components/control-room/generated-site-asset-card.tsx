import { useState } from "react";

import { HEADLINE_POINT_COUNT } from "@bms/shared/contracts";
import type { GeneratedSiteAssetDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import {
  assetStatus,
  formatPointValue,
  headlinePoints,
  type AssetStatus,
} from "../../lib/generated-site-view";
import { isStale, readingTimestampMs } from "../../lib/schematic-telemetry";
import { StatusPill } from "../status-pill";

/**
 * `F3.68` U6 — one asset of a generated site view: its code, name, live status
 * and its first `HEADLINE_POINT_COUNT` points, with "All points" expanding the
 * card inline and "Fewer points" collapsing it (OQ2). The pill labels and
 * tones are the location page's freshness tones (AGENTS.md §5).
 *
 * **Owner ruling (2026-09-26, ADR 0076 Amendment 1).** ADR 0027 decision 3
 * blanks a stale value; this view keeps it, dimmed, with the pill reading
 * Stale — each row judges its own `latest.time` with the shared `isStale`
 * gate, independent of the asset-level status pill. A row with no sample at
 * all (`latest === null`) already prints the shared dash and carries no value
 * to dim.
 */

const STATUS_LABEL: Record<AssetStatus, string> = { live: "Live", stale: "Stale", none: "None" };
const STATUS_TONE: Record<AssetStatus, "ok" | "warning" | "offline"> = {
  live: "ok",
  stale: "warning",
  none: "offline",
};

export function GeneratedSiteAssetCard({
  asset,
  readings,
}: {
  asset: GeneratedSiteAssetDto;
  readings: SiteLiveReadings;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = assetStatus(readings.assetLastSeenMs(asset), readings.nowMs);
  const shown = headlinePoints(asset.points, expanded);

  return (
    <article
      aria-label={`${asset.code} ${asset.name}`}
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-condensed text-sm font-bold text-bms-ink">{asset.code}</p>
          <p className="truncate text-[11px] text-bms-muted">{asset.name}</p>
        </div>
        <span data-testid="asset-status">
          <StatusPill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
        </span>
      </div>

      {asset.points.length === 0 ? (
        <p className="mt-2 text-[11px] text-bms-muted">No registered points.</p>
      ) : (
        <table aria-label={`${asset.code} points`} className="mt-2 w-full text-xs">
          <tbody>
            {shown.map((point) => {
              const latest = readings.pointLatest(asset.id, point);
              const rowStale =
                latest !== null &&
                isStale(readingTimestampMs(latest.time, readings.nowMs), readings.nowMs);
              return (
                <tr key={point.pointKey} className="border-t border-gray-100">
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-bms-muted">
                    {point.name ?? point.pointKey}
                  </th>
                  <td
                    data-testid="point-value"
                    className={`py-1 text-right font-semibold tabular-nums text-bms-ink${rowStale ? " opacity-50" : ""}`}
                  >
                    {formatPointValue(latest?.value ?? null)}
                  </td>
                  <td className="py-1 pl-1 text-left text-[11px] text-bms-muted">
                    {latest === null ? "" : (point.unit ?? "")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {asset.points.length > HEADLINE_POINT_COUNT ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="mt-2 text-[11px] font-semibold text-bms-green"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Fewer points" : "All points"}
        </button>
      ) : null}
    </article>
  );
}
