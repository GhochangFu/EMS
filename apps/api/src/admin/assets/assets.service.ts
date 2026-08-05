import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, locations, organizations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetDto, AdminAssetSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateAssetBody, UpdateAssetBody } from "./assets.schema";

@Injectable()
export class AssetsAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists assets scoped to writable locations. */
  async list(
    jwt: JwtPayload,
    locationId?: string,
    rtuId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminAssetDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
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
    if (rtuId) {
      conditions.push(eq(assets.rtuId, rtuId));
    }
    if (activeOnly === true) {
      conditions.push(eq(assets.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(assets.active, false));
    }

    const rows = await this.db
      .select({
        asset: assets,
        locationName: locations.name,
        organizationCode: organizations.code,
        rtuDisplayName: rtus.displayName,
      })
      .from(assets)
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(assets.code));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one asset summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminAssetSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    const [row] = await this.db
      .select({
        asset: assets,
        locationName: locations.name,
        organizationId: organizations.id,
        organizationCode: organizations.code,
        rtuDisplayName: rtus.displayName,
      })
      .from(assets)
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      .where(eq(assets.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset not found");
    }
    return {
      id: row.asset.id,
      code: row.asset.code,
      name: row.asset.name,
      locationId: row.asset.locationId,
      locationName: row.locationName,
      rtuId: row.asset.rtuId,
      rtuDisplayName: row.rtuDisplayName,
      organizationId: row.organizationId,
      organizationCode: row.organizationCode,
    };
  }

  /** Creates an asset under a writable location with RTU consistency check. */
  async create(jwt: JwtPayload, body: CreateAssetBody): Promise<AdminAssetDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, body.locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    await this.assertRtuLocation(body.rtuId, body.locationId);

    const [created] = await this.db
      .insert(assets)
      .values({
        code: body.code,
        name: body.name,
        siteName: body.siteName,
        locationId: body.locationId,
        rtuId: body.rtuId ?? null,
        domain: body.domain,
        meta: body.meta ?? null,
        active: true,
      })
      .returning();

    await this.audit.write({
      actor: jwt,
      action: "master.asset.create",
      entityType: "asset",
      entityId: created.id,
      payload: body,
    });
    return this.fetchRow(created.id);
  }

  /** Updates an asset in scope. */
  async update(jwt: JwtPayload, id: string, body: UpdateAssetBody): Promise<AdminAssetDto> {
    const [existing] = await this.db
      .select()
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Asset not found");
    }
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const nextLocationId = body.locationId ?? existing.locationId;
    // `undefined` means "leave alone"; an explicit `null` unwires the asset
    // (ADR 0018), which `??` alone could not express.
    const nextRtuId = body.rtuId === undefined ? existing.rtuId : body.rtuId;

    // Authorize the DESTINATION, not just the asset's current home.
    // `canManageAsset` above resolves through the asset's *existing* location,
    // so without this a location_admin could relocate an asset they own into a
    // location they do not, handing it to that location's users.
    //
    // Before ADR 0018 this was accidentally covered: rtu_id was NOT NULL, so
    // `assertRtuLocation` always ran and required the RTU to live in the
    // destination — and RTU ids are scope-filtered. Making rtu_id nullable
    // removed that side effect, so the check has to be explicit. `create()`
    // has always done this (see above); `update()` was the outlier.
    if (body.locationId && !(await this.accessControl.canManageLocation(jwt, nextLocationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    await this.assertRtuLocation(nextRtuId, nextLocationId);

    await this.db
      .update(assets)
      .set({
        code: body.code ?? existing.code,
        name: body.name ?? existing.name,
        siteName: body.siteName ?? existing.siteName,
        locationId: nextLocationId,
        rtuId: nextRtuId,
        domain: body.domain ?? existing.domain,
        meta: body.meta !== undefined ? body.meta : existing.meta,
      })
      .where(eq(assets.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.asset.update",
      entityType: "asset",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates an asset and its point mappings. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminAssetDto> {
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    await this.db.transaction(async (tx) => {
      await tx.update(assets).set({ active: false }).where(eq(assets.id, id));
      await tx.update(assetPoints).set({ active: false }).where(eq(assetPoints.assetId, id));
    });

    await this.audit.write({
      actor: jwt,
      action: "master.asset.deactivate",
      entityType: "asset",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates an asset. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminAssetDto> {
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    await this.db.update(assets).set({ active: true }).where(eq(assets.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.asset.reactivate",
      entityType: "asset",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /**
   * Asserts an asset's gateway lives in the same location as the asset.
   *
   * ADR 0018 made the gateway optional, so a null id is not an error — it means
   * the asset's points are hand-entered or computed. There is nothing to check.
   */
  private async assertRtuLocation(
    rtuId: string | null | undefined,
    locationId: string,
  ): Promise<void> {
    if (!rtuId) {
      return;
    }
    const [rtu] = await this.db
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

  private async fetchRow(id: string): Promise<AdminAssetDto> {
    const [row] = await this.db
      .select({
        asset: assets,
        locationName: locations.name,
        organizationCode: organizations.code,
        rtuDisplayName: rtus.displayName,
      })
      .from(assets)
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      .where(eq(assets.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    asset: typeof assets.$inferSelect;
    locationName: string | null;
    organizationCode: string | null;
    rtuDisplayName: string | null;
  }): AdminAssetDto {
    const asset = row.asset;
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      siteName: asset.siteName,
      locationId: asset.locationId,
      locationName: row.locationName,
      organizationCode: row.organizationCode,
      rtuId: asset.rtuId,
      rtuDisplayName: row.rtuDisplayName,
      domain: asset.domain,
      active: asset.active,
      meta: (asset.meta as Record<string, unknown> | null) ?? null,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
