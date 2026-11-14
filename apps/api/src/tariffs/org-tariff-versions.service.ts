import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";

import { orgTariffCategories, orgTariffSlabs } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  CreateTariffVersionBody,
  JwtPayload,
  TariffSlab,
  TariffVersionDto,
  UpdateTariffVersionBody,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { resolveActorId } from "../auth/identity-resolver";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { currentMonthFirstDay, readLineVersions, toVersionDto } from "./tariff-lines.service";

const NOT_FOUND = "Tariff version not found";

/** Maps a driver error from an organization version write; anything else comes back unchanged. */
export function translateTariffVersionWriteError(err: unknown, organizationId: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (code === "23505" && constraint === "org_tariff_categories_org_key_effective_from_key") {
    return new ConflictException("This organization already has a version of this tariff line from that month.");
  }
  if (code === "42501") {
    return new BadRequestException(`The write was refused by row-level security: the version does not belong to organization ${organizationId}.`);
  }
  if (code === "23514" && (constraint?.startsWith("org_tariff_categories_") || constraint?.startsWith("org_tariff_slabs_"))) {
    return new BadRequestException("The version breaks a rule of the table: a first-of-month date, non-negative rates and slab bounds, an http(s) source URL.");
  }
  return err;
}

interface StoredVersion {
  id: string;
  organizationId: string;
  key: string;
  effectiveFrom: string;
}

/**
 * `F4.365` U6 (ADR 0134 decision 8, Amendment 1, plan D5/D6) — an
 * organization's own tariff versions: `POST /admin/tariffs/versions` and
 * `PATCH|DELETE /admin/tariffs/versions/:id`.
 *
 * **Gate.** `requireMasterDataUser`, then `isOrganizationLevelAdmin` for the
 * version's organization — never `canManageOrganization`, which admits a
 * `location_admin` in the organization its locations derive. A version in an
 * organization the caller cannot read is a 404, never a 403.
 *
 * **Revision vs custom.** A revision names a line the organization can see;
 * its descriptive columns are copied on the server from that line's newest
 * version, never taken from the body. A custom line carries its own, under a
 * `custom:` key (the contract enforces the prefix).
 *
 * **Dates (Amendment 1).** Any first-of-month date, backdated included; the
 * audit row records the reason. A version already in force — `effectiveFrom`
 * on or before the current month's first day in the organization's zone —
 * cannot be edited or deleted (409), only superseded by a newer version.
 *
 * Category, slabs and the audit row are written in one `withTenant`
 * transaction; pre-reads run on the fleet handles.
 */
@Injectable()
export class OrgTariffVersionsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(FLEET_POOL) private readonly fleetPool: Pick<Pool, "query">,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async create(jwt: JwtPayload, body: CreateTariffVersionBody, now = new Date()): Promise<TariffVersionDto> {
    const organizationId = body.organizationId;
    await this.requireOrganizationAdmin(jwt, organizationId);

    let descriptive: Omit<typeof orgTariffCategories.$inferInsert, "organizationId" | "key" | "effectiveFrom" | "reason">;
    if (body.kind === "revision") {
      const versions = await readLineVersions(this.fleetPool, body.key, organizationId);
      const latest = versions[versions.length - 1];
      if (!latest) {
        throw new BadRequestException(`"${body.key}" is not a tariff line in the catalog or this organization's own lines.`);
      }
      descriptive = {
        areaId: latest.areaId,
        state: latest.state,
        discoms: latest.discoms,
        ownership: latest.ownership,
        code: latest.code,
        name: latest.name,
        segment: latest.segment,
        supply: latest.supply,
        energyUnit: latest.energyUnit,
        fixedBasis: latest.fixedBasis,
        dataStatus: latest.dataStatus,
        notes: latest.notes,
        tariffOrder: body.tariffOrder === undefined ? latest.tariffOrder : body.tariffOrder,
        sourceUrl: body.sourceUrl === undefined ? latest.sourceUrl : body.sourceUrl,
      };
    } else {
      descriptive = {
        areaId: body.areaId,
        state: body.state,
        discoms: body.discoms,
        ownership: body.ownership,
        code: body.code,
        name: body.name,
        segment: body.segment,
        supply: body.supply,
        energyUnit: body.energyUnit,
        fixedBasis: body.fixedBasis,
        dataStatus: body.dataStatus,
        notes: body.notes,
        tariffOrder: body.tariffOrder,
        sourceUrl: body.sourceUrl,
      };
    }
    const createdBy = await resolveActorId(this.fleetDb, jwt);

