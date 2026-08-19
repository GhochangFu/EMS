import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { assetPoints, assets, pointValues } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  RejectedRowDto,
  TelemetryEntryRow,
  TelemetryWriteResultDto,
  WritableSourceKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import { resolveCatalogPointKey } from "../asset-points/resolve-catalog-point-key";
import { RAW_RETENTION_DAYS } from "../../telemetry/point-aggregates";

/** How many rows land in one `INSERT` statement — batching mirrors the ingest normaliser. */
const MAX_ROWS_PER_STATEMENT = 500;

/** How far into the future a caller's clock is trusted before a reading is refused. */
const FUTURE_SKEW_MS = 60_000;

export type WriteReadingsInput = {
  rows: readonly TelemetryEntryRow[];
  /** What a mapping is CREATED with, when one does not already exist for a row's (assetId, pointKey). */
  sourceKind: WritableSourceKind;
  conflictPolicy: "reject" | "overwrite";
  /** e.g. `"telemetry.manual_entry"` or `"telemetry.import"` — the `bms.audit_log` action. */
  auditAction: string;
};

export type WriteReadingsOutput = {
  result: TelemetryWriteResultDto;
  rejected: RejectedRowDto[];
};

type AcceptedRow = {
  rowNumber: number;
  row: TelemetryEntryRow;
  unit: string | null;
  mappingCreated: boolean;
};

/**
 * The one write path into `telemetry.point_values` outside the MQTT/
 * simulator ingest pipeline (ADR 0018, backlog `F1.8`/`F1.9`).
 *
 * **Row-level, not all-or-nothing.** Every row is validated in application
 * code before any insert runs — a single non-finite value must not fail an
 * entire batch through `point_values_value_finite_check`; the CHECK is the
 * backstop, never the error reporter. Accepted rows are written in one
 * transaction; rejected rows are reported with a reason and never touch the
 * database.
 *
 * **An existing `asset_points` mapping is never mutated** — not its
 * `source_kind`, not its `rtu_id`, not its `unit`. A reading into a point
 * that is already `measured` keeps its provenance. Absent, a mapping is
 * created on demand with the requested `sourceKind` and `rtuId: null` — ADR
 * 0018 made `unmapped`/`manual` points first-class exactly so a reading can
 * exist before a gateway does.
 *
 * **No `pg_notify`.** Ingest notifies because a live reading must reach the
 * Control Room socket; this path also serves bulk historical import, where
 * that would flood it.
 */
@Injectable()
export class TelemetryWriteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async writeReadings(jwt: JwtPayload, input: WriteReadingsInput): Promise<WriteReadingsOutput> {
    const rejected: RejectedRowDto[] = [];
    const accepted: AcceptedRow[] = [];

    for (let i = 0; i < input.rows.length; i += 1) {
      const rowNumber = i + 1;
      const row = input.rows[i];
      const outcome = await this.validateRow(jwt, row, input.sourceKind);
      if (!outcome.ok) {
        rejected.push({ rowNumber, field: outcome.field, reason: outcome.reason });
        continue;
      }
      accepted.push({ rowNumber, row, unit: outcome.unit, mappingCreated: outcome.mappingCreated });
    }

    if (accepted.length === 0) {
      return {
        result: {
          written: 0,
          skipped: 0,
          assetPointsCreated: 0,
          firstTime: null,
          lastTime: null,
          batchId: randomUUID(),
        },
        rejected,
      };
    }

    const batchId = randomUUID();
    const assetPointsCreated = accepted.filter((a) => a.mappingCreated).length;
    const times = accepted.map((a) => a.row.time).sort();

