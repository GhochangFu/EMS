import {
  energyReportPreviewSchema,
  reportFileDtoSchema,
  reportFileListResponseSchema,
} from "@bms/shared/contracts";
import type { EnergyReportPreview, ReportFileDto, ReportFileFormat } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { adminFetch } from "./admin/client";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type EnergyReportInput = {
  startDate: string;
  endDate: string;
};

function query(input: EnergyReportInput): URLSearchParams {
  return new URLSearchParams({
    startDate: input.startDate,
    endDate: input.endDate,
  });
}

/** GET /api/v1/reports/energy/preview */
export async function fetchEnergyReportPreview(
  input: EnergyReportInput,
): Promise<EnergyReportPreview> {
  const res = await fetch(
    `${base}/api/v1/reports/energy/preview?${query(input)}`,
    withAuth(),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`energy-report-preview ${res.status}`);
  }
  return checkResponse(energyReportPreviewSchema, await res.json(), "reports/energy/preview");
}

/**
 * Triggers a browser save of `blob` under `filename`.
 *
 * `F3.5a` Unit 10 — extracted from `saveExport` with no behaviour change so
 * `downloadReportFile` can reach the same anchor-download shape for a file
 * that did not come from a query-scoped export route.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fetches an export response and triggers a browser save under `filename`. */
async function saveExport(
  path: string,
  input: EnergyReportInput,
  filename: string,
  label: string,
): Promise<void> {
  const res = await fetch(`${base}${path}?${query(input)}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`${label} ${res.status}`);
  }
  const blob = await res.blob();
  saveBlob(blob, filename);
}

/** Downloads the Sprint E CSV export and triggers a browser save. */
export async function downloadEnergyReportCsv(
  input: EnergyReportInput,
): Promise<void> {
  return saveExport(
    "/api/v1/reports/energy/export.csv",
    input,
    `energy-consumption-${input.startDate}-to-${input.endDate}.csv`,
    "energy-report-csv",
  );
}

/**
 * Downloads the same report as `xlsx` (ADR 0026 Amendment 2, `F4.51`).
 *
 * Offered as the default in the panel because the CSV carries a residual the
 * server cannot escape away: a cell holding two or more field separators still
 * injects a formula into a consumer that does not treat the comma as a delimiter.
 * The spreadsheet format has no such class — no `<f>` element is ever written.
 */
export async function downloadEnergyReportXlsx(
  input: EnergyReportInput,
): Promise<void> {
  return saveExport(
    "/api/v1/reports/energy/export.xlsx",
    input,
    `energy-consumption-${input.startDate}-to-${input.endDate}.xlsx`,
    "energy-report-xlsx",
  );
}

/** Downloads the same report as `pdf` (`F3.5a`, ADR 0071 decision 3). */
export async function downloadEnergyReportPdf(
  input: EnergyReportInput,
): Promise<void> {
  return saveExport(
    "/api/v1/reports/energy/export.pdf",
    input,
    `energy-consumption-${input.startDate}-to-${input.endDate}.pdf`,
    "energy-report-pdf",
  );
}

/**
 * `POST /api/v1/reports/energy/files` — saves the rendered report to history
 * (ADR 0071 decisions 4, 11; R-4). `organizationId` is sent only when given —
 * a global admin must name one (the API answers 400 naming it when absent), a
 * single-organization admin need not.
 */
export async function saveEnergyReportFile(
  input: EnergyReportInput,
  format: ReportFileFormat,
  organizationId?: string,
): Promise<ReportFileDto> {
  return adminFetch("/reports/energy/files", reportFileDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      format,
      ...(organizationId ? { organizationId } : {}),
    }),
  });
}

/** `GET /api/v1/reports/files` — the caller's saved report history (R-7). */
export async function fetchReportFiles(): Promise<ReportFileDto[]> {
  return adminFetch("/reports/files", reportFileListResponseSchema);
}

/**
 * `GET /api/v1/reports/files/:id/download` — the `fetchAssetImageBlob` shape
 * (`asset-images.ts:52-110`): `clearSessionOnAuthFailure` runs before the body
 * is read, and a refusal throws `ApiError` carrying the status rather than a
 * plain `Error`, so the panel can render the API's own 403/404 sentence.
 */
export async function downloadReportFile(file: ReportFileDto): Promise<void> {
  const res = await fetch(
    `${base}/api/v1/reports/files/${encodeURIComponent(file.id)}/download`,
    withAuth(),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `report file download ${res.status}`, res.status);
  }
  const blob = await res.blob();
  saveBlob(blob, file.filename);
}

/**
 * `DELETE /api/v1/reports/files/:id` — 204, no body (the `deleteAssetImage`
 * shape: success is `status === 204`, not `res.ok`).
 */
export async function deleteReportFile(id: string): Promise<void> {
  const res = await fetch(
    `${base}/api/v1/reports/files/${encodeURIComponent(id)}`,
    withAuth({ method: "DELETE" }),
  );
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res);
  const text = await res.text();
  throw new ApiError(text || `report file delete ${res.status}`, res.status);
}
