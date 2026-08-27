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
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
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
 *
 * ## `E7.1b` — reads on `fleetDb`, the write inside `withTenant`
 *
 * `asset_points`, `assets` and `template_points` gain a `tenant_isolation`
 * policy + `FORCE` in `0047`. The three reads (asset, template points, the
 * existing row) precede any tenant context, so they run on `fleetDb` behind the
 * `canManageAsset` gate (Amendment 2/3). The `setOverride`/`clearOverride`
 * transaction becomes `withTenant(db, org, …)`, org derived from the asset — so
 * the eagerly-created row is stamped and passes the policy. The audit write
 * stays **inside** that transaction (as F2.6 designed it): atomic with the
 * mutation, and its `current_org` equals the actor's org so the actor row is
 * visible for `actorId` resolution.
 */
@Injectable()
export class AssetPointCalcOverrideService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // `E7.1b` — `asset_points`/`assets`/`template_points` gain a policy in 0047.
    // The three reads this service makes precede any tenant context, so they run
    // on `fleetDb` behind the `canManageAsset` gate (Amendment 2/3); only the
    // write transaction opens a `withTenant` GUC, on `db` (the tenant pool).
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
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

    const points = await this.fleetDb
      .select()
      .from(templatePoints)
      .where(and(eq(templatePoints.templateId, asset.templateId), eq(templatePoints.kind, "derived")))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));

    const rows = await this.fleetDb
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
    // error rather than a rolled-back insert. It is non-null exactly when this
    // call creates the row, which is what lets the insert below use it with no
    // fallback — a bare `pointKey` is not the `computed:` format that
    // `computed-source-data-key.ts` exists to keep single.
    let newSourceDataKey: string | null = null;
    if (ctx.existingRowId === null) {
      const formatted = computedSourceDataKey(pointKey);
      if (!formatted.ok) {
        throw new BadRequestException(
          `Point key "${pointKey}" is too long: its synthesised source_data_key would be ` +
            `${formatted.length} characters, over the column limit.`,
        );
      }
      newSourceDataKey = formatted.sourceDataKey;
    }

    await withTenant(this.db, ctx.organizationId, async (tx) => {
      let rowId = ctx.existingRowId;
      if (rowId !== null) {
        await tx.update(assetPoints).set(values).where(eq(assetPoints.id, rowId));
      } else {
        if (newSourceDataKey === null) {
          throw new Error(
            "setOverride: no source_data_key was prepared for a new asset_points row",
          );
        }
        // `resolveWritableContext` read the existing row *outside* this
        // transaction, and two other writers create the same
        // `(asset_id, point_key)`: `CalcWriteService` on the point's first
        // computed value, and a concurrent override call. Either can land in
        // that window, and `asset_points_asset_id_point_key_unique` would turn
        // it into a raw 23505 — a 500 where an operator asked for an override.
        //
        // `setWhere` carries the refusal `resolveWritableContext` already
        // makes: a row that is not `computed` is telemetry wiring, so the
        // update is skipped, nothing comes back, and the 409 below says so.
        // Merging into it would attach a formula to ingest wiring.
        const [written] = await tx
          .insert(assetPoints)
          .values({
            assetId,
            organizationId: ctx.organizationId,
            pointKey,
            sourceDataKey: newSourceDataKey,
            sourceKind: "computed",
            rtuId: null,
            active: true,
            unit: null,
            ...values,
          })
          .onConflictDoUpdate({
            target: [assetPoints.assetId, assetPoints.pointKey],
            set: values,
            setWhere: eq(assetPoints.sourceKind, "computed"),
          })
          .returning({ id: assetPoints.id });
        if (!written) {
          throw new ConflictException(
            `Point "${pointKey}" on this asset gained an asset_points row that is not a ` +
              "computed point while this override was being applied. Nothing was written. " +
              "Remove the telemetry mapping first, or use a different point key.",
          );
        }
        rowId = written.id;
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

    await withTenant(this.db, ctx.organizationId, async (tx) => {
      // Read inside the transaction, before nulling. Decision 9 asks the audit
      // to record "the columns changed", and `CALC_COLUMNS` is the columns this
      // endpoint *can* change — usually a superset. Recording all five on a row
      // that only overrode the interval makes the audit say a formula was
      // removed when none was set, and it never records prior values, so
      // nothing downstream can tell the difference.
      const [before] = await tx
        .select()
        .from(assetPoints)
        .where(eq(assetPoints.id, rowId))
        .limit(1);
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
          payload: {
            assetId,
            pointKey,
            columns: before ? changedColumns(toFields(before)) : [],
          },
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
    organizationId: string;
    template: AssetPointCalcOverrideFields;
    declaredPointKeys: string[];
    existingRowId: string | null;
  }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const asset = await this.requireAsset(assetId);
    // The org drives the `withTenant` GUC the two writers open. Derived from the
    // asset (`asset_points.organization_id` is `asset_id → assets`, the `0046`
    // path); a NULL only survives on a pre-`0046` row, unresolvable for a write.
    if (!asset.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    const organizationId = asset.organizationId;
    if (!(await this.accessControl.canManageAsset(jwt, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    if (asset.templateId === null) {
      throw new BadRequestException(
        "This asset was created by hand and is pinned to no template version, so it has no " +
          "calc configuration to override.",
      );
    }

    const points = await this.fleetDb
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

    const [existing] = await this.fleetDb
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
      organizationId,
      template: toFields(point),
      // **Measured only**, matching `assetTemplatePointsBodySchema`'s
      // sibling-scoped rule: "a derived formula may only reference measured
      // points". This endpoint is a second author for the same engine, so it
      // must refuse what the first one refuses.
      //
      // Passing every declared key would let an override reference another
      // derived point, or itself. `CalcSchedulerService` stamps a fresh
      // wall-clock bucket on every tick, so `ON CONFLICT DO NOTHING` never
      // dedupes a self-referential series: `{SELF} * 2` compounds each
      // interval until it is non-finite, and `{M} + {SELF}` accumulates
      // without bound. It also breaks the invariant `getInputKeys()` rests on
      // (ADR 0037 decision 11) — a derived point is never a formula input.
      //
      // The overridden point is excluded by construction: the check above
      // already established that it is `derived`.
      declaredPointKeys: points.filter((p) => p.kind === "measured").map((p) => p.pointKey),
      existingRowId: existing?.id ?? null,
    };
  }

  private async requireAsset(
    assetId: string,
  ): Promise<{ id: string; templateId: string | null; organizationId: string | null }> {
    const [asset] = await this.fleetDb
      .select({
        id: assets.id,
        templateId: assets.templateId,
        organizationId: assets.organizationId,
      })
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
