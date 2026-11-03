import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type {
  EnergyOrganizationViews,
  EnergyView,
  EnergyViewPeriod,
  EnergyViewQuery,
  PointAggregateBucket,
} from "@bms/shared";

import { fetchEnergyFilterOptions, fetchEnergyOrganizationViews, fetchEnergyView } from "../api/energy-view";
import { AbnormalList } from "../components/energy/abnormal-list";
import { EnergyKpiTiles } from "../components/energy/energy-kpi-tiles";
import { EnergyHeatmap } from "../components/energy/energy-heatmap";
import { EnergyStackChart } from "../components/energy/energy-stack-chart";
import { SiteRankingTable } from "../components/energy/site-ranking-table";
import { EnergyFilterBar } from "../components/energy-filter-bar";
import { EnergySourceStackChart } from "../components/energy-source-stack-chart";
import { EnergyTopBarChart } from "../components/energy-top-bar-chart";
import { type KpiTileStatus } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { CopyLinkButton } from "../components/view-actions/copy-link-button";
import { AppShell } from "../layouts/app-shell";
import { useChartTheme } from "../lib/chart-theme";
import { type SiteRankingSort, siteStacks } from "../lib/energy-organization-views";
import { type EnergyFilterValue, energyViewQueryOf, partialNote } from "../lib/energy-view-filter";
import { formatMoney } from "../lib/money";
import {
  type EnergyLink,
  type StackBy,
  energyFilterOfLink,
  energyLinkFromSearch,
  energyLinkOfFilter,
  energyLinkToSearch,
} from "../lib/view-links";
import type { AuthUser } from "../stores/auth-store";

