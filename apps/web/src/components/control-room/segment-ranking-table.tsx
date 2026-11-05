import { useState } from "react";
import { Link } from "react-router-dom";

import { assetLabelOf, type SegmentViewPeriodDto, type SegmentViewRankingEntryDto } from "@bms/shared";

import { historyHrefFor, meanChangePct, sortRanking, type RankingSort } from "../../lib/site-trends";
import { formatPeakTime } from "../energy/site-ranking-table";

type Props = {
  ranking: readonly SegmentViewRankingEntryDto[];
  /** The assets past the ranking cap, a count only. */
  moreAssets: number;
  pointCode: string;
  period: SegmentViewPeriodDto;
  /** Compare is on: the change column shows. */
  compare: boolean;
  /** The site's zone: the max time is wall time there, never the browser's. */
  timeZone: string;
};

const SORTS: readonly { key: RankingSort; label: string }[] = [
  { key: "mean", label: "Mean" },
  { key: "max", label: "Max" },
];

function figure(value: number, unit: string | null): string {
  const text = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit === null ? text : `${text} ${unit}`;
}

/** Ruling 4.6: a percent only with a previous-period row and a non-zero previous mean. */
function changeText(pct: number | null | undefined): string {
  if (pct === undefined || pct === null) {
    return "—";
  }
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)} %`;
}

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 4, 7) — the segment's assets for one point, ranked by
 * the weighted mean (the server's order) or by max, with the change against the previous period
 * when compare is on. The server sends at most `SEGMENT_RANKING_MAX` assets and the rest as a
 * count. Each asset opens its history over the exact window.
 */
export function SegmentRankingTable({ ranking, moreAssets, pointCode, period, compare, timeZone }: Props) {
  const [sort, setSort] = useState<RankingSort>("mean");
  const rows = sortRanking(ranking, sort);

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Rank by" className="flex items-center gap-1 text-xs">
        <span className="text-ink-muted">Rank by:</span>
        {SORTS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={sort === option.key}
            className={`rounded border px-2 py-1 text-xs ${
              sort === option.key ? "border-accent bg-accent text-on-accent font-semibold" : "border-line-strong"
            }`}
            onClick={() => setSort(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Asset</th>
            <th className="px-3 py-2 text-right">Mean</th>
            <th className="px-3 py-2 text-right">Max</th>
            <th className="px-3 py-2">Max at</th>
            {compare ? <th className="px-3 py-2 text-right">Change</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.assetId} data-testid="segment-ranking-row" className="border-b border-well-deep">
              <td className="px-3 py-1.5 text-xs">
                <Link
                  to={historyHrefFor(entry.assetId, period, pointCode, compare)}
                  className="font-semibold text-accent-strong hover:underline"
                >
                  {entry.assetName}
                </Link>
                <span className="ml-1 text-ink-muted">{assetLabelOf(entry)}</span>
              </td>
              <td className="px-3 py-1.5 text-right text-xs tabular-nums">{figure(entry.current.mean, entry.unit)}</td>
              <td className="px-3 py-1.5 text-right text-xs tabular-nums">{figure(entry.current.max, entry.unit)}</td>
              <td className="px-3 py-1.5 text-xs">
                {entry.current.maxAt === null ? "—" : formatPeakTime(entry.current.maxAt, timeZone)}
              </td>
              {compare ? (
                <td data-testid="segment-change" className="px-3 py-1.5 text-right text-xs tabular-nums">
                  {changeText(meanChangePct(entry))}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {moreAssets > 0 ? <p className="text-xs text-ink-muted">{`+${moreAssets} more assets not listed`}</p> : null}
    </div>
  );
}
