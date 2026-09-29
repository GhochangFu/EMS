import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { EnergyReportPreview, EnergyTopConsumer, ReportFileFormat } from "@bms/shared";
import { REPORT_FILE_FORMATS } from "@bms/shared/contracts";

import { fetchAdminOrganizations } from "../api/admin/organizations";
import {
  downloadEnergyReportCsv,
  downloadEnergyReportPdf,
  downloadEnergyReportXlsx,
  fetchEnergyReportPreview,
  saveEnergyReportFile,
  type EnergyReportInput,
} from "../api/reports";
import { isMasterDataAdmin } from "../lib/admin-access";
import { apiErrorMessage } from "../lib/api-error-message";
import { costTileProps } from "../lib/money";
import { pueTileProps } from "../lib/pue-tile";
import { formatLabel, saveBlockedReason } from "../lib/report-files-view";
import type { AuthUser } from "../stores/auth-store";
import { KpiTile } from "./kpi-tile";
import { REPORT_FILES_QUERY_KEY, ReportHistory } from "./report-history";
import { ReportSchedules } from "./report-schedules";

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
    formats: "PDF · XLSX · CSV",
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

export type ReportsPanelProps = {
  /**
   * The signed-in user, passed from `ReportsPage` rather than read from the
   * store, so the spec keeps its bare render plus a role (`F3.5a` R-13).
   */
  user: AuthUser;
};

/**
 * Sprint E Reports & Analytics panel with Energy Consumption preview/export;
 * `F3.5a` adds the PDF export, Save to history and the History list (ADR 0071
 * decision 12); `F3.5b` adds the Schedules section (ADR 0071 R-18).
 *
 * The PDF button renders for everyone — the export routes are
 * `readableAssetIds`-scoped, like CSV. Save, History and Schedules render only for
 * `isMasterDataAdmin(user.role)` (R-13): the API's `POST` runs
 * `assertMasterDataRole` and the list route answers 403 for other roles
 * (`reportFileReadScope` runs the same guard), so a control shown to them
 * would only buy a refusal.
 */
