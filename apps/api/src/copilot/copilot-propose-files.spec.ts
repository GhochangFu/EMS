import { createHash } from "node:crypto";

import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { CopilotTelemetryImportPreview, TelemetryEntryRow } from "@bms/shared";
import { hashExcludedKeysFor, proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import type { TurnAttachment } from "./copilot-attachments";
import { type CopilotFileChecks, PROPOSE_FILES_UNAVAILABLE_ERROR } from "./copilot-propose-files";
import { PROPOSE_FLEET_UNBOUND_ERROR, PROPOSE_ROLE_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";
import { UPLOAD_NEEDS_FILE_ERROR, uploadWrongTypeError } from "./copilot-upload-prepare";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18–Q21; owner rulings 2026-10-24) — the
 * propose tools over the real file-data entries, with recording fakes of
 * `TelemetryProposalCheckService` and `AssetImagesWriteService.previewUpload`.
 * One claim per `it()`. Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

const IMPORT_TOOL = proposeToolName({ id: "telemetry.import" });
const READINGS_TOOL = proposeToolName({ id: "telemetryReading.create" });
const IMAGE_TOOL = proposeToolName({ id: "assetImage.upload" });

const CSV_BYTES = Buffer.from("asset_code,point_key,value,time\nPUMP-1,kw,1,2026-10-20T09:00:00Z\n", "utf8");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const sha = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const attachment = (filename: string, mediaType: TurnAttachment["mediaType"], data: Buffer): TurnAttachment => ({
  index: 1,
  filename,
  mediaType,
  byteSize: data.byteLength,
  sha256: sha(data),
  data,
});
const CSV_FILE = attachment("readings.csv", "text/csv", CSV_BYTES);
const PNG_FILE = attachment("panel.png", "image/png", PNG_BYTES);
const FILE_REF = { kind: "attachment", index: 1 };
const ROW: TelemetryEntryRow = { assetId: ASSET, pointKey: "kw", value: 1, time: "2026-10-20T09:00:00.000Z" };

const PREVIEW: CopilotTelemetryImportPreview = {
  totalRows: 14,
  acceptedCount: 12,
  rejectedCount: 2,
  rejected: [{ rowNumber: 5, field: "value", reason: "must be a number" }],
  mappingsToCreate: [{ assetCode: "PUMP-1", pointKey: "kw" }],
};

const target = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({ organizationId: ORG_X, organizationName: "Org X", targetName: "Org X", ...over });

function fakes(options: { refusal?: string } = {}) {
  const calls: string[] = [];
  const files: CopilotFileChecks = {
    telemetry: {
      checkImport: async (input) => {
        calls.push(`import:${input.buffer.byteLength}`);
        if (options.refusal !== undefined) throw new ForbiddenException(options.refusal);
        return { note: "12 of 14 rows accepted, 2 rejected; creates 1 point mapping: PUMP-1/kw.", preview: PREVIEW };
      },
      checkReadings: async (input) => {
        calls.push(`readings:${input.rows.length}`);
        if (options.refusal !== undefined) throw new ForbiddenException(options.refusal);
        return { note: `${input.rows.length} of ${input.rows.length} rows accepted, 0 rejected; creates no point mapping.` };
      },
    },
    images: {
      previewUpload: async (_user, assetId) => {
        calls.push(`image:${assetId}`);
      },
    },
  };
  return { calls, files };
}

function harness(options: { refusal?: string; withoutFiles?: boolean; target?: ResolvedTarget } = {}) {
  const f = fakes(options);
  const h = proposeHarness({ target: options.target ?? target(), ...(options.withoutFiles ? {} : { files: f.files }) });
  return { ...h, calls: f.calls };
}

const asRole = (role: string) => ({ identity: { id: USER, role, organizationId: ORG_X } as ResolvedIdentity });

/** (1) The import stores the options, "reject", the file's name and hash, and the card-only preview, on the commit path. */
export async function theImportStoresItsBodyAndPreview(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { sourceKind: "manual", file: FILE_REF } }, { attachments: [CSV_FILE] });
  expect([h.stored[0]?.path, h.stored[0]?.body]).toEqual([
    "/api/v1/admin/telemetry/import/commit",
    { sourceKind: "manual", conflictPolicy: "reject", filename: "readings.csv", fileSha256: CSV_FILE.sha256, preview: PREVIEW },
  ]);
}

