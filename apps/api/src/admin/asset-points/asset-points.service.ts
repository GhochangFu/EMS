import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, locations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetPointDto, JwtPayload, PointMetadataFields, QualityPolicy } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  AssetPointBulkPatch,
  AssetPointBulkUpdateBody,
  CreateAssetPointBody,
  UpdateAssetPointBody,
} from "./asset-points.schema";
import {
  hasAnyPointMetadata,
  NO_POINT_METADATA,
  validateMergedPointMetadata,
  type PointMetadataBody,
} from "./point-metadata.schema";
import { resolveCatalogPointKey } from "./resolve-catalog-point-key";
import {
  loadTemplatePointDefaults,
  loadTemplatePointDefaultsForAssets,
} from "./template-point-defaults";

/**
 * `F4.16` / `E7.1b` / ADR 0043 — `asset_points` (and `assets`) gain
 * `organization_id` + a `tenant_isolation` policy + `FORCE` in migration `0047`.
 *
 * Reads run on `fleetDb`, trusting the `writableLocationIds`/`canManageAsset`
 * scope filter this service already applies before returning a row — the same
 * "bypass, then trust an already-computed grant" shape `AccessControlService`
 * uses (Amendment 2/3). Writes run inside `withTenant(tenantDb, organizationId,
 * …)`: `create` stamps the org derived from the asset (`asset_id → assets`, the
 * same path `0046` backfilled); `update`/`deactivate`/`reactivate` use the
 * point's own `organization_id`, read back on `fleetDb`. A point never changes
 * asset (`UpdateAssetPointBody` carries no `assetId`), so its org is fixed and
 * there is no cross-org move to guard.
 */
