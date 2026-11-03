import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { EnergyOrganizationViews, EnergyView, EnergyViewPeriod, EnergyViewQuery, PointAggregateBucket } from "@bms/shared";

import { fetchEnergyOrganizationViews, fetchEnergyView } from "../../api/energy-view";
import type { SiteRankingSort } from "../../lib/energy-organization-views";
import { partialNote } from "../../lib/energy-view-filter";
import { siteEnergyQueryOf } from "../../lib/site-trends";
import { AbnormalList } from "../energy/abnormal-list";
import { EnergyHeatmap } from "../energy/energy-heatmap";
import { EnergyKpiTiles } from "../energy/energy-kpi-tiles";
import type { RangeCompareValue } from "../energy/range-compare-controls";
import { SiteRankingTable } from "../energy/site-ranking-table";
import { EnergySourceStackChart } from "../energy-source-stack-chart";
import { EnergyTopBarChart } from "../energy-top-bar-chart";
import type { KpiTileStatus } from "../kpi-tile";
import { SectionCard } from "../section-card";

type Props = {
  locationId: string;
  /** The section's range and compare, owned by `SiteTrendsView`. */
  value: RangeCompareValue;
  /** The site ranking's sort, the section's `rankBy` in the URL (`F4.303`). */
  rankBy: SiteRankingSort;
  onRankBy: (next: SiteRankingSort) => void;
};

function viewOf(query: EnergyViewQuery | null): Promise<EnergyView> {
  // Unreachable: the query is disabled while `query` is null.
  return query === null ? Promise.reject(new Error("no energy view query")) : fetchEnergyView(query);
}

function organizationViewsOf(query: EnergyViewQuery | null): Promise<EnergyOrganizationViews> {
  // Unreachable: the query is disabled while `query` is null.
  return query === null ? Promise.reject(new Error("no energy view query")) : fetchEnergyOrganizationViews(query);
}

/** The previous period's total kW per bucket (grid + DG + solar), for the dashed overlay; `null` without one. */
function compareTotalOf(compare: EnergyViewPeriod | null): PointAggregateBucket[] | null {
  if (compare === null || !compare.hasData) {
    return null;
  }
  return compare.series.map((p) => ({ t: p.t, v: p.gridKw + p.dgKw + p.solarKw }));
}

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 3) — the Energy sub-tab: `GET /reports/energy/view`
 * and `GET /reports/energy/organization-views` with `locationIds=[site]` and no
 * `organizationId` (`siteEnergyQueryOf`), so an unreadable site is a 403 before any read and the
 * zone is the site's. The Energy page's sections, each the same component: the KPI tiles, the
 * source mix with the previous period dashed, the top consuming assets, the heatmap and the
 * advisory abnormal list. The site ranking shows only when the site has readable children
 * (`sites.totalSites > 1`, owner 2026-11-02); on a flat site it is omitted.
 */
export function SiteEnergyView({ locationId, value, rankBy, onRankBy }: Props) {
  const query = siteEnergyQueryOf(locationId, value);

  const viewQ = useQuery({
    queryKey: ["energy", "view", query],
    queryFn: () => viewOf(query),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const orgViewsQ = useQuery({
    queryKey: ["energy", "organization-views", query],
    queryFn: () => organizationViewsOf(query),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const status: KpiTileStatus = viewQ.isError ? "error" : viewQ.data === undefined ? "loading" : "ready";
  const v = status === "ready" ? viewQ.data : undefined;
  const current = v?.current;
  const compare = v?.compare ?? null;
  const note = v ? partialNote(v.partial) : null;
  const chartStatus = (count: number | undefined): KpiTileStatus =>
    status !== "ready" ? status : count === 0 ? "empty" : "ready";

  // The two reads resolve at different times; while one holds the new range and the other the
  // old, the organization sections wait (the Energy page's rule).
  const mixedAnswers = viewQ.isPlaceholderData !== orgViewsQ.isPlaceholderData;
  const orgStatus: KpiTileStatus = orgViewsQ.isError
    ? "error"
    : orgViewsQ.data === undefined || mixedAnswers
      ? "loading"
      : "ready";
  const ov = orgStatus === "ready" ? orgViewsQ.data : undefined;
  const sectionStatus = (count: number | undefined): KpiTileStatus =>
    orgStatus !== "ready" ? orgStatus : count === 0 ? "empty" : "ready";

  const compareTotal = useMemo(() => compareTotalOf(compare), [compare]);
  const spanMs = current && compare ? Date.parse(current.from) - Date.parse(compare.from) : 0;
  const showsSiteRanking = ov !== undefined && ov.sites.totalSites > 1;

  return (
    <div className="space-y-4">
      {note !== null ? (
        <p role="note" className="text-sm font-medium text-warning-ink">
          {note}
        </p>
      ) : null}

      {/*
        `F4.304` item 8: the seventh tile, kWh per m² on the site's own assets.
        "Readable children" is the ranking's own test (`totalSites > 1`).
      */}
      <EnergyKpiTiles status={status} view={v} floorAreaTile={{ hasReadableChildren: showsSiteRanking }} />

      <SectionCard
        title="Source mix · grid / solar / nominal DG"
        subtitle="The previous period dashed when compare is on"
      >
        <EnergySourceStackChart
          points={current?.series ?? []}
          status={chartStatus(current?.series.length)}
          compareTotal={compareTotal}
          spanMs={spanMs}
        />
      </SectionCard>

      {orgViewsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          Could not load the site&apos;s energy views.
        </p>
      ) : null}

      <div className={`grid gap-4 ${showsSiteRanking ? "lg:grid-cols-2" : ""}`}>
        {showsSiteRanking ? (
          <SectionCard
            title="Top consuming sites"
            subtitle="This site and its readable children, by kWh, peak kW or kWh per m²"
          >
            <SiteRankingTable
              sites={ov.sites}
              timeZone={ov.timeZone}
              status={sectionStatus(ov.sites.current.length)}
              sort={rankBy}
              onSort={onRankBy}
            />
          </SectionCard>
        ) : null}
        <SectionCard
          title="Top consuming assets"
          subtitle="Ranked by average kW; bar length approximates energy over the selected period"
        >
          <EnergyTopBarChart consumers={v?.topConsumers ?? []} status={chartStatus(v?.topConsumers.length)} />
        </SectionCard>
      </div>

      {orgViewsQ.isError ? null : (
        <>
          <SectionCard
            title="Consumption heatmap · kWh by day and hour"
            subtitle={ov ? `Local days and hours in ${ov.timeZone}` : undefined}
          >
            <EnergyHeatmap cells={ov?.heatmap.cells ?? []} status={sectionStatus(ov?.heatmap.cells.length)} />
          </SectionCard>

          <SectionCard
            title="Abnormal consumption · advisory"
            subtitle="Assets far above their own recent baseline; never an alarm"
          >
            <AbnormalList abnormal={ov?.abnormal} status={orgStatus} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
