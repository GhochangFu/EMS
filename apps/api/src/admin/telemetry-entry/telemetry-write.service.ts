import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type pg from "pg";

import { assetPoints, assets, pointValues, refreshAggregatesFrom } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  telemetryEntryRowSchema,
  type JwtPayload,
  type RejectedRowDto,
  type TelemetryEntryRow,
  type TelemetryWriteResultDto,
  type WritableSourceKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE, POOL_TOKEN } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import { resolveCatalogPointKey } from "../asset-points/resolve-catalog-point-key";
import { RAW_RETENTION_DAYS } from "../../telemetry/point-aggregates";
import { chunkForNotify, type NotifyReading } from "./notify-chunk";

/** How many rows land in one `INSERT` statement — batching mirrors the ingest normaliser. */
const MAX_ROWS_PER_STATEMENT = 500;

/** How far into the future a caller's clock is trusted before a reading is refused. */
const FUTURE_SKEW_MS = 60_000;

/**
 * How recent a WRITTEN reading must be to raise a `pg_notify` — the only
 * mechanism that reaches `AlarmEngineService` (it evaluates exclusively off
 * `TelemetryBroadcastHub`'s `"readings"` event, fed exclusively by `LISTEN
 * bms_telemetry`; there is no other path from `point_values` to alarm
 * evaluation).
 *
 * Gated on the READING's own timestamp, not on which caller/endpoint wrote
 * it: a manual entry backdated three weeks should no more raise a live alarm
 * than an imported one should, and a bulk import whose last few rows happen
 * to be timestamped seconds ago legitimately should. Five minutes is wider
 * than the web client's own 25 s live-staleness window
 * (`apps/web/src/lib/schematic-telemetry.ts`'s `FRESH_MS`) — that constant
 * governs socket freshness for a UI already streaming; this one has to
 * absorb the human latency of typing a reading in, which the socket case
 * never pays.
 */
const NOTIFY_LIVE_WINDOW_MS = 5 * 60_000;

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

export type WriteReadingsInput = {
  rows: readonly TelemetryEntryRow[];
  /**
   * Caller-supplied row numbers, same length and order as `rows`. When
   * omitted, `rowNumber` defaults to a 1-based index into `rows` — correct
   * for the manual-entry caller, whose `rows` array already IS in its own
   * numbering. The importer's `rows` is NOT in original-sheet order once
   * `resolveRows` has filtered out-of-scope/nonexistent asset codes, so it
   * supplies this to keep every rejection — including a duplicate's `reason`
   * text — in the sheet's own row numbers rather than an array index.
   */
  rowNumbers?: readonly number[];
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
  mappingNeeded: boolean;
};

type ValidateRowResult =
  | { ok: true; unit: string | null; mappingNeeded: boolean }
  | { ok: false; field: string | null; reason: string };

function sortByParsedTime(times: readonly string[]): string[] {
  return [...times].sort((a, b) => Date.parse(a) - Date.parse(b));
}

/**
 * The one write path into `telemetry.point_values` outside the MQTT/
 * simulator ingest pipeline (ADR 0018, backlog `F1.8`/`F1.9`).
 *
 * **Row-level, not all-or-nothing.** Every row is validated in application
 * code — including a `telemetryEntryRowSchema.safeParse`, so `value`
 * finiteness and a parsable `time` are enforced here and not merely assumed
 * from the input type — before any insert runs. Accepted rows are written in
 * one transaction; rejected rows are reported with a reason and never touch
 * the database.
 *
 * **An existing `asset_points` mapping is never mutated** — not its
 * `source_kind`, not its `rtu_id`, not its `unit`. A reading into a point
 * that is already `measured` keeps its provenance. Absent, a mapping is
 * created on demand with the requested `sourceKind` and `rtuId: null` — ADR
 * 0018 made `unmapped`/`manual` points first-class exactly so a reading can
 * exist before a gateway does. Mapping creation happens inside the same
 * transaction as the value writes, each wrapped in its own nested
 * transaction (Postgres `SAVEPOINT`) so a `source_data_key` collision against
 * an unrelated existing mapping rejects only the rows that needed it, rather
 * than aborting the whole batch.
 *
 * **`pg_notify`s only the rows recent enough to matter live** — see
 * `NOTIFY_LIVE_WINDOW_MS`. A bulk historical import's readings are, by
 * construction, almost never in that window, so this costs nothing there;
 * a manual entry almost always is.
 *
 * **Refreshes the ADR 0023 continuous aggregates over the written window
 * after commit.** `refresh_continuous_aggregate` cannot run inside a
 * transaction (ADR 0023), so this runs against the raw pool once `written >
 * 0`, and a refresh failure is logged rather than failing the request — the
 * values are already safely committed; only rollup reads lag until the next
 * scheduled policy run or a manual `pnpm db:refresh-aggregates`.
 */
