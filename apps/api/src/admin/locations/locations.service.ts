import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets, locationTypes, locations, organizations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdminLocationDto,
  AdminLocationSummaryDto,
  JwtPayload,
  LocationTypesListResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import {
  constraintOf,
  translateConstraintErrors,
} from "../../database/translate-constraint-errors";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { requestMetaForCreate, requestMetaForUpdate } from "./location-seed-key";
import type { CreateLocationBody, UpdateLocationBody } from "./locations.schema";
import {
  assertNoActiveChildren,
  assertParentPlacement,
  takeLocationTreeLock,
  treeGuardRefusal,
} from "./locations-tree-guards";

/** `F2.10` (ADR 0098 decision 12) — the 403 a move answers to anyone below the organization level. */
export const LOCATION_MOVE_FORBIDDEN = "Only an organization-level administrator may move a location";

/**
 * Runs a tree write and answers the tree-guard trigger's refusal with the
 * pre-check's exception (ADR 0098 Amendment 1, C): the trigger still fires
 * when a concurrent write changed the tree after the pre-check read it.
 */
async function mapTreeGuard<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw treeGuardRefusal(err) ?? err;
  }
}

/**
 * `F4.16` / ADR 0043 — `locations` is one of the five tables `F4.16` routes on
 * `fleetDb` (migration `0040`); Amendment 3 decision 2 grandfathers that
 * behaviour and asks only for the reason this comment now records. Reads run on
 * `fleetDb` because `writableLocationIds`/`canManageLocation` resolve to a
 * cross-organization union for a multi-org master-data admin — a single tenant
 * GUC cannot serve them, and decision 3 routes that case to the fleet pool
 * rather than looping one transaction per organization. The `WHERE` filter is
 * the isolation control the amendment trusts. Writes run inside
 * `withTenant(tenantDb, organizationId, …)`, which sets the RLS GUC to the
 * row's own organization before insert/update — the id is always known
 * before the write (from the request body, or from a fleet read already
 * authorized by `canManageLocation`).
 */
