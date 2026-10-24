import { ASSET_IMAGE_CONTENT_TYPES, assetImageUploadFieldsSchema, copilotAssetImageUploadModelBodySchema, MAX_ASSET_IMAGE_BYTES } from "../../contracts/asset-images";
import { copilotManualReadingsModelBodySchema, manualReadingsBodySchema } from "../../contracts/telemetry-entry";
import {
  copilotTelemetryImportModelBodySchema,
  MAX_IMPORT_FILE_BYTES,
  telemetryImportOptionsBodySchema,
} from "../../contracts/telemetry-import";
import { plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F4.283` (ADR 0099 Amendment 8, Q18–Q21; owner rulings 2026-10-24) — file-borne
 * data: the telemetry import commit, the manual readings, and the asset image
 * upload.
 *
 * Offered to `admin`, `organization_admin` and `location_admin` — the routes'
 * own `isMasterDataRole` gate; an `asset_group_admin` is refused (Q18).
 *
 * Q19: the file is never stored. The model names an attached file of its turn
 * (`file: { kind: "attachment", index }`); the pending row stores its name and
 * SHA-256, the browser keeps the `File`, and the route stage refuses a Confirm
 * whose bytes differ (409). The import's card-only `preview` holds the route's
 * own preview counts and the `asset_points` mappings the commit would create.
 *
 * Q21: both telemetry bodies fix `conflictPolicy: "reject"`; overwrite stays
 * on the telemetry pages. The two telemetry writes live in the conversation's
 * bound organization (`target: { kind: "telemetry" }`); every row's asset is
 * checked by the proposal check, which refuses with the row numbers.
 */

/** The routes' gate: `isMasterDataRole` without `asset_group_admin` (Q18). */
const MASTER_DATA_ROLES = ["admin", "organization_admin", "location_admin"] as const;

/** The XLSX media type, as the attachment sniff names it. */
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const REJECT_NOTE = "(conflicting readings are rejected)";

/** The number of rows a readings body carries. */
function rowCount(body: Readonly<Record<string, unknown>>): number {
  return Array.isArray(body.rows) ? body.rows.length : 0;
}

export const FILE_DATA_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "telemetry.import",
    title: "Import telemetry readings from a file",
    method: "POST",
    path: "/admin/telemetry/import/commit",
    params: {},
    body: telemetryImportOptionsBodySchema,
    bodyName: "telemetryImportOptionsBodySchema",
    clientOnly: [],
    modelBody: copilotTelemetryImportModelBodySchema,
    modelBodyName: "copilotTelemetryImportModelBodySchema",
    offeredTo: MASTER_DATA_ROLES,
    upload: { fileField: "file", kind: "file", accepts: ["text/csv", XLSX], maxBytes: MAX_IMPORT_FILE_BYTES },
    cardOnly: ["preview"],
    risk: "create",
    target: { kind: "telemetry" },
    refs: [],
    formulas: [],
    steps: [{ id: "options", title: "Options", fields: ["sourceKind", "conflictPolicy"] }],
    summary: ({ body, organizationName }) =>
      `Import the readings in ${quoted(text(body, "filename", "the attached file"))} into ${organizationName} ${REJECT_NOTE}.`,
  },
  {
    id: "telemetryReading.create",
    title: "Record manual readings",
    method: "POST",
    path: "/admin/telemetry-entry/manual-readings",
    params: {},
    body: manualReadingsBodySchema,
    bodyName: "manualReadingsBodySchema",
    clientOnly: [],
    modelBody: copilotManualReadingsModelBodySchema,
    modelBodyName: "copilotManualReadingsModelBodySchema",
    offeredTo: MASTER_DATA_ROLES,
    risk: "create",
    target: { kind: "telemetry" },
    refs: [],
    formulas: [],
    steps: [{ id: "rows", title: "Readings", fields: ["rows", "conflictPolicy"] }],
    summary: ({ body, organizationName }) => {
      const count = rowCount(body);
      return `Record ${plural(count, "manual reading")} in ${organizationName} ${REJECT_NOTE}.`;
    },
  },
  {
    id: "assetImage.upload",
    title: "Upload an asset image",
    method: "POST",
    path: "/assets/:assetId/images",
    params: { assetId: uuidParam },
    body: assetImageUploadFieldsSchema,
    bodyName: "assetImageUploadFieldsSchema",
    clientOnly: [],
    modelBody: copilotAssetImageUploadModelBodySchema,
    modelBodyName: "copilotAssetImageUploadModelBodySchema",
    offeredTo: MASTER_DATA_ROLES,
    upload: { fileField: "file", kind: "file", accepts: ASSET_IMAGE_CONTENT_TYPES, maxBytes: MAX_ASSET_IMAGE_BYTES },
    risk: "create",
    // The route's own `canManageAsset` on the path's asset.
    target: { kind: "asset", param: "assetId" },
    refs: [],
    formulas: [],
    steps: [{ id: "image", title: "Image", fields: ["caption"] }],
    summary: ({ body, targetName }) =>
      `Upload the image ${quoted(text(body, "filename", "the attached image"))} to the asset ${quoted(targetName)}.`,
  },
];

/** The file-data routes that are not entries, and why (Amendment 8, Q18 and "Not in this amendment"). */
export const FILE_DATA_PENDING: readonly ExcludedRoute[] = [
  {
    method: "POST",
    path: "/admin/telemetry/import/preview",
    reason: "runs inside the propose step and writes nothing (Amendment 8 Q18)",
  },
  { method: "DELETE", path: "/assets/:assetId/images/:imageId", reason: "a hard DELETE is never in the catalog (decision 3)" },
];
