import { HttpException } from "@nestjs/common";

import type { TelemetryEntryRow } from "@bms/shared";
import type { CatalogEntry } from "@bms/shared/copilot";

import type { TelemetryProposalCheckService } from "../admin/telemetry-entry/telemetry-proposal-check.service";
import type { AssetImagesWriteService } from "../assets/asset-images-write.service";
import type { CopilotToolContext } from "./copilot-read-tools";
import { prepareFileUpload } from "./copilot-upload-prepare";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18–Q21; owner rulings 2026-10-24) — the
 * propose tools' file-borne data step, split from `copilot-propose-tools.ts`
 * (the `copilot-propose-reports.ts` shape).
 *
 * - An upload entry (the import, the image) first turns the model's `file`
 *   reference into the attached file's name and SHA-256
 *   (`prepareFileUpload`); a follow-up turn carries no file and is refused.
 * - The import then runs the route's own preview over the attached bytes
 *   (`TelemetryProposalCheckService.checkImport`): its counts and the mappings
 *   the commit would create are the card-only `preview`, and a row outside the
 *   caller's scope or the conversation's organization refuses the proposal.
 * - The readings store `conflictPolicy: "reject"` when the model left it out
 *   (Q21), then run the route's row checks (`checkReadings`).
 * - The image runs `AssetImagesWriteService.previewUpload` (drafter choice 3).
 *
 * A refusal is the route's `HttpException` sentence, returned to the model;
 * any other error is re-thrown. Tools built without the checks fail closed.
 */

/** The three file-borne data entries (`packages/shared/src/copilot/catalog/file-data.ts`). */
export const FILE_ENTRY_IDS: ReadonlySet<string> = new Set(["telemetry.import", "telemetryReading.create", "assetImage.upload"]);

/** A file-data proposal on tools built without the checks fails closed: nothing is stored. */
export const PROPOSE_FILES_UNAVAILABLE_ERROR = "This change cannot be proposed here. Tell the user to use the telemetry or asset page.";

export type CopilotFileChecks = {
  readonly telemetry: Pick<TelemetryProposalCheckService, "checkImport" | "checkReadings">;
  readonly images: Pick<AssetImagesWriteService, "previewUpload">;
};

export type CheckedFile =
  | { readonly ok: true; readonly body: Record<string, unknown>; readonly note: string; readonly cardBody: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/** The file-data step of propose: prepare the attachment (file-borne entries), then run the route's own read-only check. */
export async function checkFile(
  files: CopilotFileChecks | undefined,
  entry: CatalogEntry,
  params: Readonly<Record<string, string>>,
  body: Record<string, unknown>,
  organizationId: string,
  ctx: CopilotToolContext,
): Promise<CheckedFile> {
  if (files === undefined) return { ok: false, error: PROPOSE_FILES_UNAVAILABLE_ERROR };
  try {
    if (entry.id === "telemetryReading.create") {
      // Q21 (drafter choice 7): the stored body always says "reject", so the card and the request do.
      const stored: Record<string, unknown> = { ...body, conflictPolicy: "reject" };
      const { note } = await files.telemetry.checkReadings({
        user: ctx.user,
        organizationId,
        rows: (stored.rows ?? []) as TelemetryEntryRow[],
      });
      return { ok: true, body: stored, note, cardBody: {} };
    }
    const prepared = prepareFileUpload(entry, body, ctx.attachments);
    if (!prepared.ok) return prepared;
    if (entry.id === "telemetry.import") {
      const { note, preview } = await files.telemetry.checkImport({ user: ctx.user, organizationId, buffer: prepared.attachment.data });
      return { ok: true, body: prepared.body, note, cardBody: preview === undefined ? {} : { preview } };
    }
    await files.images.previewUpload(ctx.user, params.assetId as string);
    return { ok: true, body: prepared.body, note: "", cardBody: {} };
  } catch (err) {
    if (err instanceof HttpException) return { ok: false, error: err.message };
    throw err;
  }
}
