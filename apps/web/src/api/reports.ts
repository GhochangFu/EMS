import type { EnergyReportPreview } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";

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
  return res.json() as Promise<EnergyReportPreview>;
}

/** Downloads the Sprint E CSV export and triggers a browser save. */
export async function downloadEnergyReportCsv(
  input: EnergyReportInput,
): Promise<void> {
  const res = await fetch(
    `${base}/api/v1/reports/energy/export.csv?${query(input)}`,
    withAuth(),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`energy-report-csv ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `energy-consumption-${input.startDate}-to-${input.endDate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
