import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import {
  assetGroups,
  locations,
  organizations,
  userAssetGroupAccess,
  userLocationAccess,
  userOrganizationAccess,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import { addUserGrantBodySchema, userGrantKindSchema } from "@bms/shared";
import type { JwtPayload, UserGrantDto, UserGrantKind, UserGrantsResponse } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { selectReadScopeSourceFor } from "../../auth/access-scope-sources";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";
import { canManageTarget } from "./user-management-rules";
import { UsersService, type Manager, type UserRow } from "./users.service";

/**
 * `F3.78` / ADR 0089 decisions 2, 10, 11, 12, 14 and plan D2 — the grants API:
 * `GET`/`POST /admin/users/:id/grants`,
 * `DELETE /admin/users/:id/grants/:kind/:grantId`.
 *
 * **The user check is U5's**, not a copy: {@link UsersService.requireManager}
 * (the database row's role, never `jwt.role`) and
 * {@link UsersService.requireManageableTarget} (`canManageTarget`, a C1 or
 * `admin` target is the same 404 as a nonexistent id).
 *
 * **The grant target's organization is read on `fleetDb`** —
 * `locations.organization_id` for a location, `asset_groups.organization_id`
 * for a group, the organization itself for an organization grant — and that
 * one value is **both** ADR 0066 Amendment 2's L-1 organization re-check and
 * the `withTenant` GUC of the write (decision 10: the grant target's
 * organization, never the user's home organization). `0098`'s policies on
 * `user_location_access` / `user_asset_group_access` and `0040`'s on
 * `user_organization_access` then refuse, with `42501`, an insert whose
 * target is not in that organization.
 *
 * **Rules, in order:** target scope (`canManageOrganization` for an
 * organization, `canManageLocation` for a location or a group's location; out
 * of scope is the missing-target 404); **any grant whose target organization
 * differs from the user's home organization is `admin`-only, for all three
 * kinds and on remove as on add** (an `organization_admin` holding two
 * organizations must not widen a user across them through a location or group
 * grant — the C1 class); the new grant must not take the user's reach outside
 * the caller's organizations (fail-closed; with the two rules before it this
 * cannot fire for an `organization_admin` today, and it stays so that a change
 * to either cannot widen a user silently).
 *
 * **Duplicates** are 409s from the existing unique indexes, named from the
 * migrations and checked against `pg_indexes`:
 * `user_organization_access_user_org_unique` (`0018`),
 * `user_location_access_user_location_idx` and
 * `user_asset_group_access_user_group_idx` (`0010`).
 *
 * Grants touch only the database, so local auth mode and unlinked users are
 * served (decision 11). Reads run on `fleetDb`.
 */

export const GRANT_TARGET_NOT_FOUND = "Grant target not found";
export const GRANT_NOT_FOUND = "Grant not found";
export const CROSS_ORGANIZATION_GRANT_ADMIN_ONLY =
  "A grant outside the user's home organization can only be changed by an admin";
export const GRANT_REACH_OUT_OF_SCOPE = "The grant would take the user outside your organizations";
export const DUPLICATE_GRANT = "The user already has this grant";
export const GRANT_TARGET_CHANGED = "The grant target changed under you; reload and try again";

/** Postgres's answer to a row-level-security `WITH CHECK` refusal. */
const INSUFFICIENT_PRIVILEGE = "42501";

/** What a grant names, read on `fleetDb`. `locationId` is what `canManageLocation` checks; `null` for an organization. */
type GrantTarget = { readonly organizationId: string; readonly locationId: string | null };

type RawGrantRow = {
  id: string;
  kind: UserGrantKind;
  target_id: string;
  target_name: string;
  organization_id: string;
  created_at: Date | string;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

@Injectable()
export class UserGrantsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly users: UsersService,
  ) {}

  /** `GET /admin/users/:id/grants`. */
  async list(jwt: JwtPayload, userId: string): Promise<UserGrantsResponse> {
    const manager = await this.users.requireManager(jwt);
    const target = await this.users.requireManageableTarget(manager, userId);
    return this.grantsOf(target);
  }

  /** `POST /admin/users/:id/grants`. */
  async add(jwt: JwtPayload, userId: string, rawBody: unknown): Promise<UserGrantsResponse> {
    const manager = await this.users.requireManager(jwt);
    const parsed = addUserGrantBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { kind, targetId } = parsed.data;
    const user = await this.users.requireManageableTarget(manager, userId);

    const grantTarget = await this.readGrantTarget(kind, targetId);
    if (grantTarget === null || !(await this.inCallerScope(jwt, kind, targetId, grantTarget))) {
      throw new NotFoundException(GRANT_TARGET_NOT_FOUND);
    }
    this.assertCrossOrganizationRule(manager, user, grantTarget.organizationId);
    await this.assertReachStaysInScope(manager, user, grantTarget.organizationId);

    await translateConstraintErrors(
      () =>
        this.inGrantOrganization(grantTarget.organizationId, async (tx) => {
          const grantId = await insertGrant(tx, kind, userId, targetId);
          await this.audit.write(
            {
              actor: jwt,
              action: "master.user_grant.add",
              entityType: "user_grant",
              entityId: grantId,
              organizationId: grantTarget.organizationId,
              payload: { userId, kind, targetId },
            },
            tx as unknown as BmsDb,
          );
        }),
      {
        onUnique: () => new ConflictException(DUPLICATE_GRANT),
        // The user or the target was deleted between the read and the write.
        onForeignKey: () => new NotFoundException(GRANT_TARGET_NOT_FOUND),
      },
    );
    return this.grantsOf(user);
  }

  /** `DELETE /admin/users/:id/grants/:kind/:grantId`. */
  async remove(jwt: JwtPayload, userId: string, rawKind: string, grantId: string): Promise<UserGrantsResponse> {
    const manager = await this.users.requireManager(jwt);
    const kindResult = userGrantKindSchema.safeParse(rawKind);
    if (!kindResult.success) {
      throw new BadRequestException("kind must be organization, location or asset_group");
    }
    const kind = kindResult.data;
    const user = await this.users.requireManageableTarget(manager, userId);

    const grant = await this.readGrant(kind, grantId, userId);
    if (grant === null || !(await this.inCallerScope(jwt, kind, grant.targetId, grant))) {
      throw new NotFoundException(GRANT_NOT_FOUND);
    }
    this.assertCrossOrganizationRule(manager, user, grant.organizationId);

    await this.inGrantOrganization(grant.organizationId, async (tx) => {
      const deleted = await deleteGrant(tx, kind, grantId, userId);
      if (deleted === 0) {
        // Under FORCE a GUC that no longer matches the grant's target deletes zero rows and raises nothing.
        throw new NotFoundException(GRANT_NOT_FOUND);
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.user_grant.remove",
          entityType: "user_grant",
          entityId: grantId,
          organizationId: grant.organizationId,
          payload: { userId, kind, targetId: grant.targetId },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.grantsOf(user);
  }

  // -- Helpers --------------------------------------------------------------

  /**
   * Every grant of `user`, with `effective` per plan D2: the grant's kind
   * equals the source `selectReadScopeSourceFor` selects for the user's role —
   * the selected source, not the role's list, because `operator`/`viewer`
   * read only the first source that yields.
   */
  private async grantsOf(user: UserRow): Promise<UserGrantsResponse> {
    const result = await this.fleetDb.execute(sql`
      SELECT a.id, 'organization' AS kind, o.id AS target_id, o.name AS target_name,
             o.id AS organization_id, a.created_at
        FROM bms.user_organization_access a JOIN bms.organizations o ON o.id = a.organization_id
       WHERE a.user_id = ${user.id}
      UNION ALL
      SELECT a.id, 'location' AS kind, l.id, l.name, l.organization_id, a.created_at
        FROM bms.user_location_access a JOIN bms.locations l ON l.id = a.location_id
       WHERE a.user_id = ${user.id}
      UNION ALL
      SELECT a.id, 'asset_group' AS kind, g.id, g.name, g.organization_id, a.created_at
        FROM bms.user_asset_group_access a JOIN bms.asset_groups g ON g.id = a.asset_group_id
       WHERE a.user_id = ${user.id}
      ORDER BY kind, target_name
    `);
    const source = await selectReadScopeSourceFor(this.fleetDb, { id: user.id, role: user.role });
    return {
      items: rowsOf<RawGrantRow>(result).map(
        (row): UserGrantDto => ({
          id: row.id,
          kind: row.kind,
          targetId: row.target_id,
          targetName: row.target_name,
          organizationId: row.organization_id,
          effective: row.kind === source,
          createdAt: new Date(row.created_at).toISOString(),
        }),
      ),
    };
  }

  /** The grant target's organization (and location), read on `fleetDb`; `null` when it does not exist. */
  private async readGrantTarget(kind: UserGrantKind, targetId: string): Promise<GrantTarget | null> {
    if (kind === "organization") {
      const [row] = await this.fleetDb
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, targetId))
        .limit(1);
      return row ? { organizationId: row.id, locationId: null } : null;
    }
    if (kind === "location") {
      const [row] = await this.fleetDb
        .select({ organizationId: locations.organizationId })
        .from(locations)
        .where(eq(locations.id, targetId))
        .limit(1);
      return row ? { organizationId: row.organizationId, locationId: targetId } : null;
    }
    const [row] = await this.fleetDb
      .select({ organizationId: assetGroups.organizationId, locationId: assetGroups.locationId })
      .from(assetGroups)
      .where(eq(assetGroups.id, targetId))
      .limit(1);
    return row ? { organizationId: row.organizationId, locationId: row.locationId } : null;
  }

  /** The grant `grantId` of `userId` in `kind`'s table, with its target's organization; `null` for another user's id. */
  private async readGrant(
    kind: UserGrantKind,
    grantId: string,
    userId: string,
  ): Promise<(GrantTarget & { readonly targetId: string }) | null> {
    if (kind === "organization") {
      const [row] = await this.fleetDb
        .select({ targetId: userOrganizationAccess.organizationId })
        .from(userOrganizationAccess)
        .where(and(eq(userOrganizationAccess.id, grantId), eq(userOrganizationAccess.userId, userId)))
        .limit(1);
      return row ? { targetId: row.targetId, organizationId: row.targetId, locationId: null } : null;
    }
    if (kind === "location") {
      const [row] = await this.fleetDb
        .select({ targetId: userLocationAccess.locationId, organizationId: locations.organizationId })
        .from(userLocationAccess)
        .innerJoin(locations, eq(locations.id, userLocationAccess.locationId))
        .where(and(eq(userLocationAccess.id, grantId), eq(userLocationAccess.userId, userId)))
        .limit(1);
      return row ? { targetId: row.targetId, organizationId: row.organizationId, locationId: row.targetId } : null;
    }
    const [row] = await this.fleetDb
      .select({
        targetId: userAssetGroupAccess.assetGroupId,
        organizationId: assetGroups.organizationId,
        locationId: assetGroups.locationId,
      })
      .from(userAssetGroupAccess)
      .innerJoin(assetGroups, eq(assetGroups.id, userAssetGroupAccess.assetGroupId))
      .where(and(eq(userAssetGroupAccess.id, grantId), eq(userAssetGroupAccess.userId, userId)))
      .limit(1);
    return row ? { targetId: row.targetId, organizationId: row.organizationId, locationId: row.locationId } : null;
  }

  /** Target scope: `canManageOrganization` for an organization, `canManageLocation` for a location or a group's location. */
  private async inCallerScope(jwt: JwtPayload, kind: UserGrantKind, targetId: string, target: GrantTarget): Promise<boolean> {
    if (kind === "organization") {
      return this.accessControl.canManageOrganization(jwt, targetId);
    }
    return target.locationId !== null && this.accessControl.canManageLocation(jwt, target.locationId);
  }

  /** Any grant whose target organization is not the user's home organization is `admin`-only, for all three kinds. */
  private assertCrossOrganizationRule(manager: Manager, user: UserRow, grantOrganizationId: string): void {
    if (manager.role !== "admin" && grantOrganizationId !== user.organizationId) {
      throw new ForbiddenException(CROSS_ORGANIZATION_GRANT_ADMIN_ONLY);
    }
  }

  /** The user's reach with the new grant must stay inside the caller's organizations (decision 12). */
  private async assertReachStaysInScope(manager: Manager, user: UserRow, grantOrganizationId: string): Promise<void> {
    if (manager.role === "admin") {
      return;
    }
    const current = await this.users.reachOf(user.id);
    const allowed = canManageTarget(manager.role, manager.writable, {
      role: user.role,
      homeOrganizationId: user.organizationId,
      grantOrganizationIds: [...current, grantOrganizationId],
    });
    if (!allowed) {
      throw new ForbiddenException(GRANT_REACH_OUT_OF_SCOPE);
    }
  }

  /**
   * The write, in `withTenant` of the grant target's organization. A
   * `WITH CHECK` refusal (`42501`) means the target is no longer in that
   * organization: a 409 that names nothing; the audit row rolled back with it.
   */
  private async inGrantOrganization<T>(organizationId: string, fn: (tx: BmsTx) => Promise<T>): Promise<T> {
    try {
      return await withTenant(this.tenantDb, organizationId, fn);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === INSUFFICIENT_PRIVILEGE) {
        throw new ConflictException(GRANT_TARGET_CHANGED);
      }
      throw err;
    }
  }
}

