import {
  energyReportPreviewSchema,
} from "@bms/shared/contracts";
import type { EnergyReportPreview } from "@bms/shared";

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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
