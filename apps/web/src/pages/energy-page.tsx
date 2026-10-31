import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { EnergyView, EnergyViewQuery } from "@bms/shared";

import { fetchEnergyFilterOptions, fetchEnergyView } from "../api/energy-view";
import { EnergyFilterBar } from "../components/energy-filter-bar";
import { EnergySourceStackChart } from "../components/energy-source-stack-chart";
import { EnergyTopBarChart } from "../components/energy-top-bar-chart";
import { KpiTile, type KpiTileStatus } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { AppShell } from "../layouts/app-shell";
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

/**
 * The peak's time as wall time in the view's zone, never the browser's
 * (ADR 0108 Status ruling c). A fixed `en-GB` day-month-time shape, because a
 * 1 y view's peak needs its date as well as its hour.
 */
function peakTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function wholeNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function viewOf(query: EnergyViewQuery | null): Promise<EnergyView> {
  // Unreachable: the query is disabled while `query` is null.
  return query === null ? Promise.reject(new Error("no energy view query")) : fetchEnergyView(query);
}

/**
 * `F4.298` U6 (ADR 0108 decision 2) — the Energy Centre on
 * `GET /reports/energy/view`: the filter (organization, locations, range,
 * custom from/to, compare), six KPI tiles with the change against the previous
 * period, and the source mix and the top consumers, all from one response.
 *
 * The filter starts from `defaultFilter` (the first readable organization,
 * owner answer Q3), and no view is asked while no organization is chosen —
 * there is no fleet-wide view. The previous answer stays on screen while a new
 * filter loads, so the custom pickers keep the view's zone.
 */
export function EnergyPage({ user }: EnergyPageProps) {
  const [chosen, setChosen] = useState<EnergyFilterValue | null>(null);

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
          current.peakAt !== null ? `Peak at ${peakTime(current.peakAt, v.timeZone)}` : undefined,
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

        <SectionCard
          title="Source mix · grid / solar / nominal DG"
          subtitle="Solar from assets with code PV*; DG remains a narrative slice until metered"
        >
          <EnergySourceStackChart points={current?.series ?? []} status={chartStatus(current?.series.length)} />
        </SectionCard>

        <SectionCard
          title="Top consuming assets"
          subtitle="Ranked by average kW; bar length approximates energy over the selected period"
        >
          <EnergyTopBarChart consumers={v?.topConsumers ?? []} status={chartStatus(v?.topConsumers.length)} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
