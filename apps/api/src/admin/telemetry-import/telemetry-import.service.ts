import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  RejectedRowDto,
  TelemetryEntryRow,
  TelemetryImportCommitDto,
  TelemetryImportPreviewDto,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { TelemetryWriteService } from "../telemetry-entry/telemetry-write.service";
import { type ImportRowRejection, type ParsedImportRow, parseWorkbook } from "./telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES, type TelemetryImportOptions } from "./telemetry-import.schema";

/**
 * Disclosure-safe: identical whether an `asset_code` does not exist at all,
 * or exists but sits outside the caller's access scope — a caller must not
 * be able to tell the two apart by wording (the plan's non-disclosure
 * requirement). `TelemetryWriteService`'s own scope rejection for a resolved
 * `assetId` uses this same text.
 */
const ASSET_NOT_FOUND_REASON = "Asset not found or outside your access scope";

type ResolvedRow = { readonly rowNumber: number; readonly row: TelemetryEntryRow };

/**
 * CSV/Excel telemetry bulk import (`F1.9`).
 *
 * Composes the pure parser (`telemetry-import-rows.ts`) with
 * `TelemetryWriteService` (Phase A, frozen) rather than reimplementing any
 * of that service's write-time decisions (catalog resolution, unit
 * precedence, the retention window, mapping-conflict handling). The only
 * extra step this service owns is `asset_code → assetId` resolution — see
 * `resolveRows`.
 */
@Injectable()
export class TelemetryImportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly writeService: TelemetryWriteService,
  ) {}

  /**
   * Parses and validates without writing anything. `acceptedCount` reflects
   * only structural row validation and asset-code resolution — see
   * `telemetryImportPreviewDtoSchema`'s doc comment for why it stops there.
   */
  // `_opts` is accepted for symmetry with `commit()`'s signature — the web
  // client posts the same options body to both endpoints — but preview never
  // calls `writeReadings`, so `sourceKind`/`conflictPolicy` have no effect
  // on what it reports yet.
  async preview(jwt: JwtPayload, buffer: Buffer, _opts: TelemetryImportOptions): Promise<TelemetryImportPreviewDto> {
    // Role check BEFORE any DB lookup — resolving an asset_code first would
    // make resolution itself an existence oracle for a caller who fails the
    // role gate, the same ordering `TelemetryWriteService.writeReadings`
    // uses for its own per-row scope check.
    await this.accessControl.requireMasterDataUser(jwt);
    this.assertFileSize(buffer);
    const parsed = this.parseOrThrow(buffer);
    const { resolved, rejected: resolutionRejected } = await this.resolveRows(jwt, parsed.rows);
    const rejected = this.mergeRejected(parsed.rejected, resolutionRejected);
    return {
      totalRows: parsed.rows.length + parsed.rejected.length,
      acceptedCount: resolved.length,
      rejectedCount: rejected.length,
      rejected,
    };
  }

  /** Parses, resolves asset codes, then writes accepted rows through the shared write path. */
  async commit(jwt: JwtPayload, buffer: Buffer, opts: TelemetryImportOptions): Promise<TelemetryImportCommitDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    this.assertFileSize(buffer);
    const parsed = this.parseOrThrow(buffer);
    const { resolved, rejected: resolutionRejected } = await this.resolveRows(jwt, parsed.rows);

    const { result, rejected: writeRejected } = await this.writeService.writeReadings(jwt, {
      rows: resolved.map((r) => r.row),
      sourceKind: opts.sourceKind,
      conflictPolicy: opts.conflictPolicy,
      auditAction: "telemetry.import",
    });

    // `writeReadings` numbers `rejected[].rowNumber` as a 1-based index into
    // the `rows` array it was handed — not the original file. Translate
    // back to the row number the operator actually sees in the sheet.
    const remapped: RejectedRowDto[] = writeRejected.map((r) => {
      const original = resolved[r.rowNumber - 1];
      return { ...r, rowNumber: original ? original.rowNumber : r.rowNumber };
    });

    return {
      ...result,
      rejected: this.mergeRejected(parsed.rejected, resolutionRejected, remapped),
    };
  }

  private assertFileSize(buffer: Buffer): void {
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException(
        `File is ${buffer.length} bytes, more than the ${MAX_IMPORT_FILE_BYTES}-byte limit`,
      );
    }
  }

  private parseOrThrow(buffer: Buffer): { rows: ParsedImportRow[]; rejected: ImportRowRejection[] } {
    const result = parseWorkbook(buffer);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return result;
  }

  /**
   * Resolves `asset_code` to `assetId` for rows that need it, in one batch
   * query rather than one per row, and checks scope for every resolved
   * `assetId` via `accessControl.canManageAsset` — also batched, one call per
   * distinct asset rather than per row.
   *
   * The scope check happens **here, in preview too**, not only inside
   * `writeReadings` at commit time: `writeReadings` resolves existence
   * before scope (an asset it has never heard of and one it cannot manage
   * both reject the same way), but `resolveRows`'s own code→id lookup has no
   * scope filter of its own — without a check here, a scoped caller's
   * PREVIEW would report an out-of-scope-but-existing code as "accepted"
   * while a genuinely nonexistent code is "rejected", leaking exactly the
   * existence fact `ASSET_NOT_FOUND_REASON` exists to hide. A code that
   * matches no asset at all, and one that exists but is out of scope, both
   * reject here with the identical message.
   */
  private async resolveRows(
    jwt: JwtPayload,
    rows: ParsedImportRow[],
  ): Promise<{ resolved: ResolvedRow[]; rejected: RejectedRowDto[] }> {
    const codes = [...new Set(rows.filter((r) => !r.assetId && r.assetCode).map((r) => r.assetCode as string))];
    const codeToId = new Map<string, string>();
    if (codes.length > 0) {
      const found = await this.db
        .select({ id: assets.id, code: assets.code })
        .from(assets)
        .where(inArray(assets.code, codes));
      for (const f of found) {
        codeToId.set(f.code, f.id);
      }
    }

    const candidateIds = new Set<string>();
    for (const r of rows) {
      const id = r.assetId ?? (r.assetCode ? codeToId.get(r.assetCode) : undefined);
      if (id) candidateIds.add(id);
    }
    const inScope = new Map<string, boolean>();
    for (const id of candidateIds) {
      inScope.set(id, await this.accessControl.canManageAsset(jwt, id));
    }

    const resolved: ResolvedRow[] = [];
    const rejected: RejectedRowDto[] = [];
    for (const r of rows) {
      const assetId = r.assetId ?? (r.assetCode ? codeToId.get(r.assetCode) : undefined);
      if (!assetId || !inScope.get(assetId)) {
        rejected.push({ rowNumber: r.rowNumber, field: "assetCode", reason: ASSET_NOT_FOUND_REASON });
        continue;
      }
      resolved.push({
        rowNumber: r.rowNumber,
        row: {
          assetId,
          pointKey: r.pointKey,
          value: r.value,
          time: r.time,
          ...(r.unit ? { unit: r.unit } : {}),
        },
      });
    }
    return { resolved, rejected };
  }

  private mergeRejected(...groups: RejectedRowDto[][]): RejectedRowDto[] {
    return groups.flat().sort((a, b) => a.rowNumber - b.rowNumber);
  }
}
