import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetPointDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateAssetPointBody, UpdateAssetPointBody } from "./asset-points.schema";
import { resolveCatalogPointKey } from "./resolve-catalog-point-key";

@Injectable()
export class AssetPointsAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
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

    const rows = await this.db
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
    const [ownerAsset] = await this.db
      .select({ rtuId: assets.rtuId })
      .from(assets)
      .where(eq(assets.id, body.assetId))
      .limit(1);
    const sourceRtuId = ownerAsset?.rtuId ?? null;

    const [created] = await this.db
      .insert(assetPoints)
      .values({
        assetId: body.assetId,
        pointKey: body.pointKey,
        sourceDataKey: body.sourceDataKey,
        sensorCode: body.sensorCode ?? null,
        unit: body.unit ?? catalog.unit,
        active: true,
        rtuId: sourceRtuId,
        sourceKind: sourceRtuId ? "measured" : "unmapped",
      })
      .returning();

    await this.audit.write({
      actor: jwt,
      action: "master.asset_point.create",
      entityType: "asset_point",
      entityId: created.id,
      payload: body,
    });
    return this.fetchRow(created.id);
  }

  /** Updates an asset point mapping in scope. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateAssetPointBody,
  ): Promise<AdminAssetPointDto> {
    const [existing] = await this.db
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

    const nextPointKey = body.pointKey ?? existing.pointKey;
    const catalog = await this.resolveCatalogPointKey(existing.assetId, nextPointKey);

    await this.db
      .update(assetPoints)
      .set({
        pointKey: nextPointKey,
        sourceDataKey: body.sourceDataKey ?? existing.sourceDataKey,
        sensorCode: body.sensorCode !== undefined ? body.sensorCode : existing.sensorCode,
        unit: body.unit !== undefined ? body.unit : (existing.unit ?? catalog.unit),
      })
      .where(eq(assetPoints.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.asset_point.update",
      entityType: "asset_point",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates an asset point mapping. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminAssetPointDto> {
    const [existing] = await this.db
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

    await this.db.update(assetPoints).set({ active: false }).where(eq(assetPoints.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.asset_point.deactivate",
      entityType: "asset_point",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates an asset point mapping. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminAssetPointDto> {
    const [existing] = await this.db
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

    await this.db.update(assetPoints).set({ active: true }).where(eq(assetPoints.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.asset_point.reactivate",
      entityType: "asset_point",
      entityId: id,
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
    const result = await resolveCatalogPointKey(this.db, assetId, pointKey);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return { unit: result.unit };
  }

  private async fetchRow(id: string): Promise<AdminAssetPointDto> {
    const [row] = await this.db
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
      .where(eq(assetPoints.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset point not found");
    }
    return this.mapRow(row);
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
      createdAt: point.createdAt.toISOString(),
    };
  }
}
