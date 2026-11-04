import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, dashboardWidgetPoints, pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { isCrossAssetDialect, parseFormula, validateMergedCalcOverride } from "@bms/shared";
import type {
  AssetPointCalcConfigDto,
  AssetPointCalcConfigListResponse,
  CalcCrossRef,
  CalcPointBatchBody,
  CalcPointBatchResponse,
  CalcPointRefusal,
  CalcPointSetBody,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveActorId } from "../../auth/identity-resolver";
import { CalcDependencyService, type CalcCandidate } from "../../calc/calc-dependency.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { CalcStatusRegistry } from "../../calc/calc-status.registry";
import { computedSourceDataKey } from "../../calc/computed-source-data-key";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { unknownParameterKeysMessage } from "../asset-templates/asset-templates-param-refs";
import { MasterDataAuditService, type AuditInput } from "../master-data-audit.service";
import { changedColumns, dependencyCycleMessage, EMPTY_FIELDS, toFields } from "./asset-point-calc-override.service";
import { CalcBackfillRequestService, type BackfillTarget } from "./calc-backfill-request.service";
import {
  echoedAssetCode,
  mappingRowConflictMessage,
  sourceDataKeyTooLongMessage,
  unresolvedQualifiedCodesMessage,
} from "./calc-point-messages";
import { resolveCatalogPointKey } from "./resolve-catalog-point-key";

/** The asset columns every rule reads. */
type AssetRow = {
  id: string;
  code: string;
  templateId: string | null;
  organizationId: string | null;
};

/** A named refusal: the HTTP status it answers with, and the sentence. */
type Refusal = { readonly status: 400 | 403 | 409; readonly reason: string };

/** Everything a write needs, decided before any write. */
type Prepared = {
  readonly assetId: string;
  readonly assetCode: string;
  readonly organizationId: string;
  readonly pointKey: string;
  readonly unit: string | null;
  readonly existingRowId: string | null;
  /** Non-null exactly when this write creates the row. */
  readonly newSourceDataKey: string | null;
  readonly values: {
    formula: string;
    formulaDialect: CalcPointSetBody["formulaDialect"];
    calcTrigger: CalcPointSetBody["calcTrigger"];
    calcIntervalSeconds: number | null;
    maxInputAgeSeconds: number;
  };
  /** The graph candidate for rule 7, or `null` for a dialect that draws no edge to a derived point. */
  readonly candidate: CalcCandidate | null;
};

/** The calc fields of a body, without `backfillDays` (PR 5's) or the batch's own fields. */
function calcValues(body: CalcPointSetBody): Prepared["values"] {
  return {
    formula: body.formula,
    formulaDialect: body.formulaDialect,
    calcTrigger: body.calcTrigger,
    calcIntervalSeconds: body.calcIntervalSeconds,
    maxInputAgeSeconds: body.maxInputAgeSeconds,
  };
}

function toHttp(refusal: Refusal): HttpException {
  if (refusal.status === 403) return new ForbiddenException(refusal.reason);
  if (refusal.status === 409) return new ConflictException(refusal.reason);
  return new BadRequestException(refusal.reason);
}

/** The batch's one refusal for an asset the caller may not see — missing or out of scope alike. */
const NOT_FOUND_OR_OUT_OF_SCOPE = "Asset not found or outside your access scope";

const NOT_STANDALONE =
  "This asset is pinned to a template version, so its calculated points are overrides of " +
  "that version's derived points — set them through the override, not as a standalone point.";

