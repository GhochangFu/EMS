import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { inArray, or } from "drizzle-orm";
import { z } from "zod";

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
import { FLEET_DRIZZLE } from "../../database/database.tokens";
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

const assetIdShape = z.string().uuid();

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
    // E7.1b: the asset-resolution read (code/id -> locationId) touches `assets`,
    // FORCE-policied as of 0047. A master-data importer's `writableLocationIds`
    // can span organizations, so a single tenant GUC cannot resolve every row's
    // asset — ADR 0043 Amendment 3 decision 3 routes this cross-org case to
    // fleetDb and rejects the per-org loop. `writableLocationIds` below is the
    // isolation control (Amendment 2/3) the amendment trusts. On the bare tenant
    // pool with no GUC the lookup returns zero rows and every import row wrongly
    // fails "asset not found".
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
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
      // `resolved` is NOT in original-sheet order once out-of-scope/
      // nonexistent asset codes have been filtered out above — supplying
      // the sheet's own row numbers keeps every rejection `writeReadings`
      // produces, including a duplicate's `reason` text, in the number the
      // operator actually sees, with no after-the-fact translation needed.
      rowNumbers: resolved.map((r) => r.rowNumber),
      sourceKind: opts.sourceKind,
      conflictPolicy: opts.conflictPolicy,
      auditAction: "telemetry.import",
    });

    // `result.skipped` (from `writeReadings`) only counts rows rejected
    // INSIDE that call — it knows nothing about rows the parser or
    // `resolveRows` already turned away before `writeReadings` ever saw
    // them. Recompute from the full merged list so `skipped` and
    // `rejected.length` always agree, however many stages a row's
    // rejection came from.
    const rejected = this.mergeRejected(parsed.rejected, resolutionRejected, writeRejected);

    return {
      ...result,
      skipped: rejected.length,
      rejected,
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
   * Resolves `asset_code`/`asset_id` to `{ assetId, locationId }` for every
   * row, and checks scope, all with a FIXED number of DB round trips
   * regardless of row count — one batch lookup plus one
   * `writableLocationIds` call, then a pure in-memory membership test per
   * row. Earlier this called `accessControl.canManageAsset` (~4 sequential
   * queries) once per distinct resolved asset, inside the loop: over up to
   * 20,000 rows that made per-row cost proportional to whether a row's
   * asset was out-of-scope-but-real (several queries) or simply nonexistent
   * (zero — it never entered the candidate set), a wall-clock-measurable,
   * partition-searchable oracle over the asset-code namespace on top of
   * being its own DoS amplification. Hoisting scope resolution out of the
   * loop closes both at once.
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
   *
   * A malformed `asset_id` cell (not a UUID shape at all) is rejected
   * before it is ever compared against the `uuid`-typed `assets.id` column —
   * without this, Postgres throws 22P02 (invalid input syntax) on the first
   * such row, uncaught, a 500 that only a SCOPED caller could trigger (an
   * `admin` role's own scope check would short-circuit before touching the
   * DB with the bad value).
   */
  private async resolveRows(
    jwt: JwtPayload,
    rows: ParsedImportRow[],
  ): Promise<{ resolved: ResolvedRow[]; rejected: RejectedRowDto[] }> {
    const codes = [...new Set(rows.filter((r) => !r.assetId && r.assetCode).map((r) => r.assetCode as string))];
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.assetId && assetIdShape.safeParse(r.assetId).success)
          .map((r) => r.assetId as string),
      ),
    ];

    const byCode = new Map<string, { id: string; locationId: string }>();
    const byId = new Map<string, { locationId: string }>();
    if (codes.length > 0 || ids.length > 0) {
      const conditions = [];
      if (codes.length > 0) conditions.push(inArray(assets.code, codes));
      if (ids.length > 0) conditions.push(inArray(assets.id, ids));
      const found = await this.fleetDb
        .select({ id: assets.id, code: assets.code, locationId: assets.locationId })
        .from(assets)
        .where(or(...conditions));
      for (const f of found) {
        byCode.set(f.code, { id: f.id, locationId: f.locationId });
        byId.set(f.id, { locationId: f.locationId });
      }
    }

    // `null` means unrestricted (global admin) — see `AccessControlService`.
    const writableLocationIds = await this.accessControl.writableLocationIds(jwt);

    const resolved: ResolvedRow[] = [];
    const rejected: RejectedRowDto[] = [];
    for (const r of rows) {
      let assetId: string | undefined;
      let locationId: string | undefined;
      if (r.assetId) {
        const match = byId.get(r.assetId);
        if (match) {
          assetId = r.assetId;
          locationId = match.locationId;
        }
      } else if (r.assetCode) {
        const match = byCode.get(r.assetCode);
        if (match) {
          assetId = match.id;
          locationId = match.locationId;
        }
      }
      const inScope =
        assetId !== undefined &&
        locationId !== undefined &&
        (writableLocationIds === null || writableLocationIds.includes(locationId));
      if (!assetId || !inScope) {
        rejected.push({
          rowNumber: r.rowNumber,
          field: r.assetId ? "assetId" : "assetCode",
          reason: ASSET_NOT_FOUND_REASON,
        });
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