/** (1b) The hash leaves the card-only preview out — the route stage hashes what multer hands it. */
export async function theImportHashLeavesOutThePreview(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { sourceKind: "manual", file: FILE_REF } }, { attachments: [CSV_FILE] });
  const stored = { sourceKind: "manual", conflictPolicy: "reject", filename: "readings.csv", fileSha256: CSV_FILE.sha256 };
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(stored, hashExcludedKeysFor("telemetry.import")));
}

/** (2) A4 "nothing is stored": no stored value is a Buffer or longer than 256 characters. */
export async function theImportStoresNoBytes(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { attachments: [CSV_FILE] });
  const body = (h.stored[0]?.body ?? {}) as Record<string, unknown>;
  const { preview: _preview, ...rest } = body;
  expect(Object.entries(rest).filter(([, value]) => Buffer.isBuffer(value) || String(value).length > 256)).toEqual([]);
}

/** (3) The tool result's summary carries the counts and a mapping name. */
export async function theImportSummaryCarriesTheCounts(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { attachments: [CSV_FILE] });
  expect(String((h.lastResult() as { result?: { summary?: string } }).result?.summary)).toContain("12 of 14 rows accepted, 2 rejected; creates 1 point mapping: PUMP-1/kw.");
}

/** (4) A follow-up turn carries no file: refused with the attach sentence, nothing stored, the check never asked. */
export async function aFollowUpImportIsTheAttachSentence(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { turnKind: "follow_up" });
  expect([h.lastResult(), h.stored, h.calls]).toEqual([{ ok: false, error: UPLOAD_NEEDS_FILE_ERROR }, [], []]);
}

/** (5) An `asset_group_admin` is refused by role before any check — the import. */
export async function anAssetGroupAdminIsRefusedTheImport(): Promise<void> {
  const h = harness();
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { ...asRole("asset_group_admin"), attachments: [CSV_FILE] });
  expect([h.lastResult(), h.calls]).toEqual([{ ok: false, error: PROPOSE_ROLE_ERROR }, []]);
}

/** (5b) The readings. */
export async function anAssetGroupAdminIsRefusedTheReadings(): Promise<void> {
  const h = harness();
  await h.call(READINGS_TOOL, { body: { rows: [ROW] } }, asRole("asset_group_admin"));
  expect([h.lastResult(), h.calls]).toEqual([{ ok: false, error: PROPOSE_ROLE_ERROR }, []]);
}

/** (5c) The image. */
export async function anAssetGroupAdminIsRefusedTheImage(): Promise<void> {
  const h = harness();
  await h.call(IMAGE_TOOL, { assetId: ASSET, body: { file: FILE_REF } }, { ...asRole("asset_group_admin"), attachments: [PNG_FILE] });
  expect([h.lastResult(), h.calls]).toEqual([{ ok: false, error: PROPOSE_ROLE_ERROR }, []]);
}

/** (6) Q21: the readings with `overwrite` are an invalid body. */
export async function overwriteReadingsAreAnInvalidBody(): Promise<void> {
  const h = harness();
  await h.call(READINGS_TOOL, { body: { rows: [ROW], conflictPolicy: "overwrite" } });
  const result = h.lastResult() as { ok: boolean; error?: string };
  expect([result.ok, result.error?.startsWith("Invalid body"), h.stored]).toEqual([false, true, []]);
}

