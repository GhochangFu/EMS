import {
  telemetryImportCommitDtoSchema,
  telemetryImportPreviewDtoSchema,
} from "@bms/shared/contracts";
import type { TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";

import { clearSessionOnAuthFailure } from "../http";
import { readJson } from "../validate";
import { getAdminAuthHeaders } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type TelemetryImportRequestOptions = {
  sourceKind?: "manual" | "unmapped";
  conflictPolicy?: "reject" | "overwrite";
};

function buildForm(file: File, opts: TelemetryImportRequestOptions): FormData {
  const form = new FormData();
  form.append("file", file);
  if (opts.sourceKind) form.append("sourceKind", opts.sourceKind);
  if (opts.conflictPolicy) form.append("conflictPolicy", opts.conflictPolicy);
  return form;
}

/** Parses and validates an uploaded file without writing anything (`F1.9`). */
export async function previewTelemetryImport(
  file: File,
  opts: TelemetryImportRequestOptions = {},
): Promise<TelemetryImportPreviewDto> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(`${base}/api/v1/admin/telemetry/import/preview`, {
    method: "POST",
    headers,
    body: buildForm(file, opts),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `admin telemetry import preview ${res.status}`);
  }
  return readJson(res, telemetryImportPreviewDtoSchema, "admin telemetry import preview");
}

/** Writes the accepted rows of an uploaded file through the shared write path (`F1.9`). */
export async function commitTelemetryImport(
  file: File,
  opts: TelemetryImportRequestOptions = {},
): Promise<TelemetryImportCommitDto> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(`${base}/api/v1/admin/telemetry/import/commit`, {
    method: "POST",
    headers,
    body: buildForm(file, opts),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `admin telemetry import commit ${res.status}`);
  }
  return readJson(res, telemetryImportCommitDtoSchema, "admin telemetry import commit");
}
