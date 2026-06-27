import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets, locations, organizations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminRtuDto, AdminRtuSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateRtuBody, UpdateRtuBody } from "./rtus.schema";

@Injectable()
export class RtusAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists RTUs scoped to writable locations. */
  async list(
    jwt: JwtPayload,
    locationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminRtuDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (locationId) {
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      conditions.push(eq(rtus.locationId, locationId));
    } else if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(rtus.locationId, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(rtus.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(rtus.active, false));
    }

    const rows = await this.db
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(rtus.displayName));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one RTU summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminRtuSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const [row] = await this.db
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationId: organizations.id,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, row.rtu.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }
    return {
      id: row.rtu.id,
      code: row.rtu.code,
      displayName: row.rtu.displayName,
      locationId: row.rtu.locationId,
      locationName: row.locationName,
      organizationId: row.organizationId,
      organizationCode: row.organizationCode,
    };
  }

  /** Creates an RTU under a writable location. */
  async create(jwt: JwtPayload, body: CreateRtuBody): Promise<AdminRtuDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, body.locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [created] = await this.db
      .insert(rtus)
      .values({
        locationId: body.locationId,
        code: body.code,
        displayName: body.displayName,
        sourceType: body.sourceType,
        domain: body.domain ?? null,
        externalRtuId: body.externalRtuId ?? null,
        rtuCode: body.rtuCode ?? null,
        mqttTopic: body.mqttTopic ?? null,
        stationCode: body.stationCode ?? null,
        stationName: body.stationName ?? null,
        ingestEnabled: body.ingestEnabled ?? false,
        meta: body.meta ?? null,
        active: true,
      })
      .returning();

    await this.audit.write({
      actor: jwt,
      action: "master.rtu.create",
      entityType: "rtu",
      entityId: created.id,
      payload: body,
    });
    return this.fetchRow(created.id);
  }

  /** Updates an RTU in scope. */
  async update(jwt: JwtPayload, id: string, body: UpdateRtuBody): Promise<AdminRtuDto> {
    const [existing] = await this.db
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    await this.db
      .update(rtus)
      .set({
        code: body.code ?? existing.code,
        displayName: body.displayName ?? existing.displayName,
        sourceType: body.sourceType ?? existing.sourceType,
        domain: body.domain !== undefined ? body.domain : existing.domain,
        externalRtuId:
          body.externalRtuId !== undefined ? body.externalRtuId : existing.externalRtuId,
        rtuCode: body.rtuCode !== undefined ? body.rtuCode : existing.rtuCode,
        mqttTopic: body.mqttTopic !== undefined ? body.mqttTopic : existing.mqttTopic,
        stationCode:
          body.stationCode !== undefined ? body.stationCode : existing.stationCode,
        stationName:
          body.stationName !== undefined ? body.stationName : existing.stationName,
        ingestEnabled: body.ingestEnabled ?? existing.ingestEnabled,
        meta: body.meta !== undefined ? body.meta : existing.meta,
      })
      .where(eq(rtus.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.rtu.update",
      entityType: "rtu",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates an RTU when no active assets remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    const [existing] = await this.db
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const [activeAsset] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(eq(assets.rtuId, id), eq(assets.active, true)))
      .limit(1);
    if ((activeAsset?.count ?? 0) > 0) {
      throw new ConflictException("Cannot deactivate RTU with active assets");
    }

    await this.db.update(rtus).set({ active: false }).where(eq(rtus.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.rtu.deactivate",
      entityType: "rtu",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates an RTU. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    const [existing] = await this.db
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    await this.db.update(rtus).set({ active: true }).where(eq(rtus.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.rtu.reactivate",
      entityType: "rtu",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  private async fetchRow(id: string): Promise<AdminRtuDto> {
    const [row] = await this.db
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    rtu: typeof rtus.$inferSelect;
    locationName: string;
    organizationCode: string;
  }): AdminRtuDto {
    const rtu = row.rtu;
    return {
      id: rtu.id,
      locationId: rtu.locationId,
      locationName: row.locationName,
      organizationCode: row.organizationCode,
      code: rtu.code,
      displayName: rtu.displayName,
      sourceType: rtu.sourceType as AdminRtuDto["sourceType"],
      domain: rtu.domain,
      externalRtuId: rtu.externalRtuId,
      rtuCode: rtu.rtuCode,
      mqttTopic: rtu.mqttTopic,
      stationCode: rtu.stationCode,
      stationName: rtu.stationName,
      ingestEnabled: rtu.ingestEnabled,
      active: rtu.active,
      meta: (rtu.meta as Record<string, unknown> | null) ?? null,
      createdAt: rtu.createdAt.toISOString(),
    };
  }
}