/**
 * `F4.311` / ADR 0109 decision 3 — **the one write-rules service** for a
 * standalone calculated point: an `asset_points` row with `source_kind =
 * 'computed'` on an asset whose `template_id` is NULL. The `PUT` and `DELETE`
 * the override controller dispatches here, the batch route, and (PR 3) the
 * copilot's three entries all reach these methods, so the surfaces cannot
 * differ.
 *
 * ## The rules, in order, each a named refusal (`validate`)
 *
 * 1. the key is an active `bms.point_keys` code (ruling 3) — 400;
 * 2. an existing row on the key that is not `computed` is telemetry wiring —
 *    409, the override path's sentence verbatim;
 * 3. `validateMergedCalcOverride` against an all-null template, labelled
 *    `"this asset"` — 400;
 * 4. every `$parameter` key is in the vocabulary (ADR 0070 decision 4) — 400;
 * 5. every qualified code resolves at this asset's location (`F2.22` item 9) — 400;
 * 6. every asset the formula names is in the author's write scope and this
 *    asset's organization (ruling 5) — 403, naming the **codes** only;
 * 7. no dependency cycle (`CalcDependencyService`) — 400, the override path's
 *    sentence. Run by the caller over every candidate at once, so a batch
 *    costs one fleet-wide read.
 *
 * ## Reads on `fleetDb`, writes inside `withTenant`
 *
 * The same split as `AssetPointCalcOverrideService` (`E7.1b`): every read
 * precedes any tenant context and stands behind `canManageAsset`; the write
 * and its audit row share one `withTenant` transaction on the tenant pool.
 * Audit payloads name columns, never formula text (§9.6).
 *
 * ## `backfillDays` (PR 5, owner ruling 4)
 *
 * The point write commits first; the backfill runs are created after it by
 * `CalcBackfillRequestService`. A point whose backfill is already running
 * keeps the formula just written and answers 409 for the new backfill only;
 * no reachable worker answers 503 with the point still written.
 */
