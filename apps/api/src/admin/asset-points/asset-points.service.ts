import {
  BadRequestException,
  ConflictException,
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
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateAssetPointBody, UpdateAssetPointBody } from "./asset-points.schema";
import { resolveCatalogPointKey } from "./resolve-catalog-point-key";

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
      .select({ organizationId: assets.organizationId, rtuId: assets.rtuId })
      .from(assets)
      .where(eq(assets.id, body.assetId))
      .limit(1);
    if (!ownerAsset) {
      throw new NotFoundException("Asset not found");
    }
    const organizationId = this.requireRowOrg(ownerAsset.organizationId);
    const sourceRtuId = ownerAsset.rtuId ?? null;

    const created = await withTenant(this.tenantDb, organizationId, async (tx) => {
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
        })
        .returning();
      return row;
    });

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
    const catalog = await this.resolveCatalogPointKey(existing.assetId, nextPointKey);

    await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .update(assetPoints)
        .set({
          pointKey: nextPointKey,
          sourceDataKey: body.sourceDataKey ?? existing.sourceDataKey,
          sensorCode: body.sensorCode !== undefined ? body.sensorCode : existing.sensorCode,
          unit: body.unit !== undefined ? body.unit : (existing.unit ?? catalog.unit),
        })
        .where(eq(assetPoints.id, id)),
    );

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

    await withTenant(this.tenantDb, organizationId, (tx) =>
      tx.update(assetPoints).set({ active: false }).where(eq(assetPoints.id, id)),
    );
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

    await withTenant(this.tenantDb, organizationId, (tx) =>
      tx.update(assetPoints).set({ active: true }).where(eq(assetPoints.id, id)),
    );
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

  private async fetchRow(id: string): Promise<AdminAssetPointDto> {
    const [row] = await this.fleetDb
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
      // asset_points_source_kind_check guarantees this is one of the four
      // values; drizzle types the column as the column's raw varchar type.
      sourceKind: point.sourceKind as AdminAssetPointDto["sourceKind"],
      createdAt: point.createdAt.toISOString(),
    };
  }
}
