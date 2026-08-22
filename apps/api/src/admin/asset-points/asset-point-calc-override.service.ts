import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { assetPoints, assets, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AssetPointCalcConfigDto,
  AssetPointCalcConfigListResponse,
  AssetPointCalcOverrideFields,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { computedSourceDataKey } from "../../calc/computed-source-data-key";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  validateMergedCalcOverride,
  type AssetPointCalcOverrideBody,
} from "./asset-point-calc-override.schema";

/**
 * `F2.6` — per-asset calc overrides (ADR 0039 decisions 6, 7 and 8).
 *
 * Separate from `AssetPointsAdminService`, which is about telemetry *mapping*:
 * which source key feeds which point key, and whether that wiring is active.
 * This is calc *configuration*. They happen to share a table, and mixing them
 * would put two subjects in one file — the same reason
 * `AssetTemplateInstantiationService` was split out of the templates service.
 *
 * ## Keyed on `(assetId, pointKey)`, never on `asset_points.id`
 *
 * The row usually does not exist yet. Instantiation emits none for a derived
 * point (`F2.2`, untouched by this ADR), and `CalcWriteService` only creates
 * one on the first computed value. Decision 7 makes the override a *second*
 * creator, eagerly — because waiting for a first value is circular when the
 * override may be the very thing that lets a value be produced.
 *
 * ## What this refuses
 *
 * - A point key the pinned version does not declare, or declares as
 *   `measured`. `kind` is never overridable: `asset_points` for a measured
 *   point is physical wiring `apps/ingest` writes into, and letting a formula
 *   take it over would corrupt real telemetry.
 * - An existing `asset_points` row whose `source_kind` is not `computed`. That
 *   row belongs to a mapping, and attaching calc configuration to it would
 *   silently make an ingest-fed point also formula-fed. It is also the
 *   invariant `asset-point-calc-columns.integration.spec.ts` asserts of the
 *   whole estate.
 * - A merged configuration the engine could not run — D-1, in
 *   `validateMergedCalcOverride`.
 */