@Injectable()
export class CalcPointStandaloneService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly dependencies: CalcDependencyService,
    private readonly calcParameters: CalcParametersService,
    private readonly scope: CalcScopeService,
    private readonly status: CalcStatusRegistry,
    private readonly backfill: CalcBackfillRequestService,
  ) {}

  /**
   * Which service owns this asset's calc points: `standalone` when it has no
   * template (ADR 0109 decision 4), `template` otherwise. The controller
   * dispatches on it.
   */
  async kindOf(
    jwt: JwtPayload,
    assetId: string,
  ): Promise<{ kind: "standalone" | "template"; organizationId: string }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const asset = await this.requireAsset(assetId);
    if (!asset.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    return { kind: asset.templateId === null ? "standalone" : "template", organizationId: asset.organizationId };
  }

  /** Every standalone calculated point of one template-less asset. */
  async list(jwt: JwtPayload, assetId: string): Promise<AssetPointCalcConfigListResponse> {
    await this.requireWritableStandalone(jwt, assetId);
    return { items: await this.readItems(assetId), mode: "standalone" };
  }

  /** Creates or replaces one standalone point. All five calc fields are required (decision 1). */
  async set(
    jwt: JwtPayload,
    assetId: string,
    pointKey: string,
    body: CalcPointSetBody,
  ): Promise<AssetPointCalcConfigDto> {
    const asset = await this.requireWritableStandalone(jwt, assetId);
    const result = await this.validate(jwt, asset, pointKey, body);
    if (!result.ok) {
      throw toHttp(result.refusal);
    }
    const prepared = result.prepared;
    if (prepared.candidate !== null) {
      // The candidate's own pair is declared: a template-less asset has no
      // template and (on create) no row, so without it `K = sum({K} @site)`
      // would not see itself, be written, and skip as a cycle forever.
      const [cycle] = await this.dependencies.checkCandidates([prepared.candidate], {
        extraDeclared: [{ assetId: prepared.assetId, pointKey: prepared.pointKey }],
      });
      if (cycle && cycle.length > 0) {
        throw new BadRequestException(dependencyCycleMessage(cycle));
      }
    }

    const rowId = await withTenant(this.db, prepared.organizationId, async (tx) => {
      const written = await this.writeRow(tx, prepared);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.calc_point_set",
          entityType: "asset_point",
          entityId: written,
          organizationId: prepared.organizationId,
          payload: {
            assetId,
            pointKey,
            columns: changedColumns(prepared.values),
            created: prepared.existingRowId === null,
          },
        },
        tx,
      );
      return written;
    });

    // Ruling 4: after the write's commit, so a refused backfill never undoes it.
    await this.startBackfill(jwt, prepared.organizationId, body.backfillDays, [{ assetPointId: rowId, label: pointKey }]);
    return this.readOne(assetId, pointKey);
  }

  /**
   * Removes the row (decision 4): the point stops computing; its stored
   * telemetry stays. Refused (409) while a dashboard widget shows the point.
   */
  async remove(jwt: JwtPayload, assetId: string, pointKey: string): Promise<AssetPointCalcConfigDto> {
    const asset = await this.requireWritableStandalone(jwt, assetId);
    const organizationId = asset.organizationId as string;
    const before = (await this.readItems(assetId)).find((item) => item.pointKey === pointKey);
    if (!before || before.assetPointId === null) {
      throw new NotFoundException(`Point "${pointKey}" on this asset is not a calculated point.`);
    }
    const rowId = before.assetPointId;

    await withTenant(this.db, organizationId, async (tx) => {
      // `dashboard_widget_points.point_id` cascades ON DELETE, so a delete
      // here would silently empty every widget that shows the point. Refuse
      // instead (no write, no audit row); the operator unbinds it first.
      const [bound] = await tx
        .select({ widgets: count() })
        .from(dashboardWidgetPoints)
        .where(eq(dashboardWidgetPoints.pointId, rowId));
      const widgets = Number(bound?.widgets ?? 0);
      if (widgets > 0) {
        throw new ConflictException(widgetBoundMessage(widgets));
      }
      const deleted = await tx
        .delete(assetPoints)
        .where(and(eq(assetPoints.id, rowId), eq(assetPoints.sourceKind, "computed")))
        .returning({ id: assetPoints.id });
      if (deleted.length === 0) {
        throw new NotFoundException(`Point "${pointKey}" on this asset is not a calculated point.`);
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.calc_point_delete",
          entityType: "asset_point",
          entityId: rowId,
          organizationId,
          payload: { assetId, pointKey },
        },
        tx,
      );
    });

    return before;
  }

  /**
   * `POST /admin/calc-points/batch` — all or nothing (decision 4, ruling 4).
   * Every asset is checked and **every** refusal collected before anything is
   * written; one refusal writes nothing and the 400 names every refused asset.
   * Rule 7 runs once, over every candidate (`checkCandidates`).
   */
  async setBatch(jwt: JwtPayload, body: CalcPointBatchBody): Promise<CalcPointBatchResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const rows = await this.fleetDb
      .select({ id: assets.id, code: assets.code, templateId: assets.templateId, organizationId: assets.organizationId })
      .from(assets)
      .where(inArray(assets.id, [...body.assetIds]));
    const byId = new Map(rows.map((row) => [row.id, row]));

    const refused: CalcPointRefusal[] = [];
    const prepared: Prepared[] = [];
    const seen = new Set<string>();
    let batchOrganization: string | null = null;
    const setBody = { ...calcValues(body), backfillDays: body.backfillDays };

    for (const assetId of body.assetIds) {
      const asset = byId.get(assetId);
      // Missing or out of scope: one sentence and no code for both, so a typed
      // id never reveals whether an asset exists outside the caller's scope.
      if (!asset || !(await this.accessControl.canManageAsset(jwt, assetId))) {
        refused.push({ assetId, assetCode: null, reason: NOT_FOUND_OR_OUT_OF_SCOPE });
        continue;
      }
      if (seen.has(assetId)) {
        refused.push({ assetId, assetCode: asset.code, reason: "This asset is listed more than once." });
        continue;
      }
      seen.add(assetId);
      if (!asset.organizationId) {
        refused.push({ assetId, assetCode: asset.code, reason: "Asset has no organization; run the 0046 backfill" });
        continue;
      }
      batchOrganization ??= asset.organizationId;
      if (asset.organizationId !== batchOrganization) {
        refused.push({
          assetId,
          assetCode: asset.code,
          reason: "A batch writes one organization's assets; this asset is in a different one.",
        });
        continue;
      }
      if (asset.templateId !== null) {
        refused.push({ assetId, assetCode: asset.code, reason: NOT_STANDALONE });
        continue;
      }
      const result = await this.validate(jwt, asset, body.pointKey, setBody);
      if (!result.ok) {
        refused.push({ assetId, assetCode: asset.code, reason: result.refusal.reason });
        continue;
      }
      prepared.push(result.prepared);
    }

    // Rule 7, once for the batch. Each candidate is checked against the
    // stored estate plus itself (`checkCandidates`' per-candidate graph).
    const withCandidate = prepared.filter((entry) => entry.candidate !== null);
    // Every candidate's pair is declared, so siblings at one site are members
    // of each other's aggregate, as they will be once the batch is written.
    const cycles = await this.dependencies.checkCandidates(
      withCandidate.map((entry) => entry.candidate as CalcCandidate),
      { extraDeclared: withCandidate.map((entry) => ({ assetId: entry.assetId, pointKey: entry.pointKey })) },
    );
    withCandidate.forEach((entry, index) => {
      const cycle = cycles[index];
      if (cycle && cycle.length > 0) {
        refused.push({ assetId: entry.assetId, assetCode: entry.assetCode, reason: dependencyCycleMessage(cycle) });
      }
    });

    if (refused.length > 0) {
      // Request order, so the operator reads the refusals against the list they sent.
      const order = new Map(body.assetIds.map((id, index) => [id, index]));
      refused.sort((a, b) => (order.get(a.assetId) ?? 0) - (order.get(b.assetId) ?? 0));
      throw new BadRequestException({
        message: `Nothing was written: ${refused.length} of ${body.assetIds.length} asset(s) were refused.`,
        refused,
      });
    }

    const organizationId = batchOrganization as string;
    const targets: BackfillTarget[] = [];
    await withTenant(this.db, organizationId, async (tx) => {
      const audits: AuditInput[] = [];
      for (const entry of prepared) {
        const rowId = await this.writeRow(tx, entry);
        targets.push({ assetPointId: rowId, label: entry.assetCode });
        audits.push({
          actor: jwt,
          action: "master.asset_point.calc_point_batch",
          entityType: "asset_point",
          entityId: rowId,
          organizationId,
          payload: {
            assetId: entry.assetId,
            pointKey: entry.pointKey,
            columns: changedColumns(entry.values),
            created: entry.existingRowId === null,
            batchSize: prepared.length,
          },
        });
      }
      await this.audit.writeMany(audits, tx);
    });

    // Ruling 4: every point is written; a point whose backfill is running is
    // named in the 409, and the others' runs are started.
    await this.startBackfill(jwt, organizationId, body.backfillDays, targets);
    const items: AssetPointCalcConfigDto[] = [];
    for (const entry of prepared) {
      items.push(await this.readOne(entry.assetId, entry.pointKey));
    }
    return { items };
  }

  // -------------------------------------------------------------------------

  /** One run per target when the body asked for a backfill; nothing otherwise. */
  private async startBackfill(
    jwt: JwtPayload,
    organizationId: string,
    days: number | undefined,
    targets: readonly BackfillTarget[],
  ): Promise<void> {
    if (days === undefined || targets.length === 0) {
      return;
    }
    const requestedBy = await resolveActorId(this.fleetDb, jwt);
    await this.backfill.start({ organizationId, requestedBy, days, targets });
  }

  /**
   * Rules 1–6 for one asset, in order, stopping at the first refusal. Rule 7
   * is the caller's (see the class docblock). Reads only; writes nothing.
   */
  private async validate(
    jwt: JwtPayload,
    asset: AssetRow,
    pointKey: string,
    body: CalcPointSetBody,
  ): Promise<{ ok: true; prepared: Prepared } | { ok: false; refusal: Refusal }> {
    const refuse = (status: Refusal["status"], reason: string) => ({ ok: false as const, refusal: { status, reason } });

    // Rule 1 — ruling 3: the key is a catalog code.
    const catalog = await resolveCatalogPointKey(this.fleetDb, asset.id, pointKey);
    if (!catalog.ok) {
      return refuse(400, catalog.reason);
    }

    // Rule 2 — an existing row that is telemetry wiring is never taken over.
    const rows = await this.readAssetRows(asset.id);
    const existing = rows.find((row) => row.pointKey === pointKey);
    if (existing && existing.sourceKind !== "computed") {
      return refuse(409, mappingRowConflictMessage(pointKey, existing.sourceKind));
    }

    // Rule 3 — the engine's rules, against an all-null template: there is
    // nothing to inherit, so the body is validated alone. `measured` is what a
    // `v1` formula may read (no other calculated point); `all` is every key on
    // the asset plus this one, for the cross-asset dialects (a self-reference
    // is rule 7's cycle, not a key-list refusal).
    const declared = {
      measured: rows.filter((row) => row.sourceKind !== "computed").map((row) => row.pointKey),
      all: [...new Set([...rows.map((row) => row.pointKey), pointKey])],
    };
    const values = calcValues(body);
    const problems = validateMergedCalcOverride(values, EMPTY_FIELDS, declared, {
      declaredBy: "this asset",
      inheritance: false,
    });
    if (problems.length > 0) {
      return refuse(400, problems.join(" "));
    }

    // Rules 4–6 read the parse. Rule 3 parsed the same formula under the same
    // dialect, so a failure here is a defect, refused rather than written.
    const parsed = parseFormula(values.formula, { dialect: values.formulaDialect });
    if (!parsed.ok) {
      return refuse(400, `The formula is not valid ${values.formulaDialect}.`);
    }

    // Rule 4 — ADR 0070 decision 4.
    if (parsed.paramRefs.length > 0) {
      const unknown = await this.calcParameters.unknownKeys(parsed.paramRefs);
      if (unknown.length > 0) {
        return refuse(400, unknownParameterKeysMessage(unknown));
      }
    }

    // Rule 5 — `F2.22` item 9: a code that resolves nowhere draws no edge.
    const unresolved = await this.dependencies.unresolvedQualifiedCodes(asset.id, parsed.crossRefs);
    if (unresolved.length > 0) {
      return refuse(400, unresolvedQualifiedCodesMessage(unresolved, false));
    }

    // Rule 6 — ruling 5, its own guard.
    const outOfScope = await refuseOutOfScopeReferences(
      {
        resolveQualified: async (ownerId, crossRefs) =>
          (await this.scope.resolveMembership([{ assetId: ownerId, crossRefs: [...crossRefs] }])).qualified.get(ownerId),
        readAssets: (ids) =>
          this.fleetDb
            .select({ id: assets.id, organizationId: assets.organizationId })
            .from(assets)
            .where(inArray(assets.id, [...ids])),
        canManageAsset: (id) => this.accessControl.canManageAsset(jwt, id),
      },
      { id: asset.id, organizationId: asset.organizationId as string },
      parsed.crossRefs,
    );
    if (outOfScope !== null) {
      return refuse(403, outOfScope);
    }

    let newSourceDataKey: string | null = null;
    if (!existing) {
      const formatted = computedSourceDataKey(pointKey);
      if (!formatted.ok) {
        return refuse(400, sourceDataKeyTooLongMessage(pointKey, formatted.length));
      }
      newSourceDataKey = formatted.sourceDataKey;
    }

    return {
      ok: true,
      prepared: {
        assetId: asset.id,
        assetCode: asset.code,
        organizationId: asset.organizationId as string,
        pointKey,
        unit: catalog.unit,
        existingRowId: existing?.id ?? null,
        newSourceDataKey,
        values,
        // Rule 7's candidate. A `v1` formula reads measured points only (rule
        // 3), so it draws no edge to another calculated point and cannot close
        // a cycle — the override path makes the same call.
        candidate: isCrossAssetDialect(values.formulaDialect)
          ? {
              assetId: asset.id,
              pointKey,
              // The candidate id only feeds `defKey` on its own node; cycle
              // identity is `inputKey(assetId, pointKey)`.
              templatePointId: existing?.id ?? `standalone:${asset.id}:${pointKey}`,
              dialect: values.formulaDialect,
              localRefs: parsed.refs,
              crossRefs: parsed.crossRefs,
            }
          : null,
      },
    };
  }

  /**
   * One row, inside the caller's transaction. `setWhere` carries rule 2 into
   * the write: a row that turned into telemetry wiring after `validate` read
   * it is skipped, nothing comes back, and the 409 rolls the whole
   * transaction back (the batch's other rows included).
   */
  private async writeRow(tx: BmsTx, entry: Prepared): Promise<string> {
    const set = { ...entry.values, unit: entry.unit };
    if (entry.existingRowId !== null) {
      const [updated] = await tx
        .update(assetPoints)
        .set(set)
        .where(and(eq(assetPoints.id, entry.existingRowId), eq(assetPoints.sourceKind, "computed")))
        .returning({ id: assetPoints.id });
      if (!updated) {
        throw new ConflictException(raceMessage(entry.pointKey));
      }
      return updated.id;
    }
    if (entry.newSourceDataKey === null) {
      throw new Error("calc point: no source_data_key was prepared for a new asset_points row");
    }
    const [written] = await tx
      .insert(assetPoints)
      .values({
        assetId: entry.assetId,
        organizationId: entry.organizationId,
        pointKey: entry.pointKey,
        sourceDataKey: entry.newSourceDataKey,
        sourceKind: "computed",
        rtuId: null,
        active: true,
        ...set,
      })
      .onConflictDoUpdate({
        target: [assetPoints.assetId, assetPoints.pointKey],
        set,
        setWhere: eq(assetPoints.sourceKind, "computed"),
      })
      .returning({ id: assetPoints.id });
    if (!written) {
      throw new ConflictException(raceMessage(entry.pointKey));
    }
    return written.id;
  }

  /** Access, existence, organization and kind — the gate every standalone method opens with. */
  private async requireWritableStandalone(jwt: JwtPayload, assetId: string): Promise<AssetRow> {
    await this.accessControl.requireMasterDataUser(jwt);
    const asset = await this.requireAsset(assetId);
    if (!asset.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    if (!(await this.accessControl.canManageAsset(jwt, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    if (asset.templateId !== null) {
      throw new BadRequestException(NOT_STANDALONE);
    }
    return asset;
  }

  private async requireAsset(assetId: string): Promise<AssetRow> {
    const [asset] = await this.fleetDb
      .select({ id: assets.id, code: assets.code, templateId: assets.templateId, organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    return asset;
  }

  /** Every `asset_points` row of the asset — the existing-row check and the declared keys. */
  private async readAssetRows(assetId: string): Promise<{ id: string; pointKey: string; sourceKind: string }[]> {
    return this.fleetDb
      .select({ id: assetPoints.id, pointKey: assetPoints.pointKey, sourceKind: assetPoints.sourceKind })
      .from(assetPoints)
      .where(eq(assetPoints.assetId, assetId));
  }

  /** The asset's computed rows as DTO items, `kind: "standalone"`. No access check: callers made it. */
  private async readItems(assetId: string): Promise<AssetPointCalcConfigDto[]> {
    const rows = await this.fleetDb
      .select({ row: assetPoints, label: pointKeys.name, catalogUnit: pointKeys.unit })
      .from(assetPoints)
      .leftJoin(pointKeys, eq(pointKeys.code, assetPoints.pointKey))
      .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.sourceKind, "computed")))
      .orderBy(asc(assetPoints.pointKey));
    const runs = await this.backfill.latestForPoints(rows.map(({ row }) => row.id));
    return rows.map(({ row, label, catalogUnit }) => {
      const fields = toFields(row);
      // The engine keys a standalone definition on its `asset_points.id` (ADR 0109 decision 2).
      const runtime = this.status.get(assetId, row.id);
      return {
        pointKey: row.pointKey,
        kind: "standalone",
        templatePointId: null,
        label: label ?? null,
        unit: row.unit ?? catalogUnit ?? null,
        assetPointId: row.id,
        template: EMPTY_FIELDS,
        override: fields,
        effective: fields,
        minCoverageRatio: null,
        runtime:
          runtime === null
            ? null
            : { lastOutcome: runtime.outcome, lastSkipReason: runtime.reason, at: new Date(runtime.atMs).toISOString() },
        backfill: runs.get(row.id) ?? null,
      };
    });
  }

  private async readOne(assetId: string, pointKey: string): Promise<AssetPointCalcConfigDto> {
    const item = (await this.readItems(assetId)).find((entry) => entry.pointKey === pointKey);
    if (!item) {
      throw new Error(`calc point: ${pointKey} vanished from asset ${assetId} after a write`);
    }
    return item;
  }
}

function widgetBoundMessage(widgets: number): string {
  return (
    `This calculated point is shown on ${widgets} dashboard widget(s). ` +
    "Remove it from those widgets first, then delete it."
  );
}

function raceMessage(pointKey: string): string {
  return (
    `Point "${pointKey}" on this asset gained an asset_points row that is not a computed point ` +
    "while this write was being applied. Nothing was written. Remove the telemetry mapping " +
    "first, or use a different point key."
  );
}

/** The reads rule 6 needs, injected so the guard is testable without a database. */
export type ScopeGuardDeps = {
  /** The owner's qualified codes → the asset each resolves to (`null` when none). */
  resolveQualified(
    ownerId: string,
    crossRefs: readonly CalcCrossRef[],
  ): Promise<ReadonlyMap<string, string | null> | undefined>;
  readAssets(ids: readonly string[]): Promise<{ id: string; organizationId: string | null }[]>;
  canManageAsset(assetId: string): Promise<boolean>;
};

/**
 * Rule 6 — ADR 0109 ruling 5: every asset a formula names is in the author's
 * write scope **and** the owner's organization. Returns the refusal sentence,
 * or `null` when every named asset passes.
 *
 * **Its own guard, failing closed.** Qualified codes resolve only at the
 * owner's location today (ADR 0055 decision 12), and `canManageAsset` is
 * `canManageLocation` on that location, so a resolved code is in scope by
 * construction. That is a property of today's resolver, not of this rule: a
 * later widening of decision 12 must not open the rule silently. So the
 * organization is compared on the resolved asset itself, and a resolved id
 * whose row cannot be read is refused.
 *
 * **The sentence names the codes the author typed, and nothing else** — never
 * an id, never which half failed (scope or organization), so it confirms
 * nothing about another tenant beyond the text already in the formula. An
 * unresolved code is rule 5's refusal first; if one reaches this guard anyway
 * (no answer for the owner, or a `null` resolution) it is refused here too —
 * the guard fails closed rather than passing what it could not check.
 */
export async function refuseOutOfScopeReferences(
  deps: ScopeGuardDeps,
  owner: { id: string; organizationId: string },
  crossRefs: readonly CalcCrossRef[],
): Promise<string | null> {
  const typedCodes: string[] = [];
  for (const ref of crossRefs) {
    if (ref.kind === "qref" && !typedCodes.includes(ref.assetCode)) {
      typedCodes.push(ref.assetCode);
    }
  }
  if (typedCodes.length === 0) {
    return null;
  }
  const resolved = await deps.resolveQualified(owner.id, crossRefs);
  // Fail closed: no answer for the owner, or no asset for a code, is not a
  // pass. Rule 5 normally refuses an unresolved code first; this guard does
  // not lean on that ordering.
  const refusedCodes: string[] = [];
  const codeById = new Map<string, string[]>();
  for (const code of typedCodes) {
    const id = resolved?.get(code) ?? null;
    if (id === null) {
      refusedCodes.push(code);
    } else {
      codeById.set(id, [...(codeById.get(id) ?? []), code]);
    }
  }
  const rows = codeById.size === 0 ? [] : await deps.readAssets([...codeById.keys()]);
  const orgById = new Map(rows.map((row) => [row.id, row.organizationId]));
  for (const [id, codes] of codeById) {
    const sameOrganization = orgById.has(id) && orgById.get(id) === owner.organizationId;
    if (!sameOrganization || !(await deps.canManageAsset(id))) {
      refusedCodes.push(...codes);
    }
  }
  if (refusedCodes.length === 0) {
    return null;
  }
  return (
    `This formula names asset code(s) outside your write scope or this asset's organization: ` +
    `${refusedCodes.map(echoedAssetCode).join(", ")}. A calculated point may read only assets you ` +
    "can manage, in this asset's organization (ADR 0109)."
  );
}