    const writeOutcome = await this.db.transaction(async (tx) => {
      let written = 0;
      for (let i = 0; i < accepted.length; i += MAX_ROWS_PER_STATEMENT) {
        const chunk = accepted.slice(i, i + MAX_ROWS_PER_STATEMENT);
        const values = chunk.map((a) => ({
          time: new Date(a.row.time),
          assetId: a.row.assetId,
          pointKey: a.row.pointKey,
          value: a.row.value,
          unit: a.unit,
        }));

        const query =
          input.conflictPolicy === "overwrite"
            ? tx
                .insert(pointValues)
                .values(values)
                .onConflictDoUpdate({
                  target: [pointValues.time, pointValues.assetId, pointValues.pointKey],
                  set: { value: sql`excluded.value`, unit: sql`excluded.unit` },
                })
                .returning({ time: pointValues.time })
            : tx
                .insert(pointValues)
                .values(values)
                .onConflictDoNothing({
                  target: [pointValues.time, pointValues.assetId, pointValues.pointKey],
                })
                .returning({ time: pointValues.time });

        const returned = await query;
        written += returned.length;
      }

      const assetIds = [...new Set(accepted.map((a) => a.row.assetId))];
      for (const assetId of assetIds) {
        const forAsset = accepted.filter((a) => a.row.assetId === assetId);
        await this.audit.write({
          actor: jwt,
          action: input.auditAction,
          entityType: "asset",
          entityId: assetId,
          payload: {
            batchId,
            sourceKind: input.sourceKind,
            conflictPolicy: input.conflictPolicy,
            rowCount: forAsset.length,
            firstTime: forAsset.map((a) => a.row.time).sort()[0] ?? null,
            lastTime: forAsset.map((a) => a.row.time).sort().at(-1) ?? null,
            rejectedRowNumbers: rejected.slice(0, 20).map((r) => r.rowNumber),
          },
        });
      }

      return written;
    });

    return {
      result: {
        written: writeOutcome,
        skipped: accepted.length - writeOutcome,
        assetPointsCreated,
        firstTime: times[0] ?? null,
        lastTime: times.at(-1) ?? null,
        batchId,
      },
      rejected,
    };
  }

  /**
   * Validates and resolves one row, including creating its `asset_points`
   * mapping on demand. Never throws for an ordinary rejection — only a
   * rejected outcome or an accepted one, so the caller can keep validating
   * the rest of the batch.
   */
  private async validateRow(
    jwt: JwtPayload,
    row: TelemetryEntryRow,
    sourceKind: WritableSourceKind,
  ): Promise<
    | { ok: true; unit: string | null; mappingCreated: boolean }
    | { ok: false; field: string | null; reason: string }
  > {
    const [assetRow] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, row.assetId))
      .limit(1);
    if (!assetRow) {
      return { ok: false, field: "assetId", reason: "Asset does not exist" };
    }
    if (!(await this.accessControl.canManageAsset(jwt, row.assetId))) {
      return { ok: false, field: "assetId", reason: "Asset is outside your access scope" };
    }

    const rowTime = Date.parse(row.time);
    const now = Date.now();
    if (rowTime > now + FUTURE_SKEW_MS) {
      return { ok: false, field: "time", reason: "Reading time is in the future" };
    }
    const oldestAllowed = now - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (rowTime < oldestAllowed) {
      return {
        ok: false,
        field: "time",
        reason: `Reading is older than the ${RAW_RETENTION_DAYS}-day raw retention horizon`,
      };
    }

    const catalog = await resolveCatalogPointKey(this.db, row.assetId, row.pointKey);
    if (!catalog.ok) {
      return { ok: false, field: "pointKey", reason: catalog.reason };
    }
    if (row.unit !== undefined && catalog.unit !== null && row.unit !== catalog.unit) {
      return {
        ok: false,
        field: "unit",
        reason: `Unit '${row.unit}' does not match the catalog unit '${catalog.unit}' for '${row.pointKey}'`,
      };
    }
    const resolvedUnit = row.unit ?? catalog.unit;

    const [existingMapping] = await this.db
      .select({ id: assetPoints.id, active: assetPoints.active })
      .from(assetPoints)
      .where(and(eq(assetPoints.assetId, row.assetId), eq(assetPoints.pointKey, row.pointKey)))
      .limit(1);

    if (existingMapping) {
      if (!existingMapping.active) {
        return { ok: false, field: "pointKey", reason: "Point mapping is inactive" };
      }
      return { ok: true, unit: resolvedUnit, mappingCreated: false };
    }

    // ON CONFLICT DO NOTHING + re-read: two concurrent requests for the same
    // (assetId, pointKey) cannot both create a mapping. source_data_key is
    // NOT NULL and unique per asset, so it is synthesised rather than reused
    // from a caller who never supplied one.
    const [inserted] = await this.db
      .insert(assetPoints)
      .values({
        assetId: row.assetId,
        pointKey: row.pointKey,
        sourceDataKey: `${sourceKind}:${row.pointKey}`,
        unit: catalog.unit,
        active: true,
        rtuId: null,
        sourceKind,
      })
      .onConflictDoNothing({ target: [assetPoints.assetId, assetPoints.pointKey] })
      .returning({ id: assetPoints.id });

    // `inserted` is empty only when a concurrent request won the race between
    // this row's SELECT above and this INSERT — the mapping now exists, but
    // this call did not create it.
    return { ok: true, unit: resolvedUnit, mappingCreated: inserted !== undefined };
  }
}