    const id = await this.translating(organizationId, () =>
      withTenant(this.db, organizationId, async (tx) => {
        await this.refuseDuplicate(tx, organizationId, body.key, body.effectiveFrom, null);
        const [written] = await tx
          .insert(orgTariffCategories)
          .values({ ...descriptive, organizationId, key: body.key, effectiveFrom: body.effectiveFrom, reason: body.reason, createdBy })
          .returning({ id: orgTariffCategories.id });
        if (!written) throw new Error("create: the insert returned no row");
        await this.insertSlabs(tx, written.id, organizationId, body.slabs);
        await this.audit.write(
          {
            actor: jwt,
            action: "master.tariff_version.create",
            entityType: "org_tariff_version",
            entityId: written.id,
            organizationId,
            reason: body.reason,
            payload: body,
          },
          tx,
        );
        return written.id;
      }),
    );
    return this.readDto(organizationId, body.key, id, now);
  }

  async update(jwt: JwtPayload, id: string, body: UpdateTariffVersionBody, now = new Date()): Promise<TariffVersionDto> {
    const existing = await this.fetchWritable(jwt, id, now);
    const effectiveFrom = body.effectiveFrom ?? existing.effectiveFrom;
    await this.translating(existing.organizationId, () =>
      withTenant(this.db, existing.organizationId, async (tx) => {
        if (effectiveFrom !== existing.effectiveFrom) {
          await this.refuseDuplicate(tx, existing.organizationId, existing.key, effectiveFrom, id);
        }
        const updated = await tx
          .update(orgTariffCategories)
          .set({
            effectiveFrom,
            reason: body.reason,
            ...(body.tariffOrder === undefined ? {} : { tariffOrder: body.tariffOrder }),
            ...(body.sourceUrl === undefined ? {} : { sourceUrl: body.sourceUrl }),
            updatedAt: new Date(),
          })
          .where(and(eq(orgTariffCategories.id, id), eq(orgTariffCategories.organizationId, existing.organizationId)))
          .returning({ id: orgTariffCategories.id });
        if (updated.length === 0) throw new NotFoundException(NOT_FOUND);
        if (body.slabs !== undefined) {
          await tx.delete(orgTariffSlabs).where(and(eq(orgTariffSlabs.categoryId, id), eq(orgTariffSlabs.organizationId, existing.organizationId)));
          await this.insertSlabs(tx, id, existing.organizationId, body.slabs);
        }
        await this.audit.write(
          {
            actor: jwt,
            action: "master.tariff_version.update",
            entityType: "org_tariff_version",
            entityId: id,
            organizationId: existing.organizationId,
            reason: body.reason,
            payload: { key: existing.key, previousEffectiveFrom: existing.effectiveFrom, ...body },
          },
          tx,
        );
      }),
    );
    return this.readDto(existing.organizationId, existing.key, id, now);
  }

  async remove(jwt: JwtPayload, id: string, reason: string, now = new Date()): Promise<void> {
    const existing = await this.fetchWritable(jwt, id, now);
    await withTenant(this.db, existing.organizationId, async (tx) => {
      const deleted = await tx
        .delete(orgTariffCategories)
        .where(and(eq(orgTariffCategories.id, id), eq(orgTariffCategories.organizationId, existing.organizationId)))
        .returning({ id: orgTariffCategories.id });
      if (deleted.length === 0) throw new NotFoundException(NOT_FOUND);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.tariff_version.delete",
          entityType: "org_tariff_version",
          entityId: id,
          organizationId: existing.organizationId,
          reason,
          payload: { key: existing.key, effectiveFrom: existing.effectiveFrom },
        },
        tx,
      );
    });
  }

  // ---- gates -----------------------------------------------------------------

  private async requireOrganizationAdmin(jwt: JwtPayload, organizationId: string): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isOrganizationLevelAdmin(jwt, organizationId))) {
      throw new ForbiddenException("An organization's tariff versions are written by its admin or organization_admin");
    }
  }

  /** The stored version, 404 outside the caller's readable organizations, 403 without the role, 409 once in force. */
  private async fetchWritable(jwt: JwtPayload, id: string, now: Date): Promise<StoredVersion> {
    await this.accessControl.requireMasterDataUser(jwt);
    // Fleet read (ADR 0043 Amendment 3): the row's organization is what `withTenant` needs; the readable-organizations check below bounds it.
    const { rows } = await this.fleetPool.query<{ id: string; organization_id: string; key: string; effective_from: string }>(
      `SELECT id, organization_id, key, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
         FROM bms.org_tariff_categories WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (!row || (readable !== null && !readable.includes(row.organization_id))) {
      throw new NotFoundException(NOT_FOUND);
    }
    await this.requireOrganizationAdmin(jwt, row.organization_id);
    const firstDay = await currentMonthFirstDay(this.fleetPool, row.organization_id, now);
    if (row.effective_from <= firstDay) {
      throw new ConflictException(
        `This version has been in force since ${row.effective_from}, so it cannot be edited or deleted. ` +
          "Add a newer version to supersede it.",
      );
    }
    return { id: row.id, organizationId: row.organization_id, key: row.key, effectiveFrom: row.effective_from };
  }

  /** The author-facing duplicate refusal, inside the write's tenant transaction. */
  private async refuseDuplicate(
    tx: BmsTx,
    organizationId: string,
    key: string,
    effectiveFrom: string,
    excludeId: string | null,
  ): Promise<void> {
    const { rows } = await tx.execute(
      sql`SELECT 1 FROM bms.org_tariff_categories
           WHERE organization_id = ${organizationId}::uuid AND key = ${key} AND effective_from = ${effectiveFrom}::date
             AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)`,
    );
    if (rows.length > 0) {
      throw new ConflictException(`This organization already has a version of "${key}" from ${effectiveFrom}.`);
    }
  }

  private async insertSlabs(tx: BmsTx, categoryId: string, organizationId: string, slabs: readonly TariffSlab[]): Promise<void> {
    await tx.insert(orgTariffSlabs).values(
      slabs.map((s) => ({
        categoryId,
        organizationId,
        slabNo: s.slabNo,
        fromUnits: String(s.fromUnits),
        toUnits: s.toUnits === null ? null : String(s.toUnits),
        energyRate: String(s.energyRate),
        fixedRate: String(s.fixedRate),
        wheelingRate: String(s.wheelingRate),
        notes: s.notes,
      })),
    );
  }

  private async translating<T>(organizationId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw translateTariffVersionWriteError(err, organizationId);
    }
  }

  private async readDto(organizationId: string, key: string, id: string, now: Date): Promise<TariffVersionDto> {
    const version = (await readLineVersions(this.fleetPool, key, organizationId)).find((v) => v.id === id);
    if (!version) throw new NotFoundException(NOT_FOUND);
    return toVersionDto(version, await currentMonthFirstDay(this.fleetPool, organizationId, now));
  }
}