export function ReportsPanel({ user }: ReportsPanelProps) {
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

  const xlsxM = useMutation({
    mutationFn: () => downloadEnergyReportXlsx(input),
  });

  const pdfM = useMutation({
    mutationFn: () => downloadEnergyReportPdf(input),
  });

  const canSave = isMasterDataAdmin(user.role);
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
        <div className="surface-raised">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-condensed text-lg font-bold text-ink">
              Report Templates
            </h2>
            <p className="text-xs text-ink-muted">
              Sprint E activates Energy Consumption only. XLSX is the
              recommended format.
            </p>
          </div>
          <div className="divide-y divide-line">
            {reportCards.map((card) => (
              <article
                key={card.title}
                className={`p-4 ${card.active ? "bg-accent/5" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{card.title}</h3>
                    <p className="mt-1 text-sm text-ink-muted">{card.description}</p>
                  </div>
                  <span
                    className={`surface-pill rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      card.active
                        ? "border-accent/20 bg-accent/10 text-accent-strong"
                        : "text-ink-muted"
                    }`}
                  >
                    {card.formats}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-raised p-4">
          <h2 className="font-condensed text-lg font-bold text-ink">
            Date Range
          </h2>
          <div className="mt-3 grid gap-3">
            <label className="text-xs font-medium text-ink-muted" htmlFor="start">
              Start date
            </label>
            <input
              id="start"
              type="date"
              className="surface-field px-3 py-2 text-sm"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <label className="text-xs font-medium text-ink-muted" htmlFor="end">
              End date
            </label>
            <input
              id="end"
              type="date"
              className="surface-field px-3 py-2 text-sm"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          {/*
            XLSX leads because it is the safe format (ADR 0026 Amendment 2,
            `F4.51`): the CSV keeps a documented residual that no server-side
            escaping can close. CSV stays because it is the format the client's
            existing tooling reads.
          */}
          <button
            className="mt-4 w-full surface-button-primary bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:bg-line-strong"
            disabled={xlsxM.isPending || previewQ.isError || !preview}
            aria-busy={xlsxM.isPending}
            onClick={() => xlsxM.mutate()}
          >
            {xlsxM.isPending ? "Preparing XLSX..." : "Export XLSX"}
          </button>
          {xlsxM.isError ? (
            <p className="mt-2 text-xs text-critical-ink">XLSX export failed.</p>
          ) : null}
          <button
            className="mt-2 w-full surface-button px-3 py-2 disabled:cursor-not-allowed disabled:text-ink-hint"
            disabled={csvM.isPending || previewQ.isError || !preview}
            aria-busy={csvM.isPending}
            onClick={() => csvM.mutate()}
          >
            {csvM.isPending ? "Preparing CSV..." : "Export CSV"}
          </button>
          {csvM.isError ? (
            <p className="mt-2 text-xs text-critical-ink">CSV export failed.</p>
          ) : null}
          <button
            className="mt-2 w-full surface-button px-3 py-2 disabled:cursor-not-allowed disabled:text-ink-hint"
            disabled={pdfM.isPending || previewQ.isError || !preview}
            aria-busy={pdfM.isPending}
            onClick={() => pdfM.mutate()}
          >
            {pdfM.isPending ? "Preparing PDF..." : "Export PDF"}
          </button>
          {pdfM.isError ? (
            <p className="mt-2 text-xs text-critical-ink">PDF export failed.</p>
          ) : null}
          {canSave ? (
            <SaveToHistory
              input={input}
              user={user}
              hasPreview={preview !== undefined}
              previewError={previewQ.isError}
            />
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="surface-raised px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-condensed text-lg font-bold text-ink">
                Energy Consumption Preview
              </h2>
              <p className="text-xs text-ink-muted">
                {preview
                  ? `${preview.range.startDate} to ${preview.range.endDate} · generated ${new Date(
                      preview.generatedAt,
                    ).toLocaleString()}`
                  : "Select a valid range to generate the preview."}
              </p>
            </div>
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
          {/*
            `F2.8` — the same value the export writes, rendered the same way:
            a dash here is the U+2014 `reports.serialise.ts` puts in the
            `PUE estimate` cell.
          */}
          <KpiTile label="PUE" {...pueTileProps(status, summary?.pueEstimate)} />
          {/*
            `E4.1c` — the same value the export writes, rendered the same way: a
            null cost is the U+2014 `reports.serialise.ts` puts in the
            `Indicative cost` cell, and the currency is the organization's
            (the formatted string carries the symbol, so no `unit`).
          */}
          <KpiTile label="Indicative cost" {...costTileProps(status, summary?.indicativeCost, summary?.currency)} />
        </div>

        {previewQ.isError ? (
          <p className="rounded border border-critical-line bg-critical-wash p-4 text-sm text-critical-ink">
            Could not load report preview. Check the date range and try again.
          </p>
        ) : null}

        {preview ? <PreviewDetails preview={preview} /> : null}

        {canSave ? <ReportHistory /> : null}
        {canSave ? <ReportSchedules user={user} /> : null}
      </section>
    </div>
  );
}

type SaveToHistoryProps = {
  input: EnergyReportInput;
  user: AuthUser;
  hasPreview: boolean;
  previewError: boolean;
};

/**
 * The Save-to-history block (ADR 0071 decisions 4 and 11; Amendment 1 item
 * 1). Rendered only for a master-data admin — the caller holds the gate.
 *
 * The organization select exists only for the global `admin`, who must name
 * one; every other role sends no `organizationId` and, if the API still asks
 * for one (an organization admin holding several), renders its 400 sentence.
 * Every disabled state is one of `saveBlockedReason`'s sentences: the
 * pending one is carried by the button label ("Saving…"), the others are
 * rendered beside the button, so nothing here is disabled without saying why.
 */
function SaveToHistory({ input, user, hasPreview, previewError }: SaveToHistoryProps) {
  const queryClient = useQueryClient();
  const needsOrganization = user.role === "admin";
  const [format, setFormat] = useState<ReportFileFormat>("pdf");
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<{ tone: "saved" | "refused"; text: string } | null>(null);

  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: needsOrganization,
  });

  const saveM = useMutation({
    mutationFn: () => saveEnergyReportFile(input, format, organizationId),
    onSuccess: async (file) => {
      setOutcome({ tone: "saved", text: `Saved ${file.filename} to history.` });
      await queryClient.invalidateQueries({ queryKey: REPORT_FILES_QUERY_KEY });
    },
    onError: (cause: Error) => setOutcome({ tone: "refused", text: apiErrorMessage(cause) }),
  });

  const blockedReason = saveBlockedReason({
    hasPreview,
    previewError,
    needsOrganization,
    organizationId,
    pending: saveM.isPending,
  });

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Save to history</h3>
      <div className="mt-2 grid gap-2">
        <label className="text-xs font-medium text-ink-muted" htmlFor="save-format">
          Format
        </label>
        <select
          id="save-format"
          className="surface-field px-3 py-2 text-sm"
          value={format}
          onChange={(e) => setFormat(e.target.value as ReportFileFormat)}
        >
          {REPORT_FILE_FORMATS.map((option) => (
            <option key={option} value={option}>
              {formatLabel(option)}
            </option>
          ))}
        </select>
        {needsOrganization ? (
          <>
            <label className="text-xs font-medium text-ink-muted" htmlFor="save-organization">
              Organization
            </label>
            <select
              id="save-organization"
              className="surface-field px-3 py-2 text-sm"
              value={organizationId ?? ""}
              onChange={(e) => setOrganizationId(e.target.value === "" ? undefined : e.target.value)}
            >
              <option value="">Choose an organization</option>
              {(organizationsQ.data?.items ?? []).map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.code} · {organization.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="mt-3 w-full surface-button-primary bg-chrome px-3 py-2 text-sm font-semibold text-on-dark disabled:cursor-not-allowed disabled:bg-line-strong"
        disabled={blockedReason !== null}
        aria-busy={saveM.isPending}
        onClick={() => saveM.mutate()}
      >
        {saveM.isPending ? "Saving…" : "Save to history"}
      </button>
      {blockedReason !== null && !saveM.isPending ? (
        <p className="mt-2 text-xs text-ink-muted">{blockedReason}</p>
      ) : null}
      {outcome !== null ? (
        <p className={`mt-2 text-xs ${outcome.tone === "saved" ? "text-accent-strong" : "text-critical-ink"}`}>
          {outcome.text}
        </p>
      ) : null}
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
      <section className="surface-raised p-4">
        <h2 className="font-condensed text-sm font-bold text-ink">
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

      <section className="surface-raised p-4">
        <h2 className="font-condensed text-sm font-bold text-ink">
          Top Consumers
        </h2>
        <div className="mt-3 overflow-hidden surface-table">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-well text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2 text-right">Avg kW</th>
                <th className="px-3 py-2 text-right">Est. kWh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.topConsumers.map((consumer) => (
                <ConsumerRow key={consumer.assetId} consumer={consumer} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-raised p-4">
        <h2 className="font-condensed text-sm font-bold text-ink">
          Sprint E Notes
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
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
    <div className="surface-pressed p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-condensed text-xl font-bold text-ink">
        {formatNumber(value)} kWh
      </div>
      <div className="mt-2 h-1.5 surface-pressed-sm">
        <div
          className="h-1.5 rounded bg-accent"
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
        <div className="font-medium text-ink">{consumer.code}</div>
        <div className="text-xs text-ink-muted">{consumer.name}</div>
      </td>
      <td className="px-3 py-2 text-ink-muted">{consumer.siteName}</td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(consumer.avgKw, 1)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(consumer.estimatedKwh)}
      </td>
    </tr>
  );
}
