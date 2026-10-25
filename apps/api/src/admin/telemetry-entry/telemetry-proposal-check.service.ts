import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  COPILOT_IMPORT_PREVIEW_MAPPINGS_MAX,
  COPILOT_IMPORT_PREVIEW_REJECTED_MAX,
  type CopilotTelemetryImportPreview,
  type JwtPayload,
  type TelemetryEntryRow,
} from "@bms/shared";

import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { echoedItems, moreTail } from "../spreadsheet-guard";
import { outsideOrganizationMessage, rowList, TelemetryImportService } from "../telemetry-import/telemetry-import.service";
import { TelemetryWriteService } from "./telemetry-write.service";

/** What a check returns: the model-facing note (counts and mapping names only) and, for an import, the card-only preview. */
export type TelemetryProposalCheckResult = {
  readonly note: string;
  readonly preview?: CopilotTelemetryImportPreview;
};

type Mapping = { readonly assetCode: string; readonly pointKey: string };

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The note's mapping clause, bounded by `echoedItems` (the spreadsheet guard's count axis). */
function mappingClause(mappings: readonly Mapping[]): string {
  if (mappings.length === 0) return "creates no point mapping";
  const { shown, omitted } = echoedItems(mappings.map((m) => `${m.assetCode}/${m.pointKey}`));
  return `creates ${plural(mappings.length, "point mapping")}: ${shown.join(", ")}${moreTail(omitted)}`;
}

function note(accepted: number, total: number, rejected: number, mappings: readonly Mapping[]): string {
  return `${accepted} of ${total} rows accepted, ${rejected} rejected; ${mappingClause(mappings)}.`;
}

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18, Q21; owner rulings 2026-10-24, drafter
 * choices 2 and 4) — the check a telemetry proposal runs before its card is
 * stored, the `ReportProposalCheckService` shape. It reads only.
 *
 * - The import runs the route's own `preview` (`previewForProposal`): its counts
 *   reach the card unchanged, at most 20 of its rejected rows and 50 of the
 *   mappings the commit would create are kept for the card, and a row whose
 *   asset is outside the caller's scope or the conversation's organization
 *   refuses the proposal with the row numbers.
 * - The readings run `TelemetryWriteService.validateRows`, the route's own row
 *   checks: a row the route would reject refuses the proposal with the route's
 *   sentence and the row number, and a row whose asset is in another
 *   organization than the conversation's refuses it too.
 *
 * A refusal is an `HttpException`; its sentence reaches the model. The note
 * names counts and `CODE/pointKey` mapping names only.
 */
@Injectable()
export class TelemetryProposalCheckService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly imports: TelemetryImportService,
    private readonly writes: TelemetryWriteService,
  ) {}

  async checkImport(input: { user: JwtPayload; organizationId: string; buffer: Buffer }): Promise<TelemetryProposalCheckResult> {
    const result = await this.imports.previewForProposal(input.user, input.buffer, input.organizationId);
    const preview: CopilotTelemetryImportPreview = {
      totalRows: result.totalRows,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      rejected: result.rejected.slice(0, COPILOT_IMPORT_PREVIEW_REJECTED_MAX),
      mappingsToCreate: result.mappingsToCreate.slice(0, COPILOT_IMPORT_PREVIEW_MAPPINGS_MAX),
    };
    return { note: note(result.acceptedCount, result.totalRows, result.rejectedCount, result.mappingsToCreate), preview };
  }

  async checkReadings(input: {
    user: JwtPayload;
    organizationId: string;
    rows: readonly TelemetryEntryRow[];
  }): Promise<TelemetryProposalCheckResult> {
    const { accepted, rejected } = await this.writes.validateRows(input.user, input.rows);
    if (rejected.length > 0) {
      const first = [...rejected].sort((a, b) => a.rowNumber - b.rowNumber)[0];
      const same = rejected.filter((r) => r.reason === first?.reason).map((r) => r.rowNumber);
      throw new ForbiddenException(`${rowList(same)}: ${first?.reason ?? "rejected"}.`);
    }
    const outside = accepted.filter((a) => a.organizationId !== input.organizationId).map((a) => a.rowNumber);
    if (outside.length > 0) throw new ForbiddenException(outsideOrganizationMessage(outside));
    const needed = accepted.filter((a) => a.mappingNeeded);
    const codes = await this.assetCodes([...new Set(needed.map((a) => a.row.assetId))]);
    const mappings = new Map<string, Mapping>();
    for (const a of needed) {
      mappings.set(`${a.row.assetId}|${a.row.pointKey}`, { assetCode: codes.get(a.row.assetId) ?? a.row.assetId, pointKey: a.row.pointKey });
    }
    return { note: note(accepted.length, input.rows.length, 0, [...mappings.values()]) };
  }

  /** The codes of assets the caller already passed `validateRows` for (read on `fleetDb`, as that check does). */
  private async assetCodes(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.fleetDb.select({ id: assets.id, code: assets.code }).from(assets).where(inArray(assets.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.code]));
  }
}