type EnergyPageProps = {
  user: AuthUser;
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

const STACK_BY: readonly { key: StackBy; label: string }[] = [
  { key: "site", label: "Site" },
  { key: "source", label: "Source" },
];

/** A link that names an organization or a site the reader's filter options do not list. */
const FOREIGN_LINK_SENTENCE = "This link names an organization or a site you cannot open.";

/**
 * `F4.298` U6 (ADR 0108 decision 2) — the Energy Centre on
 * `GET /reports/energy/view`: the filter (organization, locations, range,
 * custom from/to, compare), six KPI tiles with the change against the previous
 * period, and the source mix and the top consumers, all from one response.
 *
 * `F4.299` U6 (Amendment 1) — the four organization views from
 * `GET /reports/energy/organization-views`, asked with the same query: the
 * load profile stacked by site (or by source), the sites ranked, the day x
 * hour heatmap and the advisory abnormal list. The two reads are separate, so
 * the KPI tiles paint first and a slow or failed organization read touches only
 * its own sections (owner answer 2).
 *
 * The filter starts from `defaultFilter` (the first readable organization,
 * owner answer Q3), and no view is asked while no organization is chosen —
 * there is no fleet-wide view. The previous answer stays on screen while a new
 * filter loads, so the custom pickers keep the view's zone.
 *
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2) — the filter, the stack choice and
 * the ranking sort live in the URL (`view-links.ts`), so the address bar is the
 * link and "Copy link" ends the filter bar. A link never widens access: an
 * organization or a site that `energy/filter-options` does not list for the
 * reader is not sent; the page says so and offers the reader's default filter.
 */
export function EnergyPage({ user }: EnergyPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const link = useMemo(() => energyLinkFromSearch(searchParams), [searchParams]);
  const { stackBy, rankBy } = link;
  const { roles } = useChartTheme();

  const optionsQ = useQuery({
    queryKey: ["energy", "filter-options"],
    queryFn: fetchEnergyFilterOptions,
  });

  const options = optionsQ.data;
  const noOrganization = options !== undefined && options.organizations.length === 0;
  const filter = options !== undefined ? energyFilterOfLink(link, options) : null;
  const foreignLink = options !== undefined && !noOrganization && filter === null;
  const query = filter === null ? null : energyViewQueryOf(filter);

  const writeLink = (next: EnergyLink): void => {
    setSearchParams(energyLinkToSearch(next), { replace: true });
  };
  const writeState = (nextFilter: EnergyFilterValue | null, nextStackBy: StackBy, nextRankBy: SiteRankingSort): void => {
    writeLink(
      options !== undefined && nextFilter !== null
        ? energyLinkOfFilter(nextFilter, options, nextStackBy, nextRankBy)
        : { ...link, stackBy: nextStackBy, rankBy: nextRankBy },
    );
  };

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

  const status: KpiTileStatus =
    optionsQ.isError || viewQ.isError
      ? "error"
      : noOrganization
        ? "empty"
        : viewQ.data === undefined
          ? "loading"
          : "ready";

  const v = status === "ready" ? viewQ.data : undefined;
  const current = v?.current;
  const compare = v?.compare ?? null;
  const note = v ? partialNote(v.partial) : null;

  const chartStatus = (count: number | undefined): KpiTileStatus =>
    status !== "ready" ? status : count === 0 ? "empty" : "ready";

  // Both reads keep the previous answer while a new filter loads and resolve at
  // different times. When one holds the new filter and the other the old, the
  // organization sections wait: else the old sites (or a 7 d stack under a 30 d
  // dashed compare) would be drawn under the new KPI tiles.
  const mixedAnswers = viewQ.isPlaceholderData !== orgViewsQ.isPlaceholderData;
  const orgStatus: KpiTileStatus =
    optionsQ.isError || orgViewsQ.isError
      ? "error"
      : noOrganization
        ? "empty"
        : orgViewsQ.data === undefined || mixedAnswers
          ? "loading"
          : "ready";
  const ov = orgStatus === "ready" ? orgViewsQ.data : undefined;
  const sectionStatus = (count: number | undefined): KpiTileStatus =>
    orgStatus !== "ready" ? orgStatus : count === 0 ? "empty" : "ready";

  // The compare total is `/view`'s previous series summed per bucket, drawn
  // dashed over the current period (ADR 0108 decision 1.3).
  const compareTotal = useMemo(() => compareTotalOf(compare), [compare]);
  const spanMs = current && compare ? Date.parse(current.from) - Date.parse(compare.from) : 0;
  const bySite = useMemo(() => (ov ? siteStacks(ov.trend, roles) : []), [ov, roles]);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ink">Energy Analytics · multi-site consumption</span>
          {/*
            `E4.1c` — the tariff is the organization's `energy_tariff_per_kwh`
            parameter in its own currency, or nothing: a `null` tariff (none
            entered, or two currencies in scope) renders no ribbon text rather
            than `R null`.
          */}
          {current && current.tariffPerKwh !== null && current.currency !== null ? (
            <span className="hidden text-ink-muted sm:inline">
              Tariff {formatMoney(current.tariffPerKwh, current.currency, 2)}/kWh
            </span>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.en"
          title="Energy Centre"
          subtitle="kWh from electrical telemetry · source mix · top loads"
          actions={
            options !== undefined && filter !== null && !noOrganization ? (
              <EnergyFilterBar
                options={options}
                value={filter}
                onChange={(next) => writeState(next, stackBy, rankBy)}
                timeZone={viewQ.data?.timeZone ?? null}
                actions={<CopyLinkButton />}
              />
            ) : null
          }
        />

        {noOrganization ? (
          <p role="status" className="text-sm text-ink-muted">
            No organization is in your access.
          </p>
        ) : null}
        {foreignLink ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-critical-ink">
            <span>{FOREIGN_LINK_SENTENCE}</span>
            <button
              type="button"
              className="rounded border border-line-strong px-2 py-1 text-xs text-ink"
              onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
            >
              Use my default filter
            </button>
          </div>
        ) : null}
        {note !== null ? (
          <p role="note" className="text-sm font-medium text-warning-ink">
            {note}
          </p>
        ) : null}

        {foreignLink ? null : (
          <>
            <EnergyKpiTiles status={status} view={v} />

            {/*
              `ESKOM_SMOC.html` `#/energy` load profile card: the total stacked by
              site (the server's top sites plus "Other sites") or by source, the
              previous period's total dashed when compare is on.
            */}
            <SectionCard
              title={stackBy === "site" ? "Load profile · total kW by site" : "Source mix · grid / solar / nominal DG"}
              subtitle={
                stackBy === "site"
                  ? "The largest sites by kWh, the rest as Other sites; the previous period dashed when compare is on"
                  : "Solar from assets with code PV*; DG remains a narrative slice until metered"
              }
              actions={
                <div role="group" aria-label="Stack by" className="flex items-center gap-1 text-xs">
                  <span className="text-ink-muted">Stack by:</span>
                  {STACK_BY.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={stackBy === option.key}
                      className={`rounded border px-2 py-1 text-xs ${
                        stackBy === option.key ? "border-accent bg-accent text-on-accent font-semibold" : "border-line-strong"
                      }`}
                      onClick={() => writeState(filter, option.key, rankBy)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            >
              {stackBy === "site" ? (
                <EnergyStackChart
                  stacks={bySite}
                  compareTotal={compareTotal}
                  spanMs={spanMs}
                  status={sectionStatus(ov?.trend.points.length)}
                />
              ) : (
                <EnergySourceStackChart
                  points={current?.series ?? []}
                  status={chartStatus(current?.series.length)}
                  compareTotal={compareTotal}
                  spanMs={spanMs}
                />
              )}
            </SectionCard>

            {orgViewsQ.isError ? (
              <p role="alert" className="text-sm text-critical-ink">
                Could not load the organization views.
              </p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              {orgViewsQ.isError ? null : (
                <SectionCard
                  title="Top consuming sites"
                  subtitle="Ranked by kWh, peak kW or kWh per m²; the change against the previous period when compare is on"
                >
                  <SiteRankingTable
                    sites={ov?.sites}
                    timeZone={ov?.timeZone ?? "Etc/UTC"}
                    status={sectionStatus(ov?.sites.current.length)}
                    sort={rankBy}
                    onSort={(next) => writeState(filter, stackBy, next)}
                  />
                </SectionCard>
              )}
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
                  subtitle="Sites and assets far above their own recent baseline; never an alarm"
                >
                  <AbnormalList abnormal={ov?.abnormal} status={orgStatus} />
                </SectionCard>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
