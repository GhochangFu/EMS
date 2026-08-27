import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assetTemplates, assets, locations, organizations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetDto, AdminAssetSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateAssetBody, UpdateAssetBody } from "./assets.schema";

/**
 * `F4.16` / `E7.1b` / ADR 0043 — `assets` (and `asset_points`) gain
 * `organization_id` + a `tenant_isolation` policy + `FORCE` in migration `0047`.
 *
 * Reads run on `fleetDb`, trusting the `writableLocationIds`/`canManageAsset`
 * scope filter this service already applies before returning a row — the same
 * "bypass, then trust an already-computed grant" shape `AccessControlService`
 * uses (Amendment 2/3). Writes run inside `withTenant(tenantDb, organizationId,
 * …)`: the organization is derived from the asset's location (`create`/relocate)
 * or the asset's own row (`deactivate`/`reactivate`) **before** the write, and
 * an asset cannot cross organizations (`update` refuses a destination in another
 * org — the RLS `USING`/`WITH CHECK` pair cannot span two orgs under one
 * `SET LOCAL`, so the move would otherwise be a silent zero-row no-op post-0047).
 * The RTU consistency read stays **inside** the tenant GUC, never on `fleetDb`:
 * a valid gateway shares the asset's location and org, so the tenant context
 * sees it, while a foreign RTU reads as absent rather than as an existence
 * oracle across tenants.
 */
@Injectable()
export class AssetsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly vocabularies: VocabulariesService,
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

    const rows = await this.fleetDb
      .select({
        asset: assets,
        locationName: locations.name,
        organizationCode: organizations.code,
        rtuDisplayName: rtus.displayName,
        templateCode: assetTemplates.code,
        templateVersion: assetTemplates.version,
      })
      .from(assets)
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      // LEFT: assets.templateId is nullable and every seeded asset is
      // hand-created, so an inner join here would empty the list (F2.6).
      .leftJoin(assetTemplates, eq(assets.templateId, assetTemplates.id))
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
    const [row] = await this.fleetDb
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
    // ADR 0031 Amendment 1 — the plant vocabulary is data, so the request
    // schema can only check shape. Without this the code would reach
    // `assets_domain_fk` and return a 500 where the enum used to give a 400.
    await this.vocabularies.assertAssetDomain(body.domain);
    // Resolve the org from the location BEFORE the write, so the RTU check and
    // the insert both run under the tenant GUC (E7.1b).
    const organizationId = await this.resolveLocationOrg(body.locationId);

    const created = await withTenant(this.tenantDb, organizationId, async (tx) => {
      await this.assertRtuLocation(body.rtuId, body.locationId, tx);
      const [row] = await tx
        .insert(assets)
        .values({
          code: body.code,
          name: body.name,
          siteName: body.siteName,
          locationId: body.locationId,
          rtuId: body.rtuId ?? null,
          domain: body.domain,
          organizationId,
          meta: body.meta ?? null,
          active: true,
        })
        .returning();

      // E7.1c (item D): folded into this transaction so the stamped
      // organizationId matches the GUC the strict WITH CHECK now demands.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset.create",
          entityType: "asset",
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

  /** Updates an asset in scope. */
  async update(jwt: JwtPayload, id: string, body: UpdateAssetBody): Promise<AdminAssetDto> {
    // fleetDb read (Amendment 2/3): `assets` gains a policy in 0047, and this
    // read precedes any tenant context; the `canManageAsset` gate below is the
    // isolation control.
    const [existing] = await this.fleetDb
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
    // Only when the caller supplies one: `updateAssetBodySchema` is a partial,
    // and re-checking `existing.domain` would make a rename fail on an asset
    // whose domain was retired — punishing an edit for something it did not
    // touch.
    if (body.domain !== undefined) {
      await this.vocabularies.assertAssetDomain(body.domain);
    }

    const organizationId = await this.resolveLocationOrg(nextLocationId);
    // An asset cannot move to a location in another organization. Post-0047 the
    // UPDATE's `USING` (old org) and `WITH CHECK` (new org) cannot both hold
    // under one `SET LOCAL`, so a cross-org relocation would update zero rows
    // and still return a success DTO from `fetchRow`. Refuse it outright.
    // (`existing.organizationId` is only null on a pre-0046 row that dodged the
    // backfill; there the update simply fills the column in.)
    if (existing.organizationId && organizationId !== existing.organizationId) {
      throw new BadRequestException(
        "An asset cannot be moved to a location in another organization",
      );
    }

    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await this.assertRtuLocation(nextRtuId, nextLocationId, tx);
      await tx
        .update(assets)
        .set({
          code: body.code ?? existing.code,
          name: body.name ?? existing.name,
          siteName: body.siteName ?? existing.siteName,
          locationId: nextLocationId,
          rtuId: nextRtuId,
          domain: body.domain ?? existing.domain,
          organizationId,
          meta: body.meta !== undefined ? body.meta : existing.meta,
        })
        .where(eq(assets.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset.update",
          entityType: "asset",
          entityId: id,
          organizationId,
          payload: body,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Deactivates an asset and its point mappings. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminAssetDto> {
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const organizationId = await this.resolveAssetOrg(id);
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx.update(assets).set({ active: false }).where(eq(assets.id, id));
      await tx.update(assetPoints).set({ active: false }).where(eq(assetPoints.assetId, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset.deactivate",
          entityType: "asset",
          entityId: id,
          organizationId,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Reactivates an asset. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminAssetDto> {
    if (!(await this.accessControl.canManageAsset(jwt, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const organizationId = await this.resolveAssetOrg(id);
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx.update(assets).set({ active: true }).where(eq(assets.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset.reactivate",
          entityType: "asset",
          entityId: id,
          organizationId,
        },
        tx,
      );
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
    tx: BmsTx,
  ): Promise<void> {
    if (!rtuId) {
      return;
    }
    // Read inside the caller's tenant GUC (never fleetDb): a valid gateway
    // shares this location, hence this org, so the tenant context sees it; a
    // foreign RTU reads as absent below rather than as a cross-tenant oracle.
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

  /**
   * Resolves a location's organization on `fleetDb` before a write opens its
   * tenant context. `locations` carries a policy (`0040`); the caller has
   * already passed `canManageLocation` for this id, which is the isolation
   * control.
   */
  private async resolveLocationOrg(locationId: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return row.organizationId;
  }

  /**
   * Resolves an asset's own organization on `fleetDb` for `deactivate`/
   * `reactivate`, which need the tenant GUC but change no tenant-bearing field.
   * The caller has already passed `canManageAsset`. A null column would only
   * survive from a pre-0046 row; treat it as unresolvable rather than open a
   * `withTenant(null)`.
   */
  private async resolveAssetOrg(id: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset not found");
    }
    if (!row.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    return row.organizationId;
  }

  private async fetchRow(id: string): Promise<AdminAssetDto> {
    const [row] = await this.fleetDb
      .select({
        asset: assets,
        locationName: locations.name,
        organizationCode: organizations.code,
        rtuDisplayName: rtus.displayName,
        templateCode: assetTemplates.code,
        templateVersion: assetTemplates.version,
      })
      .from(assets)
      .leftJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      // LEFT, for the same reason `list` uses one: a hand-created asset has no
      // pin, and an inner join would make it unreadable after a write.
      .leftJoin(assetTemplates, eq(assets.templateId, assetTemplates.id))
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
    templateCode: string | null;
    templateVersion: number | null;
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
      templateId: asset.templateId,
      templateCode: row.templateCode,
      templateVersion: row.templateVersion,
      meta: (asset.meta as Record<string, unknown> | null) ?? null,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
