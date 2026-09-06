import { randomUUID } from "node:crypto";

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";

import { assetPoints, assets, locations, pointKeys, rtus, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  MappingSheetCommitDto,
  MappingSheetErrorDto,
  MappingSheetPreviewDto,
  PointSourceKind,
  QualityPolicy,
  TemplatePointKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService, type AuditInput } from "../master-data-audit.service";
import { buildMappingSheetRows, mappingSheetToBuffer } from "./mapping-sheet-export";
import { planMappingSheet } from "./mapping-sheet-plan";
import type { MappingSheetPlan, PlannedCreate, PlannedUpdate } from "./mapping-sheet-plan";
import { parseMappingSheet } from "./mapping-sheet-rows";
import { assetPointKey, assetSourceKey } from "./mapping-sheet-snapshot";
import type {
  ExistingRow,
  PlanSnapshot,
  SnapshotAsset,
  SnapshotCatalogEntry,
  SnapshotTemplatePoint,
} from "./mapping-sheet-snapshot";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the `MAPPINGS` sheet, wired to the
 * database: export one location as a workbook, preview an uploaded sheet
 * against it, and commit the valid rows in one transaction.
 *
 * Everything that decides *what* the sheet means is pure and lives elsewhere —
 * `mapping-sheet-rows.ts` parses, `mapping-sheet-export.ts` writes the workbook,
 * `mapping-sheet-plan.ts` diffs. This file is the IO: the scope gate, the one
 * snapshot read those three modules share, and the writes.
 *
 * **Order, and it is load-bearing** (design decision 7 and the plan's Unit H):
 * `requireMasterDataUser` → `canManageLocation` → resolve the organization on
 * `fleetDb` → the size check → parse. An uploaded file is a security surface
 * (§9.6): nothing is read out of it until the caller has been shown to be
 * allowed to manage this location, and nothing from inside it is ever logged.
 *
 * **The snapshot reads run inside `withTenant`** (design decision 9). One
 * location is one organization, so §4.3's default applies and no named reason
 * is needed; the organization is resolved from `locations` on `fleetDb` first,
 * behind the `canManageLocation` grant, exactly as `assets.service.ts` does.
 * `commit` opens one such transaction and does the read, the writes and the
 * audit rows inside it, so a throw anywhere rolls back all three.
 */
@Injectable()
export class MappingSheetService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** One location's current mappings and template pre-fill as a `MAPPINGS` workbook. */
  async exportSheet(jwt: JwtPayload, locationId: string): Promise<{ buffer: Buffer; filename: string }> {
    const location = await this.resolveLocation(jwt, locationId);
    const snapshot = await withTenant(this.tenantDb, location.organizationId, (tx) =>
      this.loadSnapshot(tx, locationId),
    );
    return {
      buffer: mappingSheetToBuffer(buildMappingSheetRows(snapshot)),
      filename: `mapping-sheet-${safeFilenamePart(location.code)}.xlsx`,
    };
  }

  /** What an uploaded sheet would do to the location. Writes nothing. */
  async preview(jwt: JwtPayload, locationId: string, buffer: Buffer): Promise<MappingSheetPreviewDto> {
    const location = await this.resolveLocation(jwt, locationId);
    const parsed = this.parseOrRefuse(buffer);

    const { plan, errors } = await withTenant(this.tenantDb, location.organizationId, async (tx) => {
      const snapshot = await this.loadSnapshot(tx, locationId);
      return this.planAgainst(parsed, snapshot);
    });

    return {
      locationId,
      totalRows: parsed.totalRows,
      creates: plan.previewCreates,
      updates: plan.previewUpdates,
      unchanged: plan.unchanged,
      untouchedSuggestions: plan.untouchedSuggestions,
      errors,
    };
  }

  /**
   * Applies the sheet's valid rows in one transaction and returns the rest as
   * `skipped` — the Q-5 ruling: a bad row is skipped, never fatal. A *thrown*
   * error is fatal and rolls the whole commit back, which is what makes
   * "exactly the rows the preview promised, or none" true.
   */
  async commit(jwt: JwtPayload, locationId: string, buffer: Buffer): Promise<MappingSheetCommitDto> {
    const location = await this.resolveLocation(jwt, locationId);
    const parsed = this.parseOrRefuse(buffer);

    const applied = await withTenant(this.tenantDb, location.organizationId, async (tx) => {
      const snapshot = await this.loadSnapshot(tx, locationId);
      const { plan, errors } = this.planAgainst(parsed, snapshot);
      await this.applyPlan(jwt, tx, location.organizationId, plan);
      return { created: plan.creates.length, updated: plan.updates.length, errors };
    });

    return {
      locationId,
      applied: { created: applied.created, updated: applied.updated },
      skipped: applied.errors,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* The gate                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Role, then scope, then the organization the tenant context will name.
   *
   * `locations` carries a policy (`0040`) and this read is on `fleetDb`; the
   * `canManageLocation` check above it is the isolation control, the same
   * "bypass, then trust an already-computed grant" shape `assets.service.ts`
   * `resolveLocationOrg` uses (ADR 0043 Amendment 2/3). `code` comes back on the
   * one query because the export's filename is built from it.
   */
  private async resolveLocation(
    jwt: JwtPayload,
    locationId: string,
  ): Promise<{ organizationId: string; code: string }> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const [row] = await this.fleetDb
      .select({ organizationId: locations.organizationId, code: locations.code })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return row;
  }

  /**
   * The parse, with a file-level refusal turned into a 400 whose body is one
   * `MappingSheetErrorDto` (design decision 7) — the same shape a row error has,
   * so the web renders one table either way.
   *
   * **The size check is inside `parseMappingSheet`, not repeated here.** It is
   * that function's first statement, before `XLSX.read`, so nothing unbounded
   * runs on an oversized upload and the refusal arrives as `file_too_large`
   * through this same path. A second copy of the limit here would be a second
   * place to change it (§4.4) — and the copy that goes stale is the one nothing
   * tests.
   *
   * §9.6: the message comes from the closed vocabulary in
   * `mapping-sheet-rows.ts`, and no cell of the uploaded file is ever logged.
   */
  private parseOrRefuse(buffer: Buffer): {
    rows: ParsedRows;
    totalRows: number;
    parseErrors: MappingSheetErrorDto[];
  } {
    const result = parseMappingSheet(buffer);
    if (!result.ok) {
      throw new BadRequestException(result.error);
    }
    return { rows: result.rows, totalRows: result.totalRows, parseErrors: result.errors };
  }

  /**
   * Steps 5–15 against the snapshot, with the parser's steps 1–4 refusals
   * merged back in **by row number**. `planMappingSheet` sorts only its own
   * errors, so a plain concatenation would list every parse error before every
   * plan error rather than in the order the person reads the sheet.
   */
  private planAgainst(
    parsed: { rows: ParsedRows; parseErrors: MappingSheetErrorDto[] },
    snapshot: PlanSnapshot,
  ): { plan: MappingSheetPlan; errors: MappingSheetErrorDto[] } {
    const plan = planMappingSheet(parsed.rows, snapshot);
    const errors = [...parsed.parseErrors, ...plan.errors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    return { plan, errors };
  }

  /* ---------------------------------------------------------------------- */
  /* The snapshot                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * One location's picture, read on the open tenant transaction.
   *
   * Five queries, and each one's breadth is a decision:
   *
   * - **every asset of the location, inactive included.** The export drops the
   *   inactive ones itself; the planner needs them so a row naming one reports
   *   `asset_inactive` rather than the misleading `asset_not_found`.
   * - **every `asset_points` row, `computed` included.** The export drops
   *   computed rows itself (they have no source tag). The planner needs them
   *   twice over: step 6 refuses a row naming one, and
   *   `asset_points_asset_id_point_key_unique` means a computed row the
   *   snapshot hid would be planned as a create and raise 23505 mid-commit.
   * - **every RTU of the location, retired included** — `rtusByCode` is the
   *   active set step 9 resolves against, `rtuCodesById` is all of them, so an
   *   existing row still names the gateway it is wired to (correction 39).
   * - **the whole catalog**, which is fleet-wide vocabulary after ADR 0051 and
   *   small; filtering it by the sheet's keys would need the sheet, and the
   *   export needs it too.
   * - **the pinned template versions' points**, for the pre-fill, the
   *   `derived` refusal and the five defaults the merged band resolves against.
   */
  private async loadSnapshot(tx: BmsTx, locationId: string): Promise<PlanSnapshot> {
    const assetRows = await tx
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        active: assets.active,
        templateId: assets.templateId,
        rtuId: assets.rtuId,
      })
      .from(assets)
      .where(eq(assets.locationId, locationId));

    const assetsByCode = new Map<string, SnapshotAsset>(
      assetRows.map((row) => [
        row.code,
        { id: row.id, name: row.name, active: row.active, templateId: row.templateId, rtuId: row.rtuId },
      ]),
    );
    const assetIds = assetRows.map((row) => row.id);

    const pointRows = assetIds.length === 0 ? [] : await tx.select().from(assetPoints).where(inArray(assetPoints.assetId, assetIds));
    const existingByAssetPoint = new Map<string, ExistingRow>();
    const existingByAssetSource = new Map<string, string>();
    for (const row of pointRows) {
      const existing: ExistingRow = {
        id: row.id,
        assetId: row.assetId,
        pointKey: row.pointKey,
        // The CHECK constraint `asset_points_source_kind_check` guarantees the
        // vocabulary; drizzle types the column as its raw varchar.
        sourceKind: row.sourceKind as PointSourceKind,
        rtuId: row.rtuId,
        sourceDataKey: row.sourceDataKey,
        unit: row.unit,
        active: row.active,
        metadata: {
          scaleMultiplier: row.scaleMultiplier,
          scaleOffset: row.scaleOffset,
          engMin: row.engMin,
          engMax: row.engMax,
          qualityPolicy: row.qualityPolicy as QualityPolicy | null,
        },
      };
      existingByAssetPoint.set(assetPointKey(row.assetId, row.pointKey), existing);
      existingByAssetSource.set(assetSourceKey(row.assetId, row.sourceDataKey), row.pointKey);
    }

    const rtuRows = await tx
      .select({ id: rtus.id, code: rtus.code, active: rtus.active })
      .from(rtus)
      .where(eq(rtus.locationId, locationId));
    const rtuCodesById = new Map<string, string>();
    const rtusByCode = new Map<string, string>();
    for (const row of rtuRows) {
      rtuCodesById.set(row.id, row.code);
      if (row.active) {
        rtusByCode.set(row.code, row.id);
      }
    }

    const catalogRows = await tx
      .select({ code: pointKeys.code, unit: pointKeys.unit, active: pointKeys.active })
      .from(pointKeys);
    const catalog = new Map<string, SnapshotCatalogEntry>(
      catalogRows.map((row) => [row.code, { unit: row.unit, active: row.active }]),
    );

    const templateIds = [...new Set(assetRows.flatMap((row) => (row.templateId === null ? [] : [row.templateId])))];
    const templateRows =
      templateIds.length === 0
        ? []
        : await tx
            .select({
              templateId: templatePoints.templateId,
              pointKey: templatePoints.pointKey,
              kind: templatePoints.kind,
              unit: templatePoints.unit,
              sourceDataKeyPattern: templatePoints.sourceDataKeyPattern,
              scaleMultiplier: templatePoints.scaleMultiplier,
              scaleOffset: templatePoints.scaleOffset,
              engMin: templatePoints.engMin,
              engMax: templatePoints.engMax,
              qualityPolicy: templatePoints.qualityPolicy,
            })
            .from(templatePoints)
            .where(inArray(templatePoints.templateId, templateIds));
    const templatePointsByKey = new Map<string, SnapshotTemplatePoint>(
      templateRows.map((row) => [
        assetPointKey(row.templateId, row.pointKey),
        {
          templateId: row.templateId,
          pointKey: row.pointKey,
          // `template_points_kind_check` guarantees the vocabulary, as
          // `template-point-defaults.ts` records for the same column.
          kind: row.kind as TemplatePointKind,
          unit: row.unit,
          sourceDataKeyPattern: row.sourceDataKeyPattern,
          defaults: {
            scaleMultiplier: row.scaleMultiplier,
            scaleOffset: row.scaleOffset,
            engMin: row.engMin,
            engMax: row.engMax,
            qualityPolicy: row.qualityPolicy as QualityPolicy | null,
          },
        },
      ]),
    );

    return {
      assetsByCode,
      existingByAssetPoint,
      existingByAssetSource,
      rtuCodesById,
      rtusByCode,
      catalog,
      templatePoints: templatePointsByKey,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* The writes                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * The commit, **in three phases inside the one transaction** (correction 38).
   *
   * 1. Every row whose `source_data_key` changes is parked on a unique
   *    placeholder.
   * 2. The updates are applied.
   * 3. The inserts run.
   *
   * Phase 1 is not defensive tidiness. `asset_points_asset_source_key_idx` is
   * unique on `(asset_id, source_data_key)` and is checked per statement, so two
   * rows of one asset **exchanging** their keys collide in whichever order the
   * updates are issued — there is no safe order. Step 14's "which this sheet
   * does not change" clause deliberately admits that swap, so the planner passes
   * it through and this is where it has to be made to work; without phase 1 the
   * 23505 would roll back every valid row in the sheet.
   *
   * Phases 2 and 3 are ordered for the same reason in one direction only: an
   * insert may take a key an update releases, never the reverse (a create's own
   * key is checked against the sheet and the location in step 14).
   */
  private async applyPlan(
    jwt: JwtPayload,
    tx: BmsTx,
    organizationId: string,
    plan: MappingSheetPlan,
  ): Promise<void> {
    // Phase 1 — park every re-keyed row. `changes` already says which those are.
    for (const update of plan.updates) {
      if (update.changes.some((change) => change.field === "sourceDataKey")) {
        await tx
          .update(assetPoints)
          .set({ sourceDataKey: `${SWAP_PLACEHOLDER_PREFIX}${randomUUID()}` })
          .where(eq(assetPoints.id, update.assetPointId));
      }
    }

    // Phase 2 — the updates, one statement each: every row sets different values.
    for (const update of plan.updates) {
      await tx.update(assetPoints).set(writeColumns(update)).where(eq(assetPoints.id, update.assetPointId));
    }

    // Phase 3 — the inserts, chunked for the same parameter-count reason
    // `writeMany` is. `returning` gives each new row its id for the audit trail;
    // it is matched back by `(assetId, pointKey)` rather than by position, which
    // `asset_points_asset_id_point_key_unique` makes exact.
    const createdIds = new Map<string, string>();
    for (let i = 0; i < plan.creates.length; i += INSERT_CHUNK) {
      const chunk = plan.creates.slice(i, i + INSERT_CHUNK);
      const inserted = await tx
        .insert(assetPoints)
        .values(chunk.map((create) => ({ assetId: create.assetId, organizationId, pointKey: create.pointKey, ...writeColumns(create) })))
        .returning({ id: assetPoints.id, assetId: assetPoints.assetId, pointKey: assetPoints.pointKey });
      for (const row of inserted) {
        createdIds.set(assetPointKey(row.assetId, row.pointKey), row.id);
      }
    }

    // The audit trail: one row per written point, the single-row routes' own
    // actions, through the batching `writeMany` (Q-G). Folded into this
    // transaction so the stamped organizationId matches the GUC `0048`'s strict
    // WITH CHECK reads, and so a rollback takes the audit rows with it.
    const auditRows: AuditInput[] = [
      ...plan.creates.map((create) => ({
        actor: jwt,
        action: "master.asset_point.create",
        entityType: "asset_point",
        entityId: createdIds.get(assetPointKey(create.assetId, create.pointKey)) ?? null,
        organizationId,
        payload: {
          sheetRow: create.row,
          assetCode: create.assetCode,
          pointKey: create.pointKey,
          rtuId: create.rtuId,
          sourceKind: create.sourceKind,
          sourceDataKey: create.sourceDataKey,
          unit: create.unit,
          ...create.metadata,
          active: create.active,
        },
      })),
      ...plan.updates.map((update) => ({
        actor: jwt,
        action: "master.asset_point.update",
        entityType: "asset_point",
        entityId: update.assetPointId,
        organizationId,
        payload: { sheetRow: update.row, assetCode: update.assetCode, pointKey: update.pointKey, changes: update.changes },
      })),
    ];
    await this.audit.writeMany(auditRows, tx);
  }
}

/** `parseMappingSheet`'s success rows, named once so the private helpers can state their shape. */
type ParsedRows = Extract<ReturnType<typeof parseMappingSheet>, { ok: true }>["rows"];

/** Rows per `INSERT` in phase 3 — `pg` binds one parameter per column per row and Postgres caps a statement at 65,535. */
const INSERT_CHUNK = 500;

/**
 * The placeholder a re-keyed row is parked on between phases 1 and 2. Unique per
 * row and per commit, 48 characters against `source_data_key`'s `varchar(128)`,
 * and prefixed so a row left behind by a crash mid-transaction — which cannot
 * happen, the transaction is atomic — would still be greppable.
 */
const SWAP_PLACEHOLDER_PREFIX = "__f27_swap_";

/**
 * The columns the sheet owns, as an UPDATE … SET or the tail of an INSERT.
 * `PlannedCreate` and `PlannedUpdate.write` carry the same full next state, so
 * both paths write every column rather than a diff — a partial update would
 * leave a cleared cell holding its old value.
 */
function writeColumns(planned: PlannedCreate | PlannedUpdate) {
  const write = "write" in planned ? planned.write : planned;
  return {
    rtuId: write.rtuId,
    sourceKind: write.sourceKind,
    sourceDataKey: write.sourceDataKey,
    unit: write.unit,
    scaleMultiplier: write.metadata.scaleMultiplier,
    scaleOffset: write.metadata.scaleOffset,
    engMin: write.metadata.engMin,
    engMax: write.metadata.engMax,
    qualityPolicy: write.metadata.qualityPolicy,
    active: write.active,
  };
}

/**
 * A location code as a filename part. `Content-Disposition` is a header, and a
 * code carrying a quote or a newline would end the filename and start something
 * else (§9.6) — so the export names itself from `[A-Za-z0-9._-]` only, and every
 * other character becomes `_`.
 */
function safeFilenamePart(code: string): string {
  const cleaned = code.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned === "" ? "location" : cleaned;
}
