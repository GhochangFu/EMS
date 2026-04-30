import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import {
  downloadEnergyReportCsv,
  fetchEnergyReportPreview,
  type EnergyReportInput,
} from "../api/reports";
import { KpiTile } from "./kpi-tile";

type ReportCard = {
  title: string;
  description: string;
  formats: string;
  active: boolean;
};

const reportCards: ReportCard[] = [
  {
    title: "Energy Consumption",
    description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
    formats: "CSV",
    active: true,
  },
  {
    title: "Alarm Summary",
    description: "Critical alarms, acknowledgement times, and MTTR.",
    formats: "Deferred",
    active: false,
  },
  {
    title: "Maintenance Compliance",
    description: "PPM completion, SLA adherence, and vendor scorecard.",
    formats: "Deferred",
    active: false,
  },
  {
    title: "Sustainability & Carbon",
    description: "Scope 1/2 estimates and renewable share.",
    formats: "Deferred",
    active: false,
  },
];

function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

/** Sprint E Reports & Analytics panel with Energy Consumption preview/export. */
export function ReportsPanel() {
  const [startDate, setStartDate] = useState(dateDaysAgo(1));
  const [endDate, setEndDate] = useState(today());
  const input: EnergyReportInput = useMemo(
    () => ({ startDate, endDate }),
    [endDate, startDate],
  );

  const previewQ = useQuery({
    queryKey: ["reports", "energy", input.startDate, input.endDate],
    queryFn: () => fetchEnergyReportPreview(input),
  });

  const csvM = useMutation({
    mutationFn: () => downloadEnergyReportCsv(input),
  });

  const preview = previewQ.data;
  const summary = preview?.summary;
  const status = previewQ.isLoading
    ? "loading"
    : previewQ.isError
      ? "error"
      : "ready";

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="space-y-4">
        <div className="rounded border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-condensed text-lg font-bold text-bms-ink">
              Report Templates
            </h2>
            <p className="text-xs text-bms-muted">
              Sprint E activates Energy Consumption CSV only.
            </p>
          </div>
          <div className="divide-y divide-gray-200">
            {reportCards.map((card) => (
              <article
                key={card.title}
                className={`p-4 ${card.active ? "bg-bms-green/5" : "bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-bms-ink">{card.title}</h3>
                    <p className="mt-1 text-sm text-bms-muted">{card.description}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      card.active
                        ? "border-bms-green/20 bg-bms-green/10 text-bms-green"
                        : "border-gray-200 bg-gray-100 text-gray-600"
                    }`}
                  >
                    {card.formats}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded border border-gray-200 bg-white p-4">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Date Range
          </h2>
          <div className="mt-3 grid gap-3">
            <label className="text-xs font-medium text-bms-muted" htmlFor="start">
              Start date
            </label>
            <input
              id="start"
              type="date"
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <label className="text-xs font-medium text-bms-muted" htmlFor="end">
              End date
            </label>
            <input
              id="end"
              type="date"
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <button
            className="mt-4 w-full rounded bg-bms-green px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={csvM.isPending || previewQ.isError || !preview}
            onClick={() => csvM.mutate()}
          >
            {csvM.isPending ? "Preparing CSV..." : "Export CSV"}
          </button>
          {csvM.isError ? (
            <p className="mt-2 text-xs text-red-600">CSV export failed.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-condensed text-lg font-bold text-bms-ink">
                Energy Consumption Preview
              </h2>
              <p className="text-xs text-bms-muted">
                {preview
                  ? `${preview.range.startDate} to ${preview.range.endDate} · generated ${new Date(
                      preview.generatedAt,
                    ).toLocaleString()}`
                  : "Select a valid range to generate the preview."}
              </p>
            </div>
            <span className="rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              PDF/XLSX deferred
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Total energy"
            status={status}
            value={summary ? formatNumber(summary.totalKwh) : null}
            unit="kWh"
            hint="Hourly telemetry rollup"
          />
          <KpiTile
            label="Peak demand"
            status={status}
            value={summary ? formatNumber(summary.peakKw) : null}
            unit="kW"
            hint="Maximum hourly aggregate"
          />
          <KpiTile
            label="PUE (est.)"
            status={status}
            value={summary ? summary.pueEstimate.toFixed(2) : null}
            hint="Prototype estimate"
          />
          <KpiTile
            label="Indicative cost"
            status={status}
            value={summary ? formatNumber(summary.indicativeCostZar) : null}
            unit="ZAR"
            hint="kWh × tariff"
          />
        </div>

        {previewQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Could not load report preview. Check the date range and try again.
          </p>
        ) : null}

        {preview ? <PreviewDetails preview={preview} /> : null}
      </section>
    </div>
  );
}

function PreviewDetails({ preview }: { preview: EnergyReportPreview }) {
  const totalSource =
    preview.sourceTotals.gridKwh +
    preview.sourceTotals.solarKwh +
    preview.sourceTotals.dgKwh;

  return (
    <>
      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="font-condensed text-sm font-bold text-bms-ink">
          Source Mix Totals
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SourcePill
            label="Grid"
            value={preview.sourceTotals.gridKwh}
            total={totalSource}
          />
          <SourcePill
            label="Solar"
            value={preview.sourceTotals.solarKwh}
            total={totalSource}
          />
          <SourcePill
            label="Nominal DG"
            value={preview.sourceTotals.dgKwh}
            total={totalSource}
          />
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="font-condensed text-sm font-bold text-bms-ink">
          Top Consumers
        </h2>
        <div className="mt-3 overflow-hidden rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
              <tr>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2 text-right">Avg kW</th>
                <th className="px-3 py-2 text-right">Est. kWh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {preview.topConsumers.map((consumer) => (
                <ConsumerRow key={consumer.assetId} consumer={consumer} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="font-condensed text-sm font-bold text-bms-ink">
          Sprint E Notes
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-bms-muted">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SourcePill({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs uppercase tracking-wide text-bms-muted">{label}</div>
      <div className="mt-1 font-condensed text-xl font-bold text-bms-ink">
        {formatNumber(value)} kWh
      </div>
      <div className="mt-2 h-1.5 rounded bg-gray-200">
        <div
          className="h-1.5 rounded bg-bms-green"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function ConsumerRow({ consumer }: { consumer: EnergyTopConsumer }) {
  return (
    <tr>
      <td className="px-3 py-2">
        <div className="font-medium text-bms-ink">{consumer.code}</div>
        <div className="text-xs text-bms-muted">{consumer.name}</div>
      </td>
      <td className="px-3 py-2 text-bms-muted">{consumer.siteName}</td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(consumer.avgKw, 1)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(consumer.estimatedKwh)}
      </td>
    </tr>
  );
}
