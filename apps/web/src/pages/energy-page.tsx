import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchEnergySourceMix,
  fetchEnergySummary,
  fetchEnergyTopConsumers,
} from "../api/energy-dashboard";
import { EnergySourceStackChart } from "../components/energy-source-stack-chart";
import { EnergyTopBarChart } from "../components/energy-top-bar-chart";
import { KpiTile } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { AppShell } from "../layouts/app-shell";
import { costTileProps, formatMoney } from "../lib/money";
import { pueTileProps } from "../lib/pue-tile";
import type { AuthUser } from "../stores/auth-store";

const WINDOWS = ["24h", "7d", "30d"] as const;

type EnergyPageProps = {
  user: AuthUser;
};

export function EnergyPage({ user }: EnergyPageProps) {
  const [energyWindow, setEnergyWindow] = useState<string>("24h");

  const summaryQ = useQuery({
    queryKey: ["energy", "summary", energyWindow],
    queryFn: () => fetchEnergySummary(energyWindow),
    refetchInterval: 60_000,
  });

  const mixQ = useQuery({
    queryKey: ["energy", "mix", energyWindow],
    queryFn: () => fetchEnergySourceMix(energyWindow),
    refetchInterval: 60_000,
  });

  const topQ = useQuery({
    queryKey: ["energy", "top", energyWindow],
    queryFn: () => fetchEnergyTopConsumers(energyWindow, 10),
    refetchInterval: 60_000,
  });

  const sumStatus = summaryQ.isLoading
    ? "loading"
    : summaryQ.isError
      ? "error"
      : "ready";

  const mixStatus = mixQ.isLoading
    ? "loading"
    : mixQ.isError
      ? "error"
      : mixQ.data?.points.length === 0
        ? "empty"
        : "ready";

  const topStatus = topQ.isLoading
    ? "loading"
    : topQ.isError
      ? "error"
      : topQ.data?.consumers.length === 0
        ? "empty"
        : "ready";

  const s = summaryQ.data;

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-bms-ink">Energy Analytics · multi-site consumption</span>
          {/*
            `E4.1c` — the tariff is the organization's `energy_tariff_per_kwh`
            parameter in its own currency, or nothing: a `null` tariff (none
            entered, or two currencies in scope) renders no ribbon text rather
            than `R null`.
          */}
          {s && s.tariffPerKwh !== null && s.currency !== null ? (
            <span className="hidden text-bms-muted sm:inline">
              Tariff {formatMoney(s.tariffPerKwh, s.currency, 2)}/kWh
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
            <div className="flex items-center gap-2">
            <label htmlFor="energy-window" className="text-xs text-bms-muted">
              Window
            </label>
            <select
              id="energy-window"
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              value={energyWindow}
              onChange={(e) => setEnergyWindow(e.target.value)}
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w === "24h"
                    ? "Last 24 hours"
                    : w === "7d"
                      ? "Last 7 days"
                      : "Last 30 days"}
                </option>
              ))}
            </select>
            </div>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Total energy"
            status={sumStatus}
            value={
              s != null ? s.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : null
            }
            unit="kWh"
            hint="Integral of summed load (minute or hourly buckets)"
          />
          <KpiTile
            label="Peak demand"
            status={sumStatus}
            value={s != null ? s.peakKw.toLocaleString(undefined, { maximumFractionDigits: 0 }) : null}
            unit="kW"
            hint="Max total site kW in window"
          />
          {/* `F2.8` — the windowed Σ site_kw / Σ it_kw, or a dash with a reason. */}
          <KpiTile label="PUE" {...pueTileProps(sumStatus, s?.pueEstimate)} />
          {/*
            `E4.1c` — the organization's currency carries the symbol, so the
            tile has no `unit`; a `null` cost (no tariff in scope, or two
            currencies) is the dash with the reason, never a 0.
          */}
          <KpiTile label="Indicative cost" {...costTileProps(sumStatus, s?.indicativeCost, s?.currency)} />
        </div>

        <SectionCard
          title="Source mix · grid / solar / nominal DG"
          subtitle="Solar from assets with code PV*; DG remains a narrative slice until metered"
        >
            <EnergySourceStackChart
              points={mixQ.data?.points ?? []}
              status={mixStatus}
            />
        </SectionCard>

        <SectionCard
          title="Top consuming assets"
          subtitle="Ranked by average kW; bar length approximates energy over the selected window"
        >
            <EnergyTopBarChart
              consumers={topQ.data?.consumers ?? []}
              status={topStatus}
            />
        </SectionCard>
      </div>
    </AppShell>
  );
}