@Injectable()
export class AssetPointsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists asset point mappings scoped to writable locations. */
  async list(
    jwt: JwtPayload,
    assetId?: string,
    locationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminAssetPointDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (assetId) {
      if (!(await this.accessControl.canManageAsset(jwt, assetId))) {
        throw new ForbiddenException("Asset is outside your access scope");
      }
      conditions.push(eq(assetPoints.assetId, assetId));
    }
    if (locationId) {
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      conditions.push(eq(assets.locationId, locationId));
    } else if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(assets.locationId, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(assetPoints.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(assetPoints.active, false));
    }

    const rows = await this.fleetDb
      .select({
        point: assetPoints,
        assetCode: assets.code,
        assetName: assets.name,
        locationId: assets.locationId,
        locationName: locations.name,
      })
      .from(assetPoints)
      .innerJoin(assets, eq(assetPoints.assetId, assets.id))
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(assetPoints.pointKey));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Creates an asset point mapping in scope. */
  async create(
    jwt: JwtPayload,
    body: CreateAssetPointBody,
  ): Promise<AdminAssetPointDto> {
    if (!(await this.accessControl.canManageAsset(jwt, body.assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const catalog = await this.resolveCatalogPointKey(body.assetId, body.pointKey);

    // ADR 0018: provenance binds at the point. Inherit the asset's gateway —
    // a point mapped through this endpoint is fed by whatever feeds its asset.
    // With no gateway the honest record is `unmapped`, not `manual`: nobody
    // claimed this point is hand-entered, only that no source is known yet.
    //
    // fleetDb read (Amendment 2/3): `assets` gains a policy in 0047, and this
    // precedes any tenant context; the `canManageAsset` gate above is the
    // isolation control. The same read yields the org the new point is stamped
    // with — `asset_points.organization_id` is `asset_id → assets`, so it can
    // only be the asset's org.
    const [ownerAsset] = await this.fleetDb
      .select({
        organizationId: assets.organizationId,
        rtuId: assets.rtuId,
        locationId: assets.locationId,
      })
      .from(assets)
      .where(eq(assets.id, body.assetId))
      .limit(1);
    if (!ownerAsset) {
      throw new NotFoundException("Asset not found");
    }
    const organizationId = this.requireRowOrg(ownerAsset.organizationId);

    // `F2.7` / ADR 0056 — what the pinned template says about this key: whether
    // it is a derived point at all, and the metadata defaults this row's own
    // five will be resolved against.
    const template = (
      await loadTemplatePointDefaults(this.fleetDb, body.assetId, [body.pointKey])
    ).get(body.pointKey);
    if (template?.kind === "derived") {
      // The row a derived point needs is the calc-override surface's, which
      // creates it eagerly and stamps `source_kind = 'computed'` (ADR 0039
      // decision 7). Writing a telemetry mapping for the same key here would
      // take the one row `asset_points_asset_id_point_key_unique` allows, and
      // the override endpoint would then fail on a key its own template
      // declares — after this call had reported success.
      throw new ConflictException(
        `Point "${body.pointKey}" is a computed point on this asset's template: its ` +
          "asset_points row is calc configuration, written by the calc-override endpoint. " +
          "Set the override there rather than mapping the key to a telemetry source.",
      );
    }

    const problems = validateMergedPointMetadata(
      pointMetadataOf(body),
      template?.defaults ?? NO_POINT_METADATA,
    );
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(" "));
    }

    // ADR 0018: provenance binds at the point. `rtuId` on the body states the
    // gateway explicitly (ADR 0056 decision 3, so the single-row route can say
    // what the mapping sheet says); without one the point inherits the asset's
    // own gateway, and with neither the honest record is `unmapped`.
    const sourceRtuId = body.rtuId ?? ownerAsset.rtuId ?? null;

    const created = await withTenant(this.tenantDb, organizationId, async (tx) => {
      if (body.rtuId) {
        await this.assertRtuLocation(body.rtuId, ownerAsset.locationId, tx);
      }
      const [row] = await tx
        .insert(assetPoints)
        .values({
          assetId: body.assetId,
          organizationId,
          pointKey: body.pointKey,
          sourceDataKey: body.sourceDataKey,
          sensorCode: body.sensorCode ?? null,
          unit: body.unit ?? catalog.unit,
          active: true,
          rtuId: sourceRtuId,
          sourceKind: sourceRtuId ? "measured" : "unmapped",
          // ADR 0056 decision 1 — the per-asset override; `null` = inherit.
          scaleMultiplier: body.scaleMultiplier ?? null,
          scaleOffset: body.scaleOffset ?? null,
          engMin: body.engMin ?? null,
          engMax: body.engMax ?? null,
          qualityPolicy: body.qualityPolicy ?? null,
        })
        .returning();

      // E7.1c (item D): folded into this transaction so the stamped
      // organizationId matches the GUC the strict WITH CHECK now demands.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.create",
          entityType: "asset_point",
          entityId: row.id,
          organizationId,
          payload: body,
        },
        tx,
      );
      return row;
    });

    return this.fetchRow(created.id);
  }

  /** Updates an asset point mapping in scope. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateAssetPointBody,
  ): Promise<AdminAssetPointDto> {
    // fleetDb read (Amendment 2/3): `asset_points` gains a policy in 0047, and
    // this read precedes any tenant context; `canManageAsset` below is the
    // isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(assetPoints)
      .where(eq(assetPoints.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Asset point not found");
    }
    if (!(await this.accessControl.canManageAsset(jwt, existing.assetId))) {
      throw new ForbiddenException("Asset point is outside your access scope");
    }
    const organizationId = this.requireRowOrg(existing.organizationId);

    const nextPointKey = body.pointKey ?? existing.pointKey;
    if (nextPointKey !== existing.pointKey && existing.sourceKind === "computed") {
      // A `computed` row is calc configuration, not a telemetry mapping: it
      // carries the ADR 0039 override columns and its `source_data_key` is the
      // synthesised `computed:<pointKey>`. Re-keying it does one of two silent
      // things — the calc resolution join stops matching and the override goes
      // inert while still stored, or the key lands on another derived point and
      // the old formula override starts applying to a different measurement.
      // Both are the "wrong number, quietly" failure this surface exists to
      // avoid, so the key is fixed for the life of the row.
      throw new ConflictException(
        `Point "${existing.pointKey}" is a computed point: its asset_points row holds calc ` +
          "configuration rather than telemetry wiring, so its point key cannot be changed. " +
          "Clear the calc override to remove the row, then map the new key.",
      );
    }

    // `F2.7` / ADR 0056 decision 3's last sentence, and design decision 14's
    // last clause. A computed row has no instrument to scale or bound and no
    // gateway to wire — its value is produced from points that already carry
    // both. `rtuId` is refused on **presence**, `null` included: nothing
    // legitimately sends it here, so there is no round trip to protect, and
    // answering 200 to an unwiring of a row that was never wired would report
    // a change that did not happen. The five are refused only when *set*,
    // because a form that posts all five as `null` is clearing an override the
    // row does not have, which is a no-op rather than a mistake.
    if (existing.sourceKind === "computed" && (hasAnyPointMetadata(body) || body.rtuId !== undefined)) {
      throw new ConflictException(
        `Point "${existing.pointKey}" is a computed point: its asset_points row holds calc ` +
          "configuration rather than telemetry wiring, so it carries neither an instrument " +
          "to scale or bound nor a gateway to read. Set scale, range and quality on the " +
          "measured points its formula reads.",
      );
    }

    const catalog = await this.resolveCatalogPointKey(existing.assetId, nextPointKey);

    // ADR 0056 decision 2 — the merged pair, checked against what this request
    // leaves stored (`body.x !== undefined ? body.x : existing.x`) rather than
    // against the patch alone: `PATCH { engMin: 150 }` on a row that already
    // holds `eng_max = 60` is the same inverted band as one that inherits it.
    const nextMetadata = mergedPointMetadata(existing, body);
    const template = (
      await loadTemplatePointDefaults(this.fleetDb, existing.assetId, [nextPointKey])
    ).get(nextPointKey);
    if (nextPointKey !== existing.pointKey && template?.kind === "derived") {
      // The same refusal `create` gives (above): a re-key onto a key the pinned
      // template declares derived would park a `measured`/`unmapped` row, with
      // instrument metadata, on the one row `asset_points_asset_id_point_key_unique`
      // allows the calc-override surface — after answering 200. Found by the
      // PR 1 code review; the existing computed guards test the *row*'s kind,
      // not the *target key*'s.
      throw new ConflictException(
        `Point "${nextPointKey}" is a computed point on this asset's template: its ` +
          "asset_points row is calc configuration, written by the calc-override endpoint. " +
          "Set the override there rather than re-keying a telemetry mapping onto it.",
      );
    }

    const problems = validateMergedPointMetadata(nextMetadata, template?.defaults ?? NO_POINT_METADATA);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(" "));
    }

    await withTenant(this.tenantDb, organizationId, async (tx) => {
      const wiring = await this.resolveUpdatedWiring(existing, body, tx);
      await tx
        .update(assetPoints)
        .set({
          pointKey: nextPointKey,
          sourceDataKey: body.sourceDataKey ?? existing.sourceDataKey,
          sensorCode: body.sensorCode !== undefined ? body.sensorCode : existing.sensorCode,
          unit: body.unit !== undefined ? body.unit : (existing.unit ?? catalog.unit),
          rtuId: wiring.rtuId,
          sourceKind: wiring.sourceKind,
          // Only the metadata fields this request states are written. `nextMetadata`
          // above is the *resolved* row for the merged-pair check; writing all five
          // from it would restate values read before the transaction, and two
          // concurrent PATCHes on different fields would each undo the other's
          // (PR 1 security review, L1).
          ...statedPointMetadata(body),
        })
        .where(eq(assetPoints.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.update",
          entityType: "asset_point",
          entityId: id,
          organizationId,
          payload: body,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /**
   * `F2.7` / ADR 0056 decision 8 — one patch applied to a selection of asset
   * points, **all or nothing**.
   *
   * The sheet (decisions 6 and 7) is deliberately the opposite: a bad row there
   * is skipped and the rest land, because a 3,000-row workbook with two typos
   * is still 2,998 rows of work. A selection is not that. The person ticked
   * these rows on a screen and pressed one button, so "17 of your 20 were
   * applied" is a state they did not ask for and cannot see — every refusal
   * below therefore refuses the whole request and writes nothing.
   *
   * Order is load-bearing, and it is the order a caller can safely be told
   * things in:
   *
   * 1. the master-data role, then the caller's writable locations;
   * 2. read the rows on `fleetDb` (Amendment 2/3 — the scope filter below is
   *    the isolation control, and it needs the rows to filter);
   * 3. an id that names no row → 404, listing the ids;
   * 4. rows in more than one organization → 400. One `withTenant` transaction
   *    stamps one organization, so a mixed selection could only be written by
   *    opening two — and `0048`'s strict `WITH CHECK` would refuse the second
   *    half after the first was already written;
   * 5. any row outside the caller's writable locations → 403, **before** any
   *    decision about the rows' contents is reported;
   * 6. a `computed` row while the patch *sets* metadata → 409 (`update`'s rule,
   *    named per row);
   * 7. the merged band per row against that row's own template default → 400
   *    naming the row.
   *
   * Only then one transaction: a single `UPDATE … WHERE id IN (…)` — every row
   * takes the same values, so it is one statement, not one per row — and the
   * audit rows through `writeMany` (Q-G), inside it, so a rollback takes both.
   */
  async bulkUpdate(
    jwt: JwtPayload,
    body: AssetPointBulkUpdateBody,
  ): Promise<{ items: AdminAssetPointDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    // A repeated id is one row, and the audit trail must not record it twice.
    const ids = [...new Set(body.ids)];

    const rows = await this.fleetDb
      .select({ point: assetPoints, assetCode: assets.code, locationId: assets.locationId })
      .from(assetPoints)
      .innerJoin(assets, eq(assetPoints.assetId, assets.id))
      .where(inArray(assetPoints.id, ids));

    const found = new Set(rows.map((row) => row.point.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `${missing.length} of the selected asset points no longer exist: ${missing.join(", ")}`,
      );
    }

    const organizationIds = [...new Set(rows.map((row) => row.point.organizationId))];
    if (organizationIds.length > 1) {
      throw new BadRequestException(
        "The selection spans more than one organization. One bulk edit is written in one " +
          "organization's tenant context, so a mixed selection would write part of itself " +
          "and refuse the rest. Select rows from a single organization.",
      );
    }
    const organizationId = this.requireRowOrg(organizationIds[0] ?? null);

    // `null` is the global admin: every location. Otherwise every row's asset
    // must sit in a location this caller may manage — the same test
    // `canManageAsset` makes one row at a time, asked once for the selection.
    if (writableIds !== null) {
      const outside = rows.filter(
        (row) => !row.locationId || !writableIds.includes(row.locationId),
      );
      if (outside.length > 0) {
        throw new ForbiddenException(
          `${outside.length} of the ${rows.length} selected asset points are outside your ` +
            "access scope",
        );
      }
    }

    // `hasAnyPointMetadata` reads an explicit `null` as absent (correction 17),
    // and that is the right reading here too: clearing an override a computed
    // row never had is a no-op, while *setting* scale or a band on a row whose
    // value is produced by a formula is a request built on a misunderstanding.
    if (hasAnyPointMetadata(body.patch)) {
      const computed = rows.find((row) => row.point.sourceKind === "computed");
      if (computed) {
        throw new ConflictException(
          `Point "${computed.assetCode}/${computed.point.pointKey}" is a computed point: its ` +
            "asset_points row holds calc configuration rather than telemetry wiring, so it " +
            "carries no instrument to scale or bound. Remove it from the selection, or set " +
            "scale, range and quality on the measured points its formula reads.",
        );
      }
    }

    // One query for every selected row's template defaults, then the merged
    // pair per row. Run for every patch, including one that states only `unit`
    // or `active`: `update` checks the same way, and an all-or-nothing surface
    // must not write a row it would refuse one at a time.
    const templates = await loadTemplatePointDefaultsForAssets(
      this.fleetDb,
      rows.map((row) => row.point.assetId),
      rows.map((row) => row.point.pointKey),
    );
    for (const row of rows) {
      const template = templates.get(row.point.assetId)?.get(row.point.pointKey);
      const [problem] = validateMergedPointMetadata(
        mergedPointMetadata(row.point, body.patch),
        template?.defaults ?? NO_POINT_METADATA,
      );
      if (problem) {
        // The row is named, because "one of your 20 rows is wrong" is not a
        // message anyone can act on.
        throw new BadRequestException(`${row.assetCode}/${row.point.pointKey}: ${problem}`);
      }
    }

    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .update(assetPoints)
        .set(statedBulkColumns(body.patch))
        .where(inArray(assetPoints.id, ids));

      await this.audit.writeMany(
        rows.map((row) => ({
          actor: jwt,
          action: "master.asset_point.bulk_update",
          entityType: "asset_point",
          entityId: row.point.id,
          organizationId,
          // The patch, not the resolved row: what this actor asked for is what
          // the trail must say, and it is identical for every row in the batch.
          payload: { patch: body.patch },
        })),
        tx,
      );
    });

    return { items: await this.fetchRows(ids) };
  }

  /** Deactivates an asset point mapping. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminAssetPointDto> {
    // fleetDb read (Amendment 2/3): see `update`. The point's own org drives the
    // tenant context for the state flip.
    const [existing] = await this.fleetDb
      .select()
      .from(assetPoints)
      .where(eq(assetPoints.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Asset point not found");
    }
    if (!(await this.accessControl.canManageAsset(jwt, existing.assetId))) {
      throw new ForbiddenException("Asset point is outside your access scope");
    }
    const organizationId = this.requireRowOrg(existing.organizationId);

    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx.update(assetPoints).set({ active: false }).where(eq(assetPoints.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.deactivate",
          entityType: "asset_point",
          entityId: id,
          organizationId,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Reactivates an asset point mapping. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminAssetPointDto> {
    // fleetDb read (Amendment 2/3): see `update`. The point's own org drives the
    // tenant context for the state flip.
    const [existing] = await this.fleetDb
      .select()
      .from(assetPoints)
      .where(eq(assetPoints.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Asset point not found");
    }
    if (!(await this.accessControl.canManageAsset(jwt, existing.assetId))) {
      throw new ForbiddenException("Asset point is outside your access scope");
    }
    const organizationId = this.requireRowOrg(existing.organizationId);

    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx.update(assetPoints).set({ active: true }).where(eq(assetPoints.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_point.reactivate",
          entityType: "asset_point",
          entityId: id,
          organizationId,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /**
   * Wraps {@link resolveCatalogPointKey}, translating `ok:false` back into the
   * `BadRequestException` this method threw before the check was extracted for
   * `F1.9`'s reuse (ADR 0018) — same messages, so no existing caller's expected
   * error text changes.
   */
  private async resolveCatalogPointKey(
    assetId: string,
    pointKey: string,
  ): Promise<{ unit: string | null }> {
    const result = await resolveCatalogPointKey(this.fleetDb, assetId, pointKey);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return { unit: result.unit };
  }

  /**
   * The row's (or asset's) own organization, which every `asset_points` row
   * carries after the `0046` backfill. A NULL only survives on a pre-`0046` row
   * that dodged it; treat it as unresolvable rather than open `withTenant(null)`.
   */
  private requireRowOrg(organizationId: string | null): string {
    if (!organizationId) {
      throw new BadRequestException("Asset point has no organization; run the 0046 backfill");
    }
    return organizationId;
  }

  /**
   * The owner's Q-H ruling (2026-09-06), as three spellings of one field:
   * absent leaves the wiring alone, a uuid wires the point, `null` unwires it.
   *
   * The **kind follows**, and it has no choice: `asset_points_source_ref_check`
   * (ADR 0018) holds `measured` to a non-null `rtu_id` and every other kind to
   * a null one, so "keep the kind and drop the id" is not a row this database
   * will store. `manual` is the one kind unwiring leaves alone — a hand-entered
   * point was never read through a gateway, so removing one it does not have
   * must not silently reclassify it as an unmapped measurement.
   *
   * A `computed` row never reaches here: `update` refuses `rtuId` on it above.
   */
  private async resolveUpdatedWiring(
    existing: typeof assetPoints.$inferSelect,
    body: UpdateAssetPointBody,
    tx: BmsTx,
  ): Promise<{ rtuId: string | null; sourceKind: string }> {
    if (body.rtuId === undefined) {
      return { rtuId: existing.rtuId, sourceKind: existing.sourceKind };
    }
    if (body.rtuId === null) {
      return {
        rtuId: null,
        sourceKind: existing.sourceKind === "manual" ? "manual" : "unmapped",
      };
    }

    // Read inside the caller's tenant GUC, like the RTU read below: the asset
    // is in this point's organization by construction (`asset_points.organization_id`
    // is the asset's own), so the context sees it.
    const [asset] = await tx
      .select({ locationId: assets.locationId })
      .from(assets)
      .where(eq(assets.id, existing.assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    await this.assertRtuLocation(body.rtuId, asset.locationId, tx);
    return { rtuId: body.rtuId, sourceKind: "measured" };
  }

  /**
   * Asserts a gateway lives in the asset's own location — `assets.service.ts`'s
   * check, on the surface that now names an RTU as well.
   *
   * Read on `tx` and never on `fleetDb`: a valid gateway shares this location,
   * hence this organization, so the tenant context sees it, while an RTU of
   * another tenant reads as absent rather than as a cross-tenant oracle.
   * Without the check a uuid would wire a point to a gateway on another site —
   * a mapping that looks complete and delivers nothing.
   */
  private async assertRtuLocation(rtuId: string, locationId: string, tx: BmsTx): Promise<void> {
    const [rtu] = await tx
      .select({ locationId: rtus.locationId })
      .from(rtus)
      .where(eq(rtus.id, rtuId))
      .limit(1);
    if (!rtu) {
      throw new NotFoundException("RTU not found");
    }
    if (rtu.locationId !== locationId) {
      throw new BadRequestException("RTU must belong to the selected location");
    }
  }

  private async fetchRow(id: string): Promise<AdminAssetPointDto> {
    const [row] = await this.fetchRows([id]);
    if (!row) {
      throw new NotFoundException("Asset point not found");
    }
    return row;
  }

  /**
   * The written rows, read back through the same projection `list` returns, so
   * a client parses one shape whatever route it called
   * (`assetPointsListResponseSchema`). Ordered by asset then point key rather
   * than by the order the ids arrived in: the bulk editor's caller holds a
   * selection, not a sequence.
   */
  private async fetchRows(ids: readonly string[]): Promise<AdminAssetPointDto[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.fleetDb
      .select({
        point: assetPoints,
        assetCode: assets.code,
        assetName: assets.name,
        locationId: assets.locationId,
        locationName: locations.name,
      })
      .from(assetPoints)
      .innerJoin(assets, eq(assetPoints.assetId, assets.id))
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .where(inArray(assetPoints.id, [...ids]))
      .orderBy(asc(assets.code), asc(assetPoints.pointKey));
    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: {
    point: typeof assetPoints.$inferSelect;
    assetCode: string;
    assetName: string;
    locationId: string | null;
    locationName: string | null;
  }): AdminAssetPointDto {
    const point = row.point;
    return {
      id: point.id,
      assetId: point.assetId,
      assetCode: row.assetCode,
      assetName: row.assetName,
      locationId: row.locationId,
      locationName: row.locationName,
      pointKey: point.pointKey,
      sourceDataKey: point.sourceDataKey,
      sensorCode: point.sensorCode,
      unit: point.unit,
      active: point.active,
      // asset_points_source_kind_check guarantees this is one of the four
      // values; drizzle types the column as the column's raw varchar type.
      sourceKind: point.sourceKind as AdminAssetPointDto["sourceKind"],
      // ADR 0018 decision 3 / ADR 0056 Q-H — the wiring, so a client that just
      // set `rtuId` reads it back rather than inferring it from `sourceKind`.
      rtuId: point.rtuId,
      createdAt: point.createdAt.toISOString(),
      // `F2.7` / ADR 0056 decision 1 — the per-asset override of the five
      // metadata columns, `null` = inherit the template default. Read straight
      // off the row.
      scaleMultiplier: point.scaleMultiplier,
      scaleOffset: point.scaleOffset,
      engMin: point.engMin,
      engMax: point.engMax,
      qualityPolicy: point.qualityPolicy as QualityPolicy | null,
    };
  }
}

/** A create body's five, as the merged check takes them: absent reads as `null`. */
function pointMetadataOf(body: CreateAssetPointBody): PointMetadataFields {
  return {
    scaleMultiplier: body.scaleMultiplier ?? null,
    scaleOffset: body.scaleOffset ?? null,
    engMin: body.engMin ?? null,
    engMax: body.engMax ?? null,
    qualityPolicy: body.qualityPolicy ?? null,
  };
}

/**
 * What the row will hold after this patch: the body's value where it states
 * one, the stored value where it does not.
 *
 * `!== undefined` per field rather than `??`, because the two spellings mean
 * different things on this surface — `null` clears the override back to the
 * template default, and `??` would read that as "leave it alone" and silently
 * keep an override the caller asked to remove. It is also what makes the
 * merged-pair check see the whole resolved row rather than the patch.
 */
function mergedPointMetadata(
  existing: typeof assetPoints.$inferSelect,
  body: PointMetadataBody,
): PointMetadataFields {
  return {
    scaleMultiplier:
      body.scaleMultiplier !== undefined ? body.scaleMultiplier : existing.scaleMultiplier,
    scaleOffset: body.scaleOffset !== undefined ? body.scaleOffset : existing.scaleOffset,
    engMin: body.engMin !== undefined ? body.engMin : existing.engMin,
    engMax: body.engMax !== undefined ? body.engMax : existing.engMax,
    qualityPolicy:
      body.qualityPolicy !== undefined
        ? body.qualityPolicy
        : (existing.qualityPolicy as QualityPolicy | null),
  };
}

/**
 * The metadata fields a PATCH body actually states — present keys only, `null`
 * included (a stated `null` clears the override). This is what the UPDATE
 * writes, so an unstated field is never rewritten from a pre-transaction read;
 * {@link mergedPointMetadata} is the resolved view the merged-pair check needs
 * and must not be what is written back.
 */
function statedPointMetadata(body: PointMetadataBody): Partial<PointMetadataFields> {
  const stated: Partial<PointMetadataFields> = {};
  if (body.scaleMultiplier !== undefined) stated.scaleMultiplier = body.scaleMultiplier;
  if (body.scaleOffset !== undefined) stated.scaleOffset = body.scaleOffset;
  if (body.engMin !== undefined) stated.engMin = body.engMin;
  if (body.engMax !== undefined) stated.engMax = body.engMax;
  if (body.qualityPolicy !== undefined) stated.qualityPolicy = body.qualityPolicy;
  return stated;
}

/**
 * The columns one bulk patch writes: {@link statedPointMetadata}'s five plus
 * the two the bulk body adds.
 *
 * Same rule, same reason (PR 1 security review, L1): only the fields the
 * request states are written, so an unstated column is never restated from a
 * value read before the transaction — and here that matters more, because the
 * one `UPDATE` covers up to `MAX_ASSET_POINT_BULK_IDS` rows at once.
 */
function statedBulkColumns(
  patch: AssetPointBulkPatch,
): Partial<PointMetadataFields> & { unit?: string | null; active?: boolean } {
  const stated: Partial<PointMetadataFields> & { unit?: string | null; active?: boolean } =
    statedPointMetadata(patch);
  if (patch.unit !== undefined) stated.unit = patch.unit;
  if (patch.active !== undefined) stated.active = patch.active;
  return stated;
}