/** (7) Q21, drafter choice 7: readings without `conflictPolicy` store "reject". */
export async function readingsWithoutAPolicyStoreReject(): Promise<void> {
  const h = harness();
  await h.call(READINGS_TOOL, { body: { rows: [ROW] } });
  expect(h.stored[0]?.body).toEqual({ rows: [ROW], conflictPolicy: "reject" });
}

/** (8) The check's out-of-organization refusal reaches the model verbatim; nothing is stored. */
export async function theChecksRefusalReachesTheModel(): Promise<void> {
  const refusal = "Row 3: the asset is outside this conversation's organization.";
  const h = harness({ refusal });
  await h.call(READINGS_TOOL, { body: { rows: [ROW] } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: refusal }, []]);
}

/** (9) The image with a PNG stores its caption, name and hash on the asset's path, after the pre-check. */
export async function theImageStoresItsCaptionNameAndHash(): Promise<void> {
  const h = harness({ target: target({ targetName: "Pump 1" }) });
  await h.call(IMAGE_TOOL, { assetId: ASSET, body: { caption: "Front", file: FILE_REF } }, { attachments: [PNG_FILE] });
  expect([h.stored[0]?.path, h.stored[0]?.body, h.calls]).toEqual([
    `/api/v1/assets/${ASSET}/images`,
    { caption: "Front", filename: "panel.png", fileSha256: PNG_FILE.sha256 },
    [`image:${ASSET}`],
  ]);
}

/** (10) A CSV for the image is the type sentence. */
export async function aCsvForTheImageIsTheTypeSentence(): Promise<void> {
  const h = harness();
  await h.call(IMAGE_TOOL, { assetId: ASSET, body: { file: FILE_REF } }, { attachments: [CSV_FILE] });
  expect(h.lastResult()).toEqual({ ok: false, error: uploadWrongTypeError(["image/jpeg", "image/png", "image/webp"]) });
}

/** (11) Tools built without the checks refuse all three (fail closed). */
export async function toolsWithoutTheChecksRefuseAllThree(): Promise<void> {
  const h = harness({ withoutFiles: true });
  const results = [];
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { attachments: [CSV_FILE] });
  results.push(h.lastResult());
  await h.call(READINGS_TOOL, { body: { rows: [ROW] } });
  results.push(h.lastResult());
  await h.call(IMAGE_TOOL, { assetId: ASSET, body: { file: FILE_REF } }, { attachments: [PNG_FILE] });
  results.push(h.lastResult());
  const refused = { ok: false, error: PROPOSE_FILES_UNAVAILABLE_ERROR };
  expect([results, h.stored]).toEqual([[refused, refused, refused], []]);
}

/** (12) An unbound conversation: the two telemetry entries are refused before the resolver. */
export async function anUnboundConversationIsRefusedTheTelemetryWrites(): Promise<void> {
  const h = harness();
  const results = [];
  await h.call(IMPORT_TOOL, { body: { file: FILE_REF } }, { conversationOrganizationId: null, attachments: [CSV_FILE] });
  results.push(h.lastResult());
  await h.call(READINGS_TOOL, { body: { rows: [ROW] } }, { conversationOrganizationId: null });
  results.push(h.lastResult());
  const refused = { ok: false, error: PROPOSE_FLEET_UNBOUND_ERROR };
  expect([results, h.resolved]).toEqual([[refused, refused], []]);
}

/** Q18: the three tools are offered to the master-data roles and never to an `asset_group_admin`. */
export function theRegistriesOfferTheToolsToTheMasterDataRolesOnly(): void {
  const h = harness();
  const offered = (role: string) => {
    const names = h.tools.registryFor({ access: false, role }).definitions.map((d) => d.name);
    return [IMPORT_TOOL, READINGS_TOOL, IMAGE_TOOL].filter((name) => names.includes(name)).length;
  };
  expect(["admin", "organization_admin", "location_admin", "asset_group_admin"].map(offered)).toEqual([3, 3, 3, 0]);
}