/** The grant insert; returns the new grant's id. */
async function insertGrant(tx: BmsTx, kind: UserGrantKind, userId: string, targetId: string): Promise<string> {
  const rows =
    kind === "organization"
      ? await tx
          .insert(userOrganizationAccess)
          .values({ userId, organizationId: targetId })
          .returning({ id: userOrganizationAccess.id })
      : kind === "location"
        ? await tx
            .insert(userLocationAccess)
            .values({ userId, locationId: targetId })
            .returning({ id: userLocationAccess.id })
        : await tx
            .insert(userAssetGroupAccess)
            .values({ userId, assetGroupId: targetId })
            .returning({ id: userAssetGroupAccess.id });
  const [row] = rows;
  if (!row) {
    throw new ConflictException(GRANT_TARGET_CHANGED);
  }
  return row.id;
}

/** The grant delete, keyed by both the grant id and the user; returns the number of rows deleted. */
async function deleteGrant(tx: BmsTx, kind: UserGrantKind, grantId: string, userId: string): Promise<number> {
  const rows =
    kind === "organization"
      ? await tx
          .delete(userOrganizationAccess)
          .where(and(eq(userOrganizationAccess.id, grantId), eq(userOrganizationAccess.userId, userId)))
          .returning({ id: userOrganizationAccess.id })
      : kind === "location"
        ? await tx
            .delete(userLocationAccess)
            .where(and(eq(userLocationAccess.id, grantId), eq(userLocationAccess.userId, userId)))
            .returning({ id: userLocationAccess.id })
        : await tx
            .delete(userAssetGroupAccess)
            .where(and(eq(userAssetGroupAccess.id, grantId), eq(userAssetGroupAccess.userId, userId)))
            .returning({ id: userAssetGroupAccess.id });
  return rows.length;
}
