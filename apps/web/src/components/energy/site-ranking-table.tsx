import { useState } from "react";

import type { EnergySiteRanking } from "@bms/shared";

import { rankingRows, type SiteChange, type SiteRankingSort } from "../../lib/energy-organization-views";
import type { EnergySectionStatus } from "./energy-stack-chart";

type Props = {
  sites: EnergySiteRanking | undefined;
  /** The view's zone: the peak time is wall time there, never the browser's. */
  timeZone: string;
  status: EnergySectionStatus;
};

const SORTS: readonly { key: SiteRankingSort; label: string }[] = [
  { key: "kwh", label: "kWh" },
  { key: "peakKw", label: "Peak kW" },
];

/**
 * A peak time as wall time in `zone` (ADR 0108 Status ruling c): a fixed
 * `en-GB` day-month-time shape, because a 1 y view's peak needs its date.
 */
export function formatPeakTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Ruling 4.6: a percent only when the site is in both lists and the previous kWh is above zero. */
function changeText(change: SiteChange): string {
  switch (change.kind) {
    case "none":
      return "—";
    case "no_previous":
      return "no data for the previous period";
    case "change":
      return change.pct === null ? "—" : `${change.pct >= 0 ? "+" : ""}${change.pct.toFixed(1)} %`;
  }
}

function wholeNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * `F4.299` U6 (ADR 0108 Amendment 1, 7.4) — the sites ranked by kWh or by peak
 * kW, with the change against the previous period when compare is on. The
 * server sends at most `SITE_RANKING_MAX` sites and the count before the cut.
 */
export function SiteRankingTable({ sites, timeZone, status }: Props) {
  const [sort, setSort] = useState<SiteRankingSort>("kwh");

  if (status === "loading") {
    return <p className="px-1 py-4 text-sm text-ink-muted">Loading the sites…</p>;
  }
  if (status === "error") {
    return <p className="px-1 py-4 text-sm text-critical-ink">Could not load the sites.</p>;
  }
  if (status === "empty" || sites === undefined || sites.current.length === 0) {
    return <p className="px-1 py-4 text-sm text-ink-muted">No site has kW data in this period.</p>;
  }

  const rows = rankingRows(sites.current, sites.compare, sort);

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
            <th className="px-3 py-2">Site</th>
            <th className="px-3 py-2 text-right">kWh</th>
            <th className="px-3 py-2 text-right">Peak kW</th>
            <th className="px-3 py-2">Peak at</th>
            <th className="px-3 py-2">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.site.locationId} data-testid="site-ranking-row" className="border-b border-well-deep">
              <td className="px-3 py-1.5 text-xs">{row.site.name}</td>
              <td className="px-3 py-1.5 text-right text-xs tabular-nums">{wholeNumber(row.site.kwh)}</td>
              <td className="px-3 py-1.5 text-right text-xs tabular-nums">{row.site.peakKw.toFixed(1)}</td>
              <td className="px-3 py-1.5 text-xs">
                {row.site.peakAt !== null ? formatPeakTime(row.site.peakAt, timeZone) : "—"}
              </td>
              <td className="px-3 py-1.5 text-xs">{changeText(row.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sites.totalSites > sites.current.length ? (
        <p className="text-xs text-ink-muted">{`Showing ${sites.current.length} of ${sites.totalSites} sites`}</p>
      ) : null}
    </div>
  );
}
