import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { asc, eq, sql, type SQL } from "drizzle-orm";

import { locations, locationTypes } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminLocationTypeDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateLocationTypeBody, UpdateLocationTypeBody } from "./location-types.schema";

/**
 * `F4.162` (ADR 0077 Amendment 1) — the global-admin write path for
 * `bms.location_types`, the lookup table `F4.157` made of the location type.
 *
 * **The `AssetRolesAdminService` shape, with `PointKeysAdminService`'s
 * retirement verbs.** A code-keyed vocabulary with `label`, `sortOrder` and
 * `active`; retirement is `POST :code/deactivate` and `:code/reactivate`
 * rather than a `PATCH { active }` (plan D1), so the PATCH body carries only
 * `label` and `sortOrder`.
 *
 * **`fleetDb`, never `withTenant`.** `bms.location_types` has no
 * `organization_id` and no policy; `bms_fleet` holds SELECT and DML on it (the
 * owner ruling on the `F4.157` security review L1). The audit row is org-less
 * for the same reason — ADR 0043 Amendment 5 admits a NULL organization
 * `TO bms_fleet` only.
 *
 * **Every handler is global admin only, the read included.** Unlike
 * `AssetRolesAdminService.list`, this list carries a fleet-wide count of
 * `bms.locations` rows per type, which is a figure about every tenant's estate
 * (plan D2). The unchanged `GET /admin/location-types` still serves the active
 * `{ code, label }` rows to every master-data user.
 *
 * **What this service deliberately does NOT do** (ADR 0077 Amendment 1): no
 * delete (`locations.type` references the code with no `ON DELETE`), no
 * rename (`code` is the primary key), no refusal to deactivate a type still in
 * use (the locations keep their value; the dropdown stops offering it).
 * `VocabulariesService` reads are uncached, so a write needs no invalidation
 * here.
 */
@Injectable()
export class LocationTypesVocabularyAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Every type, active and retired, each with its fleet-wide location count. */
  async list(jwt: JwtPayload): Promise<{ items: AdminLocationTypeDto[] }> {
    await this.requireGlobalAdmin(jwt);
    return { items: await this.selectRows() };
  }

  /** Adds a type. A repeated code is a 409. */
  async create(jwt: JwtPayload, body: CreateLocationTypeBody): Promise<AdminLocationTypeDto> {
    await this.requireGlobalAdmin(jwt);

    await this.fleetDb.transaction(async (tx) => {
      try {
        await tx.insert(locationTypes).values({
          code: body.code,
          label: body.label,
          ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
          active: true,
        });
      } catch (err) {
        // `code` is the primary key: a repeat is the caller's error, not a 500.
        if (isUniqueViolation(err)) {
          throw new ConflictException(`Location type "${body.code}" already exists`);
        }
        throw err;
      }

      await this.audit.write(
        {
          actor: jwt,
          action: "master.location_type.create",
          entityType: "location_type",
          // `bms.audit_log.entity_id` is `uuid`; the code travels in `payload`.
          entityId: null,
          organizationId: null,
          payload: { ...body },
        },
        tx,
      );
    });

    return this.fetchRow(body.code);
  }

  /**
   * Renames or reorders a type. The 404 is decided before the empty-body 400,
   * and `.set(body)` writes only the fields the caller named — no
   * read-modify-write across the transaction boundary (the
   * `AssetRolesAdminService.update` reasoning).
   */
  async update(
    jwt: JwtPayload,
    code: string,
    body: UpdateLocationTypeBody,
  ): Promise<AdminLocationTypeDto> {
    await this.requireGlobalAdmin(jwt);
    await this.fetchRow(code);

    if (Object.keys(body).length === 0) {
      throw new BadRequestException("Send at least one of label or sortOrder");
    }

    await this.fleetDb.transaction(async (tx) => {
      await tx.update(locationTypes).set(body).where(eq(locationTypes.code, code));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.location_type.update",
          entityType: "location_type",
          entityId: null,
          organizationId: null,
          payload: { code, ...body },
        },
        tx,
      );
    });

    return this.fetchRow(code);
  }

  /** Retires a type: every dropdown stops offering it; locations keep it. */
  async deactivate(jwt: JwtPayload, code: string): Promise<AdminLocationTypeDto> {
    await this.requireGlobalAdmin(jwt);
    return this.setActive(jwt, code, false, "master.location_type.deactivate");
  }

  /** Restores a retired type to every dropdown. */
  async reactivate(jwt: JwtPayload, code: string): Promise<AdminLocationTypeDto> {
    await this.requireGlobalAdmin(jwt);
    return this.setActive(jwt, code, true, "master.location_type.reactivate");
  }

  private async setActive(
    jwt: JwtPayload,
    code: string,
    active: boolean,
    action: string,
  ): Promise<AdminLocationTypeDto> {
    await this.fetchRow(code);

    await this.fleetDb.transaction(async (tx) => {
      await tx.update(locationTypes).set({ active }).where(eq(locationTypes.code, code));
      await this.audit.write(
        {
          actor: jwt,
          action,
          entityType: "location_type",
          entityId: null,
          organizationId: null,
          payload: { code },
        },
        tx,
      );
    });

    return this.fetchRow(code);
  }

  /**
   * The only gate on this surface. `requireMasterDataUser` resolves the JWT to
   * a `bms.users` row and refuses `operator` and `viewer`; `isGlobalAdmin`
   * then refuses every tenant administrator, who would otherwise retire a type
   * for the whole fleet.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(
        "The location type vocabulary is fleet-wide master data — only a global administrator may manage it",
      );
    }
  }

  private async fetchRow(code: string): Promise<AdminLocationTypeDto> {
    const [row] = await this.selectRows(eq(locationTypes.code, code));
    if (!row) {
      throw new NotFoundException("Location type not found");
    }
    return row;
  }

  /**
   * Plan D2: `count(locations.id)` over `location_types LEFT JOIN locations`,
   * grouped by the primary key, on the fleet pool — which reads every
   * organization's `bms.locations` rows, so the count is fleet-wide. Every
   * location counts, inactive ones included (OQ4). `count(locations.id)`, not
   * `count(*)`: a type with no location has one NULL-extended row, which
   * `count(*)` would count as 1.
   */
  private async selectRows(where?: SQL): Promise<AdminLocationTypeDto[]> {
    const rows = await this.fleetDb
      .select({
        code: locationTypes.code,
        label: locationTypes.label,
        sortOrder: locationTypes.sortOrder,
        active: locationTypes.active,
        createdAt: locationTypes.createdAt,
        locationCount: sql<number>`count(${locations.id})::int`,
      })
      .from(locationTypes)
      .leftJoin(locations, eq(locations.type, locationTypes.code))
      .where(where)
      .groupBy(locationTypes.code)
      .orderBy(asc(locationTypes.sortOrder), asc(locationTypes.code));

    return rows.map((row) => ({
      code: row.code,
      label: row.label,
      sortOrder: row.sortOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      locationCount: Number(row.locationCount),
    }));
  }
}

/** A `23505` from anywhere below drizzle (`pg` puts the SQLSTATE on `code`). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}