@Injectable()
export class LocationsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // `F4.157` (ADR 0077) — last, so the two pool slots
    // `fleet-read-wiring.spec.ts` pins stay at 0 and 1.
    private readonly vocabularies: VocabulariesService,
  ) {}

  /**
   * `F4.157` (ADR 0077, plan D3) — the active location types for the admin
   * form's Type select, behind the same gate as `list`.
   */
  async listLocationTypes(jwt: JwtPayload): Promise<LocationTypesListResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    return { items: await this.vocabularies.listLocationTypes() };
  }

  /** Lists locations scoped to the caller. */
  async list(
    jwt: JwtPayload,
    organizationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminLocationDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (organizationId) {
      conditions.push(eq(locations.organizationId, organizationId));
    }
    if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(locations.id, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(locations.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(locations.active, false));
    }

    const rows = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
        typeLabel: locationTypes.label,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(locationTypes, eq(locations.type, locationTypes.code))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(locations.name));

    // ADR 0098 Drafter choice 8 (Amendment 1): a parent outside the caller's
    // closure is named `null`. The set is the closure, not the rows returned,
    // so `activeOnly` never hides a parent the caller may read.
    const visible = writableIds === null ? null : new Set(writableIds);
    return { items: rows.map((row) => this.mapRow(row, visible)) };
  }

  /** Returns one location summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminLocationSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const [row] = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(locations.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return {
      id: row.location.id,
      code: row.location.code,
      name: row.location.name,
      organizationId: row.location.organizationId,
      organizationCode: row.organizationCode,
      organizationName: row.organizationName,
    };
  }

  /** Creates a location within the caller's writable scope. */
  async create(jwt: JwtPayload, body: CreateLocationBody): Promise<AdminLocationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot create new locations");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, body.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    if (typeof body.timezone === "string") {
      await this.assertKnownTimezone(body.timezone);
    }
    // `F4.157` (ADR 0077) — the request schema checks shape only; this names
    // the live codes in a 400 rather than letting `locations_type_fk` answer
    // a 500 (plan D11).
    await this.vocabularies.assertLocationType(body.type);

    const parentId = body.parentId ?? null;
    const insertRow = () => withTenant(this.tenantDb, body.organizationId, async (tx) => {
      // `F2.10` (ADR 0098 decision 5, Drafter choice 3): the organization's
      // tree lock first, so the placement read below holds until commit; the
      // parent is read `FOR SHARE` (Amendment 1, A5).
      await takeLocationTreeLock(tx, body.organizationId);
      if (parentId !== null) {
        await assertParentPlacement(tx, {
          organizationId: body.organizationId,
          nodeId: null,
          parentId,
          nodeActive: true,
        });
      }
      const [row] = await tx
        .insert(locations)
        .values({
          organizationId: body.organizationId,
          parentId,
          code: body.code,
          slug: body.slug,
          name: body.name,
          type: body.type,
          province: body.province ?? null,
          capital: body.capital ?? null,
          latitude: body.latitude,
          longitude: body.longitude,
          timezone: body.timezone ?? null,
          // Owner ruling 20: `meta.seedKey` is seed-owned; a request's is dropped.
          meta: requestMetaForCreate(body.meta),
          active: true,
        })
        .returning();

      // E7.1c (item D): folded into this transaction so the stamped
      // organizationId matches the GUC the strict WITH CHECK now demands.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.location.create",
          entityType: "location",
          entityId: row.id,
          organizationId: body.organizationId,
          // `F4.170` (compliance review B2): the stored `meta`, not the
          // caller's, as `assets.service.ts` does since `F4.139` — a request's
          // `seedKey` is dropped, and the audit row must not read as though it
          // landed.
          payload: { ...body, meta: row.meta },
        },
        tx,
      );
      return row;
    });
    // F4.211 — a taken code or slug is a 409 that names it, not a 500.
    const created = await mapTreeGuard(() =>
      translateConstraintErrors(insertRow, {
        onUnique: (err) => locationConflict(err, body.code, body.slug),
      }),
    );

    return this.fetchRow(jwt, created.id);
  }

  /** Updates a location in scope. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateLocationBody,
  ): Promise<AdminLocationDto> {
    await this.accessControl.requireMasterDataUser(jwt);

    // Scope first, before anything is read: an unknown id and an id in
    // another organization answer the same 403, so this path is no existence
    // oracle (the reason ADR 0098 Amendment 1 A3 dropped a cross-organization
    // reason code).
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const [existing] = await this.fleetDb
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }
    // `F2.10` (ADR 0098 decision 12): `PATCH :id { parentId }` is the move, and
    // only an organization-level administrator of the node's organization
    // makes it. Any body that names `parentId` is refused below that level,
    // whatever the value: comparing it with the stored parent first would
    // answer differently for the real parent, and a location admin's granted
    // node may have a parent it cannot read (Drafter choice 8). A client
    // below the organization level omits `parentId`.
    if (body.parentId !== undefined && !(await this.accessControl.isOrganizationLevelAdmin(jwt, existing.organizationId))) {
      throw new ForbiddenException(LOCATION_MOVE_FORBIDDEN);
    }
    const isMove = body.parentId !== undefined && body.parentId !== existing.parentId;
    if (typeof body.timezone === "string") {
      await this.assertKnownTimezone(body.timezone);
    }
    // `F4.157` — only a type the patch names is checked: an existing row keeps
    // the type it has, even one retired since it was written.
    if (body.type !== undefined) {
      await this.vocabularies.assertLocationType(body.type);
    }

    const nextCode = body.code ?? existing.code;
    const nextSlug = body.slug ?? existing.slug;
    const updateRow = () => withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      // `F4.170` (security review Low-B): `meta` is read again here, locked,
      // not taken from `existing`. `existing` is a fleet read made before this
      // transaction, so a key the seed writes in between (a first keyed boot)
      // would be written away by a `meta` built from it.
      //
      // `F2.10`: the tree lock comes first, so the parent and active state
      // read here and checked below hold until commit; `fromParentId` is the
      // locked row's, not the fleet read's.
      await takeLocationTreeLock(tx, existing.organizationId);
      const [locked] = await tx
        .select({ meta: locations.meta, parentId: locations.parentId, active: locations.active })
        .from(locations)
        .where(eq(locations.id, id))
        .for("update");
      if (!locked) {
        throw new NotFoundException("Location not found");
      }
      const moving = isMove && body.parentId !== locked.parentId;
      const toParentId = moving ? (body.parentId ?? null) : locked.parentId;
      if (moving && toParentId !== null) {
        await assertParentPlacement(tx, {
          organizationId: existing.organizationId,
          nodeId: id,
          parentId: toParentId,
          nodeActive: locked.active,
        });
      }
      const [written] = await tx
        .update(locations)
        .set({
          parentId: toParentId,
          code: nextCode,
          slug: nextSlug,
          name: body.name ?? existing.name,
          type: body.type ?? existing.type,
          province: body.province !== undefined ? body.province : existing.province,
          capital: body.capital !== undefined ? body.capital : existing.capital,
          latitude: body.latitude ?? existing.latitude,
          longitude: body.longitude ?? existing.longitude,
          timezone: body.timezone !== undefined ? body.timezone : existing.timezone,
          // Owner ruling 20: a `meta` that replaces the stored one keeps the
          // stored `seedKey` and never takes one from the request.
          meta: body.meta !== undefined ? requestMetaForUpdate(body.meta, locked.meta) : locked.meta,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, id))
        .returning({ meta: locations.meta });

      // `F2.10` (ADR 0098 decision 12): a move is its own audit row. The
      // update row is written as before for every PATCH that is not a move,
      // and for a move that also changes another field.
      if (moving) {
        await this.audit.write(
          {
            actor: jwt,
            action: "master.location.move",
            entityType: "location",
            entityId: id,
            organizationId: existing.organizationId,
            payload: { fromParentId: locked.parentId, toParentId },
          },
          tx,
        );
      }
      const { parentId: _parentId, ...otherFields } = body;
      if (!isMove || Object.keys(otherFields).length > 0) {
        const fields = isMove ? otherFields : body;
        await this.audit.write(
          {
            actor: jwt,
            action: "master.location.update",
            entityType: "location",
            entityId: id,
            organizationId: existing.organizationId,
            // `F4.170` (compliance review B2): a PATCH that sends `meta` is
            // audited with the `meta` stored — the row's own `seedKey` included,
            // the request's never — as the create is.
            payload: body.meta !== undefined ? { ...fields, meta: written?.meta ?? null } : fields,
          },
          tx,
        );
      }
    });
    // F4.211 — a taken code or slug is a 409 that names it, not a 500.
    await mapTreeGuard(() =>
      translateConstraintErrors(updateRow, {
        onUnique: (err) => locationConflict(err, nextCode, nextSlug),
      }),
    );
    return this.fetchRow(jwt, id);
  }

  /**
   * Deactivates a location when no active child, RTU or asset remains.
   *
   * `F2.10` (ADR 0098 decision 5 (d), Amendment 1 A5): one transaction that
   * locks the row `FOR UPDATE` **before** it counts. Before `F2.10` the counts
   * ran in one transaction and the update in a second, so an asset created
   * between the two landed on a location that was then retired; now a writer
   * that holds the row (the `FOR SHARE` read of an asset or RTU create) is
   * waited for, and the counts see what it committed.
   */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminLocationDto> {
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [existing] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }

    // E7.1b: `rtus` and `assets` are FORCE-policied as of 0047, so these guard
    // counts must run inside the location's org GUC — on the bare tenant pool
    // with no `SET LOCAL` they return 0 and the guard never fires, deactivating a
    // location that still has active RTUs or assets. `rtus.service.deactivate`
    // counts inside its own GUC for the same reason; this matches it.
    await mapTreeGuard(() =>
      withTenant(this.tenantDb, existing.organizationId, async (tx) => {
        await takeLocationTreeLock(tx, existing.organizationId);
        const [locked] = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.id, id))
          .for("update");
        if (!locked) {
          throw new NotFoundException("Location not found");
        }
        await assertNoActiveChildren(tx, id, existing.organizationId);

        const [activeRtu] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(rtus)
          .where(and(eq(rtus.locationId, id), eq(rtus.active, true)))
          .limit(1);
        const [activeAsset] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(assets)
          .where(and(eq(assets.locationId, id), eq(assets.active, true)))
          .limit(1);
        if ((activeRtu?.count ?? 0) > 0 || (activeAsset?.count ?? 0) > 0) {
          throw new ConflictException("Cannot deactivate location with active RTUs or assets");
        }

        await tx
          .update(locations)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(locations.id, id));

        await this.audit.write(
          {
            actor: jwt,
            action: "master.location.deactivate",
            entityType: "location",
            entityId: id,
            organizationId: existing.organizationId,
          },
          tx,
        );
      }),
    );
    return this.fetchRow(jwt, id);
  }

  /**
   * Reactivates a location. `F2.10` (ADR 0098 decision 5 (b)): under an
   * inactive parent it is 409 `location_parent_inactive`; the parent is read
   * `FOR SHARE` after the organization's tree lock (Amendment 1, A5).
   */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminLocationDto> {
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [existing] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }

    await mapTreeGuard(() =>
      withTenant(this.tenantDb, existing.organizationId, async (tx) => {
        await takeLocationTreeLock(tx, existing.organizationId);
        const [locked] = await tx
          .select({ parentId: locations.parentId })
          .from(locations)
          .where(eq(locations.id, id))
          .for("update");
        if (!locked) {
          throw new NotFoundException("Location not found");
        }
        if (locked.parentId !== null) {
          await assertParentPlacement(tx, {
            organizationId: existing.organizationId,
            nodeId: id,
            parentId: locked.parentId,
            nodeActive: true,
          });
        }

        await tx
          .update(locations)
          .set({ active: true, updatedAt: new Date() })
          .where(eq(locations.id, id));

        await this.audit.write(
          {
            actor: jwt,
            action: "master.location.reactivate",
            entityType: "location",
            entityId: id,
            organizationId: existing.organizationId,
          },
          tx,
        );
      }),
    );
    return this.fetchRow(jwt, id);
  }

  /**
   * E4.1b / ADR 0070 decision 6 (plan design decision 13, rulings Q14 and
   * review Q1) — the zone must be an EXACT, case-sensitive
   * `pg_timezone_names.name` that is a region/city (or `Etc/…`) zone — never
   * a bare abbreviation or a tzdata artefact. `pg_timezone_names` also lists
   * 46 slash-less names (`EST`, `Factory`, `posixrules`, `Zulu`, …): `EST` is
   * a fixed −05:00 with no DST, the silent wrong hour the 0075 header
   * forbids, and `IST` is ambiguous (India, Israel, Ireland). `LIKE '%/%'`
   * keeps the place names; `posix/` and `right/` are the legacy tzdata
   * duplicates a host may ship (0 on the compose image today). Two exact
   * names can still alias one zone (`Asia/Calcutta`, `Asia/Kolkata`) — both
   * pass; the engine reads either. Not a CHECK — a constraint cannot
   * reference a view. Runs on the fleet connection (a catalog view; no tenant
   * row is read) and BEFORE any write, so a refusal inserts nothing rather
   * than rolling something back. Measured 599 rows, 70 ms — admin-rate.
   */
  private async assertKnownTimezone(tz: string): Promise<void> {
    const found = await this.fleetDb.execute(
      sql`SELECT 1 FROM pg_timezone_names
           WHERE name = ${tz}
             AND name LIKE '%/%'
             AND name NOT LIKE 'posix/%'
             AND name NOT LIKE 'right/%'`,
    );
    if (found.rows.length === 0) {
      throw new BadRequestException(
        "timezone must be an IANA zone name the database knows — for example " +
          `Asia/Kolkata or Africa/Johannesburg — and "${tz}" is not one`,
      );
    }
  }

  /**
   * One row as the caller sees it after a write. The parent is hidden by the
   * caller's own closure (ADR 0098 Drafter choice 8, Amendment 1): a
   * `location_admin` editing its granted node is not told the node above.
   */
  private async fetchRow(jwt: JwtPayload, id: string): Promise<AdminLocationDto> {
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const [row] = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
        typeLabel: locationTypes.label,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .leftJoin(locationTypes, eq(locations.type, locationTypes.code))
      .where(eq(locations.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return this.mapRow(row, writableIds === null ? null : new Set(writableIds));
  }

  /**
   * `visible` is the set of location ids the caller may read, or `null` for
   * every id; a `parentId` outside it is answered `null`, as `/auth/me` does.
   */
  private mapRow(row: {
    location: typeof locations.$inferSelect;
    organizationCode: string;
    organizationName: string;
    // A LEFT JOIN types this nullable even though the FK makes the null arm
    // unreachable in practice (F4.162, ADR 0077 Amendment 1, plan D3).
    typeLabel: string | null;
  }, visible: ReadonlySet<string> | null): AdminLocationDto {
    const loc = row.location;
    return {
      id: loc.id,
      organizationId: loc.organizationId,
      organizationCode: row.organizationCode,
      organizationName: row.organizationName,
      code: loc.code,
      slug: loc.slug,
      name: loc.name,
      type: loc.type,
      typeLabel: row.typeLabel ?? loc.type,
      parentId:
        loc.parentId !== null && (visible === null || visible.has(loc.parentId)) ? loc.parentId : null,
      province: loc.province,
      capital: loc.capital,
      timezone: loc.timezone,
      latitude: loc.latitude,
      longitude: loc.longitude,
      active: loc.active,
      meta: (loc.meta as Record<string, unknown> | null) ?? null,
      createdAt: loc.createdAt.toISOString(),
      updatedAt: loc.updatedAt.toISOString(),
    };
  }
}

/**
 * `F4.211` — which of the two unique keys a location write took. The slug is
 * unique across the fleet (`locations_slug_unique`), so its sentence names no
 * organization; the code is unique per organization (`locations_org_code_idx`).
 */
function locationConflict(err: unknown, code: string, slug: string): ConflictException {
  if (constraintOf(err) === "locations_slug_unique") {
    return new ConflictException(`A location with slug "${slug}" already exists`);
  }
  return new ConflictException(`A location with code "${code}" already exists in this organization`);
}
