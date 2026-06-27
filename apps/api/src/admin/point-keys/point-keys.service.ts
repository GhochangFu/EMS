import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { organizations, pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminPointKeyDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreatePointKeyBody, UpdatePointKeyBody } from "./point-keys.schema";

@Injectable()
export class PointKeysAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists org-scoped point keys visible to the caller. */
  async list(
    jwt: JwtPayload,
    organizationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminPointKeyDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    const conditions = [];
    if (organizationId) {
      if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
        throw new ForbiddenException("Organization is outside your access scope");
      }
      conditions.push(eq(pointKeys.organizationId, organizationId));
    } else if (writableOrgIds !== null) {
      if (writableOrgIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(pointKeys.organizationId, writableOrgIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(pointKeys.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(pointKeys.active, false));
    }

    const rows = await this.db
      .select({
        pointKey: pointKeys,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(pointKeys)
      .innerJoin(organizations, eq(pointKeys.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(pointKeys.code));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one point key when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const row = await this.fetchRow(id);
    if (!(await this.accessControl.canManageOrganization(jwt, row.organizationId))) {
      throw new ForbiddenException("Point key is outside your access scope");
    }
    return row;
  }

  /** Creates a point key in an organization the caller may manage. */
  async create(jwt: JwtPayload, body: CreatePointKeyBody): Promise<AdminPointKeyDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot manage the point key catalog");
    }
    if (!(await this.accessControl.canManagePointKey(jwt, body.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }

    const [created] = await this.db
      .insert(pointKeys)
      .values({
        organizationId: body.organizationId,
        code: body.code,
        name: body.name,
        domain: body.domain ?? null,
        unit: body.unit ?? null,
        description: body.description ?? null,
        active: true,
      })
      .returning();

    await this.audit.write({
      actor: jwt,
      action: "master.point_key.create",
      entityType: "point_key",
      entityId: created.id,
      payload: body,
    });
    return this.fetchRow(created.id);
  }

  /** Updates a point key in scope. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdatePointKeyBody,
  ): Promise<AdminPointKeyDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot manage the point key catalog");
    }

    const existing = await this.fetchRow(id);
    if (!(await this.accessControl.canManagePointKey(jwt, existing.organizationId))) {
      throw new ForbiddenException("Point key is outside your access scope");
    }

    await this.db
      .update(pointKeys)
      .set({
        name: body.name ?? existing.name,
        domain: body.domain !== undefined ? body.domain : existing.domain,
        unit: body.unit !== undefined ? body.unit : existing.unit,
        description:
          body.description !== undefined ? body.description : existing.description,
      })
      .where(eq(pointKeys.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.point_key.update",
      entityType: "point_key",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates a point key when no active asset mappings remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot manage the point key catalog");
    }

    const existing = await this.fetchRow(id);
    if (!(await this.accessControl.canManagePointKey(jwt, existing.organizationId))) {
      throw new ForbiddenException("Point key is outside your access scope");
    }

    await this.db.update(pointKeys).set({ active: false }).where(eq(pointKeys.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.point_key.deactivate",
      entityType: "point_key",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates a point key. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot manage the point key catalog");
    }

    const existing = await this.fetchRow(id);
    if (!(await this.accessControl.canManagePointKey(jwt, existing.organizationId))) {
      throw new ForbiddenException("Point key is outside your access scope");
    }

    await this.db.update(pointKeys).set({ active: true }).where(eq(pointKeys.id, id));
    await this.audit.write({
      actor: jwt,
      action: "master.point_key.reactivate",
      entityType: "point_key",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  private async fetchRow(id: string): Promise<AdminPointKeyDto> {
    const [row] = await this.db
      .select({
        pointKey: pointKeys,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(pointKeys)
      .innerJoin(organizations, eq(pointKeys.organizationId, organizations.id))
      .where(eq(pointKeys.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Point key not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    pointKey: typeof pointKeys.$inferSelect;
    organizationCode: string;
    organizationName: string;
  }): AdminPointKeyDto {
    const item = row.pointKey;
    return {
      id: item.id,
      organizationId: item.organizationId,
      organizationCode: row.organizationCode,
      organizationName: row.organizationName,
      code: item.code,
      name: item.name,
      domain: item.domain,
      unit: item.unit,
      description: item.description,
      active: item.active,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