@Injectable()
export class TelemetryWriteService {
  private readonly logger = new Logger(TelemetryWriteService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    @Inject(POOL_TOKEN) private readonly pool: pg.Pool,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async writeReadings(jwt: JwtPayload, input: WriteReadingsInput): Promise<WriteReadingsOutput> {
    // Fails uniformly for a non-master-data caller before any row is looked
    // at — `validateRow`'s per-row `canManageAsset` also enforces this, but
    // only after checking whether that row's assetId exists, which would
    // otherwise let a non-master-data caller distinguish "exists, forbidden"
    // (403) from "doesn't exist" (200 with a rejection) — an existence
    // oracle a caller with no rights to this data should not get.
    await this.accessControl.requireMasterDataUser(jwt);

    const rejected: RejectedRowDto[] = [];
    const validated: AcceptedRow[] = [];

    for (let i = 0; i < input.rows.length; i += 1) {
      const rowNumber = input.rowNumbers?.[i] ?? i + 1;
      const row = input.rows[i];
      const outcome = await this.validateRow(jwt, row);
      if (!outcome.ok) {
        rejected.push({ rowNumber, field: outcome.field, reason: outcome.reason });
        continue;
      }
      validated.push({ rowNumber, row, unit: outcome.unit, mappingNeeded: outcome.mappingNeeded });
    }

    // In-batch duplicates: first occurrence wins, later ones are reported
    // rather than reaching Postgres — the ingest normaliser's own
    // `apps/ingest/src/host/normaliser.ts` dedup precedent, applied here so a
    // duplicate never reaches `ON CONFLICT DO UPDATE`, which raises 21000
    // ("cannot affect row a second time") and aborts the whole transaction.
    // Keyed on the PARSED instant, not the raw string, so two differently
    // formatted timestamps for the same instant still collide.
    const firstSeenAtRow = new Map<string, number>();
    const accepted: AcceptedRow[] = [];
    for (const v of validated) {
      const key = `${Date.parse(v.row.time)}|${v.row.assetId}|${v.row.pointKey}`;
      const firstRowNumber = firstSeenAtRow.get(key);
      if (firstRowNumber !== undefined) {
        rejected.push({
          rowNumber: v.rowNumber,
          field: null,
          reason: `Duplicate of row ${firstRowNumber} — same (time, assetId, pointKey) within this batch`,
        });
        continue;
      }
      firstSeenAtRow.set(key, v.rowNumber);
      accepted.push(v);
    }

    if (accepted.length === 0) {
      // No row survived to be `accepted` — there is no assetId to key a
      // per-asset audit row on the way the transaction below does. Key on
      // the attempt itself instead: an all-rejected batch (the common shape
      // for a scope-denied bulk import) must still leave a trail, not zero
      // rows just because nothing reached the database.
      const noWriteBatchId = randomUUID();
      await this.audit.write({
        actor: jwt,
        action: input.auditAction,
        entityType: "telemetry_batch",
        entityId: noWriteBatchId,
        payload: {
          batchId: noWriteBatchId,
          sourceKind: input.sourceKind,
          conflictPolicy: input.conflictPolicy,
          rowCount: 0,
          // Row numbers only, same non-disclosure reasoning as the
          // written-path audit below: never asset codes/ids here.
          rejectedRowNumbers: rejected.slice(0, 20).map((r) => r.rowNumber),
        },
      });
      return {
        result: {
          written: 0,
          skipped: rejected.length,
          assetPointsCreated: 0,
          firstTime: null,
          lastTime: null,
          batchId: noWriteBatchId,
        },
        rejected,
      };
    }

    const batchId = randomUUID();

    const { written, assetPointsCreated, writtenRows } = await this.db.transaction(async (tx) => {
      // ---- mapping creation, savepoint-isolated per (assetId, pointKey) ----

      const pairsNeeded = new Map<string, AcceptedRow>();
      for (const a of accepted) {
        if (a.mappingNeeded) {
          pairsNeeded.set(`${a.row.assetId}|${a.row.pointKey}`, a);
        }
      }

      let assetPointsCreated = 0;
      const failedMappingRows = new Set<number>();
      for (const [, representative] of pairsNeeded) {
        try {
          // ON CONFLICT DO NOTHING + re-read is not needed here: two
          // concurrent requests each open their own outer transaction, so
          // Postgres itself serialises the conflicting inserts.
          const inserted = await tx.transaction(async (tx2) => {
            const [created] = await tx2
              .insert(assetPoints)
              .values({
                assetId: representative.row.assetId,
                pointKey: representative.row.pointKey,
                sourceDataKey: `${input.sourceKind}:${representative.row.pointKey}`,
                unit: representative.unit,
                active: true,
                rtuId: null,
                sourceKind: input.sourceKind,
              })
              .onConflictDoNothing({ target: [assetPoints.assetId, assetPoints.pointKey] })
              .returning({ id: assetPoints.id });
            return created;
          });
          if (inserted !== undefined) {
            assetPointsCreated += 1;
          }
        } catch (err: unknown) {
          const code = (err as { code?: string } | null)?.code;
          if (code !== UNIQUE_VIOLATION) {
            throw err;
          }
          // The synthesised source_data_key collided with an unrelated
          // existing mapping's — not the (assetId, pointKey) ON CONFLICT
          // target. The nested transaction's SAVEPOINT rolled back this one
          // attempt only; every row that needed this pair is rejected, and
          // every other pair's mapping creation proceeds. Compared directly
          // against `representative`'s own fields, not a re-split `pairKey`
          // string — `pointKey` has no character restriction, so a code
          // containing the join delimiter would otherwise misattribute this.
          for (const a of accepted) {
            if (a.row.assetId === representative.row.assetId && a.row.pointKey === representative.row.pointKey) {
              failedMappingRows.add(a.rowNumber);
            }
          }
        }
      }
      for (const rowNumber of failedMappingRows) {
        rejected.push({
          rowNumber,
          field: "pointKey",
          reason: "Could not create a mapping for this point: its source data key collides with an existing one",
        });
      }

      // ---- value writes, chunked ----

      const toWrite = accepted.filter((a) => !failedMappingRows.has(a.rowNumber));
      const writtenKey = (time: Date | string, assetId: string, pointKey: string): string =>
        `${new Date(time).toISOString()}|${assetId}|${pointKey}`;
      const writtenKeys = new Set<string>();

      for (let i = 0; i < toWrite.length; i += MAX_ROWS_PER_STATEMENT) {
        const chunk = toWrite.slice(i, i + MAX_ROWS_PER_STATEMENT);
        const values = chunk.map((a) => ({
          time: new Date(a.row.time),
          assetId: a.row.assetId,
          pointKey: a.row.pointKey,
          value: a.row.value,
          unit: a.unit,
        }));

        const returningCols = {
          time: pointValues.time,
          assetId: pointValues.assetId,
          pointKey: pointValues.pointKey,
        };
        const query =
          input.conflictPolicy === "overwrite"
            ? tx
                .insert(pointValues)
                .values(values)
                .onConflictDoUpdate({
                  target: [pointValues.time, pointValues.assetId, pointValues.pointKey],
                  set: { value: sql`excluded.value`, unit: sql`excluded.unit` },
                })
                .returning(returningCols)
            : tx
                .insert(pointValues)
                .values(values)
                .onConflictDoNothing({
                  target: [pointValues.time, pointValues.assetId, pointValues.pointKey],
                })
                .returning(returningCols);

        const returned = await query;
        for (const r of returned) {
          writtenKeys.add(writtenKey(r.time, r.assetId, r.pointKey));
        }
      }

      const writtenRows = toWrite.filter((a) =>
        writtenKeys.has(writtenKey(a.row.time, a.row.assetId, a.row.pointKey)),
      );
      for (const a of toWrite) {
        if (!writtenKeys.has(writtenKey(a.row.time, a.row.assetId, a.row.pointKey))) {
          rejected.push({
            rowNumber: a.rowNumber,
            field: null,
            reason:
              "A reading already exists for this (time, assetId, pointKey) and conflictPolicy is 'reject'",
          });
        }
      }

      // ---- notify, live-window rows only ----

      const nowMs = Date.now();
      const liveReadings: NotifyReading[] = writtenRows
        .filter((a) => nowMs - Date.parse(a.row.time) <= NOTIFY_LIVE_WINDOW_MS)
        .map((a) => ({
          // Normalised to the same instant the row was stored at
          // (`new Date(a.row.time)`, line ~264), not the caller's raw
          // string. `telemetryEntryRowSchema.time` admits any parsable
          // form, including offset-less ones an `<input type="datetime-
          // local">` or a CSV cell emits — those parse as the reading
          // API PROCESS's local time, not UTC. Shipping the raw string
          // let the browser re-resolve it against ITS OWN zone, disagreeing
          // with what got stored whenever the two run in different zones.
          time: new Date(a.row.time).toISOString(),
          assetId: a.row.assetId,
          pointKey: a.row.pointKey,
          value: a.row.value,
          unit: a.unit,
        }));
      for (const payload of chunkForNotify(liveReadings)) {
        try {
          await tx.execute(sql`SELECT pg_notify('bms_telemetry', ${JSON.stringify({ readings: payload })})`);
        } catch (err) {
          // Every field's length is bounded by telemetryEntryRowSchema well
          // under MAX_NOTIFY_UTF8_BYTES, so this should be unreachable — but
          // a NOTIFY failure must never roll back an otherwise-valid,
          // already-committed-worthy write. Logged, not thrown, matching the
          // post-commit aggregate-refresh failure below.
          this.logger.warn(
            `pg_notify failed for batch ${batchId}; live alarm evaluation may miss this write: ` +
              `${(err as Error)?.message ?? err}`,
          );
        }
      }

      // ---- audit, atomic with the writes it describes ----
      // Driven by `accepted` (every row this attempt tried to write), not
      // `writtenRows` (only the rows that actually landed) — an attempt
      // where every row was rejected inside the transaction (an all-conflict
      // `reject`-policy batch, or every row's mapping collided) must still
      // leave an audit trail. `rowCount` still reports what was actually
      // written, so the payload stays truthful even when that is zero. The
      // OTHER way every row can be rejected — none surviving `validateRow`
      // at all, so `accepted` is empty and this transaction never opens —
      // is audited separately, above, before the early `return`.
      const assetIds = [...new Set(accepted.map((a) => a.row.assetId))];
      for (const assetId of assetIds) {
        const forAsset = writtenRows.filter((a) => a.row.assetId === assetId);
        const sortedTimes = sortByParsedTime(forAsset.map((a) => a.row.time));
        await this.audit.write(
          {
            actor: jwt,
            action: input.auditAction,
            entityType: "asset",
            entityId: assetId,
            payload: {
              batchId,
              sourceKind: input.sourceKind,
              conflictPolicy: input.conflictPolicy,
              rowCount: forAsset.length,
              // Names which point(s) were written, not just the asset and a
              // count — without it, an overwrite is traceable to "this
              // asset, this time window" but not to "this point". Bounded by
              // the row cap (50 for manual entry, 20,000 for import), same
              // as rejectedRowNumbers below.
              pointKeys: [...new Set(forAsset.map((a) => a.row.pointKey))],
              firstTime: sortedTimes[0] ?? null,
              lastTime: sortedTimes.at(-1) ?? null,
              rejectedRowNumbers: rejected.slice(0, 20).map((r) => r.rowNumber),
            },
          },
          tx,
        );
      }

      return { written: writtenRows.length, assetPointsCreated, writtenRows };
    });

    if (writtenRows.length > 0) {
      const writtenTimes = writtenRows.map((a) => Date.parse(a.row.time));
      const earliestMs = Math.min(...writtenTimes);
      const latestMs = Math.max(...writtenTimes);
      try {
        await refreshAggregatesFrom(this.pool, new Date(earliestMs), new Date(latestMs));
      } catch (err) {
        this.logger.warn(
          `aggregate refresh failed for batch ${batchId}; rollup reads may lag until the next ` +
            `scheduled policy run or a manual refresh: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    const times = sortByParsedTime(writtenRows.map((a) => a.row.time));

    return {
      result: {
        written,
        skipped: rejected.length,
        assetPointsCreated,
        firstTime: times[0] ?? null,
        lastTime: times.at(-1) ?? null,
        batchId,
      },
      rejected,
    };
  }

  /**
   * Validates and resolves one row. Never writes — mapping creation happens
   * inside `writeReadings`'s transaction, so a still-open validation pass
   * cannot leave a mapping behind for a row the rest of the batch rejects.
   * Never throws for an ordinary rejection — only a rejected outcome or an
   * accepted one, so the caller can keep validating the rest of the batch.
   */
  private async validateRow(jwt: JwtPayload, row: TelemetryEntryRow): Promise<ValidateRowResult> {
    const parsed = telemetryEntryRowSchema.safeParse(row);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        field: issue?.path.length ? issue.path.join(".") : null,
        reason: issue?.message ?? "Row failed validation",
      };
    }
    const data = parsed.data;

    // One message for both "does not exist" and "outside your access scope":
    // distinguishing them tells a master-data caller which UUIDs exist
    // outside their own scope. The existence check still runs first —
    // `canManageAsset` returns `true` unconditionally for an `admin` role
    // without checking existence, so it alone would let a nonexistent
    // assetId reach the FK-constrained inserts below.
    const [assetRow] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, data.assetId))
      .limit(1);
    if (!assetRow) {
      return { ok: false, field: "assetId", reason: "Asset not found or outside your access scope" };
    }
    if (!(await this.accessControl.canManageAsset(jwt, data.assetId))) {
      return { ok: false, field: "assetId", reason: "Asset not found or outside your access scope" };
    }

    const rowTime = Date.parse(data.time);
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

    const catalog = await resolveCatalogPointKey(this.db, data.assetId, data.pointKey);
    if (!catalog.ok) {
      return { ok: false, field: "pointKey", reason: catalog.reason };
    }

    const [existingMapping] = await this.db
      .select({ id: assetPoints.id, active: assetPoints.active, unit: assetPoints.unit })
      .from(assetPoints)
      .where(and(eq(assetPoints.assetId, data.assetId), eq(assetPoints.pointKey, data.pointKey)))
      .limit(1);

    // The mapping's own unit wins when a mapping already exists — it can
    // legitimately differ from the catalog's (set explicitly at creation via
    // `AssetPointsAdminService.create`), and existing readings on that point
    // already carry the mapping's unit, not necessarily the catalog's.
    const authoritativeUnit = existingMapping ? existingMapping.unit : catalog.unit;
    if (data.unit !== undefined && authoritativeUnit !== null && data.unit !== authoritativeUnit) {
      return {
        ok: false,
        field: "unit",
        reason:
          `Unit '${data.unit}' does not match the ${existingMapping ? "mapping" : "catalog"} unit ` +
          `'${authoritativeUnit}' for '${data.pointKey}'`,
      };
    }
    const resolvedUnit = data.unit ?? authoritativeUnit;

    if (existingMapping) {
      if (!existingMapping.active) {
        return { ok: false, field: "pointKey", reason: "Point mapping is inactive" };
      }
      return { ok: true, unit: resolvedUnit, mappingNeeded: false };
    }

    return { ok: true, unit: resolvedUnit, mappingNeeded: true };
  }
}