@Injectable()
export class AssetPointCalcOverrideService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Decision 8 — every derived point of one asset: template, override, effective. */
  async listCalcPoints(
    jwt: JwtPayload,
    assetId: string,
  ): Promise<AssetPointCalcConfigListResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const asset = await this.requireAsset(assetId);
    if (!(await this.accessControl.canManageAsset(jwt, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    if (asset.templateId === null) {
      // A hand-created asset has no template to inherit from. An empty list is
      // the honest answer, not an error: nothing is wrong with the asset.
      return { items: [] };
    }

    const points = await this.db
      .select()
      .from(templatePoints)
      .where(and(eq(templatePoints.templateId, asset.templateId), eq(templatePoints.kind, "derived")))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));

    const rows = await this.db
      .select()
      .from(assetPoints)
      .where(eq(assetPoints.assetId, assetId));
    const rowByKey = new Map(rows.map((row) => [row.pointKey, row]));

    const items: AssetPointCalcConfigDto[] = points.map((point) => {
      const row = rowByKey.get(point.pointKey);
      const template = toFields(point);
      const override = row ? toFields(row) : EMPTY_FIELDS;
      return {
        pointKey: point.pointKey,
        templatePointId: point.id,
        label: point.label,
        unit: point.unit,
        assetPointId: row?.id ?? null,
        template,
        override,
        effective: mergeFields(override, template),
      };
    });

    return { items };
  }

  /**
   * Decision 7 — set the override, creating the `asset_points` row eagerly.
   *
   * The row is created with `source_kind = 'computed'`, `rtu_id` NULL and the
   * synthesised `computed:<pointKey>` source key `CalcWriteService` also
   * invents — one shared format function, so the two creators cannot drift
   * (`U4`). `asset_points_source_ref_check` accepts that combination.
   */
  async setOverride(
    jwt: JwtPayload,
    assetId: string,
    pointKey: string,
    body: AssetPointCalcOverrideBody,
  ): Promise<AssetPointCalcConfigDto> {
    const ctx = await this.resolveWritableContext(jwt, assetId, pointKey);

    // An all-null body says "override nothing", which is what DELETE means.
    // Accepting it would create a row that overrides nothing and write an audit
    // row saying a set happened while naming no column — decision 9's payload
    // carries "the columns changed", and an empty list is not an answer.
    if (changedColumns(body).length === 0) {
      throw new BadRequestException(
        "This override sets no column: every field is null, and null means \"inherit\". " +
          "To remove an existing override use DELETE on this same path.",
      );
    }

    const problems = validateMergedCalcOverride(body, ctx.template, ctx.declaredPointKeys);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(" "));
    }

    const values = {
      formula: body.formula,
      formulaDialect: body.formulaDialect,
      calcTrigger: body.calcTrigger,
      calcIntervalSeconds: body.calcIntervalSeconds,
      maxInputAgeSeconds: body.maxInputAgeSeconds,
    };

    // Q-A of this unit: the synthesised key is checked before the transaction,
    // like every other fallible decision, so an over-long point key is a named
    // error rather than a rolled-back insert.
    const formatted = computedSourceDataKey(pointKey);
    if (ctx.existingRowId === null && !formatted.ok) {
      throw new BadRequestException(
        `Point key "${pointKey}" is too long: its synthesised source_data_key would be ` +
          `${formatted.length} characters, over the column limit.`,
      );
    }

    await this.db.transaction(async (tx) => {
      let rowId = ctx.existingRowId;
      if (rowId !== null) {
        await tx.update(assetPoints).set(values).where(eq(assetPoints.id, rowId));
      } else {
        const [created] = await tx
          .insert(assetPoints)
          .values({
            assetId,
            pointKey,
            sourceDataKey: formatted.ok ? formatted.sourceDataKey : pointKey,
            sourceKind: "computed",
            rtuId: null,
            active: true,
            unit: null,
            ...values,
          })
          .returning({ id: assetPoints.id });
        rowId = created.id;
      }

      // The open `tx` — `MasterDataAuditService.write`'s docblock requires it
      // inside a transaction, and it makes the audit row atomic with the write.
      // `entityId` is the row id, resolved *after* the insert: a create would
      // otherwise audit `null` and the entity index would not find it.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.override_set",
          entityType: "asset_point",
          entityId: rowId,
          payload: { assetId, pointKey, columns: changedColumns(values) },
        },
        tx,
      );
    });

    return this.readOne(jwt, assetId, pointKey);
  }

  /**
   * Clears every column back to "inherit". **Does not delete the row.**
   *
   * The row may be the one `CalcWriteService` needs for its next value, and
   * deleting it would also throw away `active` and any `unit` a later feature
   * sets. "No override" is five NULLs, which is exactly what the column means.
   */
  async clearOverride(
    jwt: JwtPayload,
    assetId: string,
    pointKey: string,
  ): Promise<AssetPointCalcConfigDto> {
    const ctx = await this.resolveWritableContext(jwt, assetId, pointKey);
    const rowId = ctx.existingRowId;
    if (rowId === null) {
      throw new NotFoundException(
        `Point "${pointKey}" on this asset has no override to clear.`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(assetPoints)
        .set({
          formula: null,
          formulaDialect: null,
          calcTrigger: null,
          calcIntervalSeconds: null,
          maxInputAgeSeconds: null,
        })
        .where(eq(assetPoints.id, rowId));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.override_clear",
          entityType: "asset_point",
          entityId: rowId,
          payload: { assetId, pointKey, columns: CALC_COLUMNS },
        },
        tx,
      );
    });

    return this.readOne(jwt, assetId, pointKey);
  }

  // -------------------------------------------------------------------------

  /**
   * Access, the pinned version's declaration of this point, and the existing
   * row — every fallible decision, before anything is written.
   */
  private async resolveWritableContext(
    jwt: JwtPayload,
    assetId: string,
    pointKey: string,
  ): Promise<{
    template: AssetPointCalcOverrideFields;
    declaredPointKeys: string[];
    existingRowId: string | null;
  }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const asset = await this.requireAsset(assetId);
    if (!(await this.accessControl.canManageAsset(jwt, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    if (asset.templateId === null) {
      throw new BadRequestException(
        "This asset was created by hand and is pinned to no template version, so it has no " +
          "calc configuration to override.",
      );
    }

    const points = await this.db
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, asset.templateId));
    const point = points.find((p) => p.pointKey === pointKey);
    if (!point) {
      throw new NotFoundException(
        `The template version this asset is pinned to does not declare point "${pointKey}".`,
      );
    }
    if (point.kind !== "derived") {
      throw new ConflictException(
        `Point "${pointKey}" is a measured point. Only a derived point has calc configuration ` +
          "to override — a measured point's asset_points row is telemetry wiring that ingest " +
          "writes into, and a formula must never take it over.",
      );
    }

    const [existing] = await this.db
      .select({ id: assetPoints.id, sourceKind: assetPoints.sourceKind })
      .from(assetPoints)
      .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.pointKey, pointKey)))
      .limit(1);

    if (existing && existing.sourceKind !== "computed") {
      throw new ConflictException(
        `Point "${pointKey}" on this asset already has an asset_points row with ` +
          `source_kind "${existing.sourceKind}", which belongs to a telemetry mapping. ` +
          "Attaching calc configuration to it would make one point both ingest-fed and " +
          "formula-fed. Remove the mapping first, or use a different point key.",
      );
    }

    return {
      template: toFields(point),
      declaredPointKeys: points.map((p) => p.pointKey),
      existingRowId: existing?.id ?? null,
    };
  }

  private async requireAsset(assetId: string): Promise<{ id: string; templateId: string | null }> {
    const [asset] = await this.db
      .select({ id: assets.id, templateId: assets.templateId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    return asset;
  }

  /** Re-reads through `listCalcPoints` so a write returns exactly what a read would. */
  private async readOne(
    jwt: JwtPayload,
    assetId: string,
    pointKey: string,
  ): Promise<AssetPointCalcConfigDto> {
    const list = await this.listCalcPoints(jwt, assetId);
    const item = list.items.find((entry) => entry.pointKey === pointKey);
    if (!item) {
      throw new Error(`override: point ${pointKey} vanished from asset ${assetId} after a write`);
    }
    return item;
  }
}

// --- shared shaping ---------------------------------------------------------

const CALC_COLUMNS = [
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
] as const;

const EMPTY_FIELDS: AssetPointCalcOverrideFields = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

/** Reads the five calc columns off either table — they are named identically. */
function toFields(row: {
  formula: string | null;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
}): AssetPointCalcOverrideFields {
  return {
    formula: row.formula,
    // The DTO narrows these to their vocabularies. A stored row predating a
    // vocabulary is carried through rather than coerced — the read reports what
    // is stored, and `toActiveDefinition` is what decides an unusable row is a
    // counted skip.
    formulaDialect: row.formulaDialect as AssetPointCalcOverrideFields["formulaDialect"],
    calcTrigger: row.calcTrigger as AssetPointCalcOverrideFields["calcTrigger"],
    calcIntervalSeconds: row.calcIntervalSeconds,
    maxInputAgeSeconds: row.maxInputAgeSeconds,
  };
}

/**
 * The same `coalesce(override, template)` per column that
 * `CalcDefinitionsService`'s SQL performs.
 *
 * Restated here in TypeScript on purpose, and it is the one duplication in this
 * feature worth having: the UI must show the operator what the engine will
 * actually use, and reading it back through the loader's 60-second cache would
 * show a value up to a minute stale — right after the write that changed it,
 * which is the worst possible moment.
 */
function mergeFields(
  override: AssetPointCalcOverrideFields,
  template: AssetPointCalcOverrideFields,
): AssetPointCalcOverrideFields {
  return {
    formula: override.formula ?? template.formula,
    formulaDialect: override.formulaDialect ?? template.formulaDialect,
    calcTrigger: override.calcTrigger ?? template.calcTrigger,
    calcIntervalSeconds: override.calcIntervalSeconds ?? template.calcIntervalSeconds,
    maxInputAgeSeconds: override.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
  };
}

/** Which columns this request actually sets — the audit payload's `columns`. */
function changedColumns(values: AssetPointCalcOverrideFields): string[] {
  return CALC_COLUMNS.filter((column) => values[column] !== null);
}
