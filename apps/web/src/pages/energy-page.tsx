import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type {
  EnergyOrganizationViews,
  EnergyView,
  EnergyViewPeriod,
  EnergyViewQuery,
  PointAggregateBucket,
} from "@bms/shared";

import { fetchEnergyFilterOptions, fetchEnergyOrganizationViews, fetchEnergyView } from "../api/energy-view";
import { AbnormalList } from "../components/energy/abnormal-list";
import { EnergyHeatmap } from "../components/energy/energy-heatmap";
import { EnergyStackChart } from "../components/energy/energy-stack-chart";
import { SiteRankingTable, formatPeakTime } from "../components/energy/site-ranking-table";
import { EnergyFilterBar } from "../components/energy-filter-bar";
import { EnergySourceStackChart } from "../components/energy-source-stack-chart";
import { EnergyTopBarChart } from "../components/energy-top-bar-chart";
import { KpiTile, type KpiTileStatus } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { AppShell } from "../layouts/app-shell";
import { useChartTheme } from "../lib/chart-theme";
import { siteStacks } from "../lib/energy-organization-views";
import {
  type EnergyChange,
  type EnergyFilterValue,
  changeFor,
  defaultFilter,
  energyViewQueryOf,
  levelLabel,
  partialNote,
} from "../lib/energy-view-filter";
import { costTileProps, formatMoney } from "../lib/money";
import { pueTileProps } from "../lib/pue-tile";
import type { AuthUser } from "../stores/auth-store";

type EnergyPageProps = {
  user: AuthUser;
};

/** The change hint, e.g. `+12.5 % vs previous`; `undefined` when compare is off. */
function changeHint(change: EnergyChange): string | undefined {
  switch (change.kind) {
    case "none":
      return undefined;
    case "no_previous":
      return "no data for the previous period";
    case "no_previous_value":
      return "no figure for the previous period";
    case "change":
      if (change.pct === null) {
        return "no % change — the previous figure is zero";
      }
      return `${change.pct >= 0 ? "+" : ""}${change.pct.toFixed(1)} % vs previous`;
  }
}

/** The hint parts that are present, joined with ` · `. */
function joinHint(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined);
  return present.length === 0 ? undefined : present.join(" · ");
}

function wholeNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

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

type StackBy = "site" | "source";

const STACK_BY: readonly { key: StackBy; label: string }[] = [
  { key: "site", label: "Site" },
  { key: "source", label: "Source" },
];

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
 */
export function EnergyPage({ user }: EnergyPageProps) {
  const [chosen, setChosen] = useState<EnergyFilterValue | null>(null);
  const [stackBy, setStackBy] = useState<StackBy>("site");
  const { roles } = useChartTheme();

  const optionsQ = useQuery({
    queryKey: ["energy", "filter-options"],
    queryFn: fetchEnergyFilterOptions,
  });

  const options = optionsQ.data;
  const filter = chosen ?? (options !== undefined ? defaultFilter(options) : null);
  const query = filter === null ? null : energyViewQueryOf(filter);

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

  const noOrganization = options !== undefined && options.organizations.length === 0;
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
  const noKw = current !== undefined && !current.hasData;
  const kwStatus: KpiTileStatus = noKw ? "empty" : status;

  const totalHint = current ? changeHint(changeFor(current, compare, "totalKwh")) : undefined;
  const peakHint =
    current && v
      ? joinHint(
          current.peakAt !== null ? `Peak at ${formatPeakTime(current.peakAt, v.timeZone)}` : undefined,
          changeHint(changeFor(current, compare, "peakKw")),
        )
      : undefined;
  const pfStatus: KpiTileStatus = current?.avgPf === null ? "empty" : status;
  const pfHint =
    current === undefined
      ? undefined
      : current.avgPf === null
        ? "No pf point in scope"
        : (changeHint(changeFor(current, compare, "avgPf")) ?? "Sample average of the pf points in scope");

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
                onChange={setChosen}
                timeZone={viewQ.data?.timeZone ?? null}
              />
            ) : null
          }
        />

        {noOrganization ? (
          <p role="status" className="text-sm text-ink-muted">
            No organization is in your access.
          </p>
        ) : null}
        {note !== null ? (
          <p role="note" className="text-sm font-medium text-warning-ink">
            {note}
          </p>
        ) : null}

        {/*
          The `ESKOM_SMOC.html` `#/energy` KPI row order where it overlaps
          (total, peak with its time, PUE, cost), the change in the hint slot.
        */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile
            label="Total energy"
            status={kwStatus}
            value={current ? wholeNumber(current.totalKwh) : null}
            unit="kWh"
            hint={noKw ? "No kW data in this period" : totalHint}
          />
          <KpiTile
            label="Peak demand"
            status={kwStatus}
            value={current ? wholeNumber(current.peakKw) : null}
            unit="kW"
            hint={noKw ? "No kW data in this period" : peakHint}
          />
          <KpiTile
            label="Average PF"
            status={pfStatus}
            value={current?.avgPf != null ? current.avgPf.toFixed(2) : null}
            hint={pfHint}
          />
          {/* Decision 2.12 — the level read, the display bucket and the zone the buckets are in. */}
          <KpiTile
            label="Rollup"
            status={status}
            value={v ? v.level : null}
            hint={v ? levelLabel(v.level, v.bucket, v.timeZone) : undefined}
          />
          {/* `F2.8` — the windowed Σ site_kw / Σ it_kw, or a dash with a reason. */}
          <KpiTile label="PUE" {...pueTileProps(status, current?.pueEstimate)} />
          {/*
            `E4.1c` — the organization's currency carries the symbol, so the
            tile has no `unit`; a `null` cost (no tariff in scope, or two
            currencies) is the dash with the reason, never a 0.
          */}
          <KpiTile label="Indicative cost" {...costTileProps(status, current?.indicativeCost, current?.currency)} />
        </div>

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
                  onClick={() => setStackBy(option.key)}
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
              subtitle="Ranked by kWh or peak kW; the change against the previous period when compare is on"
            >
              <SiteRankingTable
                sites={ov?.sites}
                timeZone={ov?.timeZone ?? "Etc/UTC"}
                status={sectionStatus(ov?.sites.current.length)}
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
      </div>
    </AppShell>
  );
}
