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
import { AppShell } from "../layouts/app-shell";
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
          <span className="hidden text-bms-muted sm:inline">
            Tariff {s ? `R ${s.tariffZarPerKwh.toFixed(2)}/kWh est.` : ""}
          </span>
        </div>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <header className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Energy Centre
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              kWh from electrical telemetry · source mix (PV vs grid + nominal DG) · top
              loads (mockup <span className="font-mono text-xs">R.en</span>)
            </p>
          </div>
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
        </header>

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
          <KpiTile
            label="PUE (est.)"
            status={sumStatus}
            value={s != null ? s.pueEstimate.toFixed(2) : null}
            hint="From average load — same curve as Executive Dashboard"
          />
          <KpiTile
            label="Indicative cost"
            status={sumStatus}
            value={
              s != null
                ? s.indicativeCostZar.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : null
            }
            unit="ZAR"
            hint="kWh × tariff (prototype)"
          />
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-condensed text-sm font-bold text-bms-ink">
            Source mix · grid / solar / nominal DG
          </h2>
          <p className="mt-1 text-xs text-bms-muted">
            Solar from assets with code PV*; DG slice is a small nominal share of remaining
            load for narrative (no separate DG meter in seed).
          </p>
          <div className="mt-3">
            <EnergySourceStackChart
              points={mixQ.data?.points ?? []}
              status={mixStatus}
            />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-condensed text-sm font-bold text-bms-ink">
            Top consuming assets
          </h2>
          <p className="mt-1 text-xs text-bms-muted">
            Ranked by average kW; bar length ≈ avg kW × window hours (rough kWh).
          </p>
          <div className="mt-3">
            <EnergyTopBarChart
              consumers={topQ.data?.consumers ?? []}
              status={topStatus}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
