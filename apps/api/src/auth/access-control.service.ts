import { Inject, Injectable, ForbiddenException } from "@nestjs/common";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import {
  assetGroupMembers,
  assetGroups,
  assets,
  locations,
  userAssetGroupAccess,
  userLocationAccess,
  userOrganizationAccess,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AccessibleScope,
  CurrentUserResponse,
  JwtPayload,
  UserRole,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import {
  noAccessScope,
  type ReadScopeSource,
  isMasterDataRole,
  readScopeSourcesForRole,
} from "./access-scope";
import {
  canPerformOperationsWrite,
  operationsWriteDenialReason,
  type OperationsWriteClass,
} from "./operations-write";

type DbUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

@Injectable()
export class AccessControlService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Returns the app user and DB-backed accessible scope for the JWT subject. */
  async currentUser(jwt: JwtPayload): Promise<CurrentUserResponse> {
    const user = await this.resolveDbUser(jwt);
    const scope = await this.scopeForUser(user);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      scope,
    };
  }

  /** Returns asset ids readable by the user; `null` means unrestricted admin. */
  async readableAssetIds(jwt: JwtPayload): Promise<string[] | null> {
    const user = await this.resolveDbUser(jwt);
    if (user.role === "admin") {
      return null;
    }
    const scope = await this.scopeForUser(user);
    return scope.assetIds;
  }

  /** Checks whether a user can read the requested asset id. */
  async canReadAsset(jwt: JwtPayload, assetId: string): Promise<boolean> {
    const ids = await this.readableAssetIds(jwt);
    return ids === null || ids.includes(assetId);
  }

  /** Ensures the user may access master-data admin endpoints. */
  assertMasterDataRole(role: UserRole): void {
    if (!isMasterDataRole(role)) {
      throw new ForbiddenException(
        "Master data administration requires admin, organization_admin, or location_admin role",
      );
    }
  }

  /**
   * Ensures the user may perform this class of operations write (ADR 0017).
   *
   * Call this BEFORE the asset-scope check in every mutating handler, so a
   * role rejection never depends on scope resolution and can never be confused
   * with "no readable assets". Before this gate existed, an empty read scope
   * was the only thing stopping `operator` and `viewer` from writing — read
   * scope doing authorization work it was never designed to do.
   *
   * The gate is additive: callers must pass this AND the existing scope check.
   */
  async assertOperationsWriteRole(
    jwt: JwtPayload,
    writeClass: OperationsWriteClass,
  ): Promise<void> {
    // Resolve the role from bms.users, NOT from the JWT claim. Every other
    // authorization decision in this service (assertMasterDataRole via
    // requireMasterDataUser, readableAssetIds) reads the DB role, and the two
    // sources drift: a token outlives a demotion by up to JWT_TTL (8h), and in
    // OIDC mode roleFromClaims falls back to "viewer" when realm roles are
    // missing. Reading a different authority here would make the gate
    // fail-open on demotion and fail-closed on a claimless admin token.
    const user = await this.resolveDbUser(jwt);
    if (!canPerformOperationsWrite(user.role, writeClass)) {
      throw new ForbiddenException(operationsWriteDenialReason(writeClass));
    }
  }

  /** Ensures the user may mutate organization records. */
  assertAdminRole(role: UserRole): void {
    if (role !== "admin") {
      throw new ForbiddenException("Organization administration requires global admin role");
    }
  }

  /** Organization ids the user may manage; `null` means unrestricted (global admin). */
  async writableOrganizationIds(jwt: JwtPayload): Promise<string[] | null> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return null;
    }
    if (user.role === "organization_admin") {
      const rows = await this.db
        .select({ id: userOrganizationAccess.organizationId })
        .from(userOrganizationAccess)
        .where(eq(userOrganizationAccess.userId, user.id));
      return rows.map((row) => row.id);
    }
    const locationRows = await this.db
      .select({ organizationId: locations.organizationId })
      .from(userLocationAccess)
      .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
      .where(eq(userLocationAccess.userId, user.id));
    return [...new Set(locationRows.map((row) => row.organizationId))];
  }

  /** Whether the user may read or manage the given organization. */
  async canManageOrganization(jwt: JwtPayload, organizationId: string): Promise<boolean> {
    const ids = await this.writableOrganizationIds(jwt);
    return ids === null || ids.includes(organizationId);
  }

  /** Location ids the user may manage; `null` means unrestricted (global admin). */
  async writableLocationIds(jwt: JwtPayload): Promise<string[] | null> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return null;
    }
    if (user.role === "organization_admin") {
      const orgIds = await this.writableOrganizationIds(jwt);
      if (orgIds === null || orgIds.length === 0) {
        return orgIds ?? [];
      }
      const rows = await this.db
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.organizationId, orgIds));
      return rows.map((row) => row.id);
    }
    const rows = await this.db
      .select({ id: locations.id })
      .from(userLocationAccess)
      .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
      .where(eq(userLocationAccess.userId, user.id));
    return rows.map((row) => row.id);
  }

  /** Whether the user may manage the given location. */
  async canManageLocation(jwt: JwtPayload, locationId: string): Promise<boolean> {
    const ids = await this.writableLocationIds(jwt);
    return ids === null || ids.includes(locationId);
  }

  /** Whether the user may manage point keys for the given organization. */
  async canManagePointKey(jwt: JwtPayload, organizationId: string): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return true;
    }
    if (user.role === "organization_admin") {
      return this.canManageOrganization(jwt, organizationId);
    }
    return false;
  }

  /**
   * Whether the user may author asset templates for the given organization
   * (ADR 0015 §7).
   *
   * Templates are org-scoped master data, so this delegates to the same rule as
   * `canManagePointKey` — `location_admin` is excluded, because authoring a
   * template is an organization-wide act. It is a separate method rather than a
   * reuse of `canManagePointKey` so that a later divergence in template policy
   * cannot silently change point-key policy.
   *
   * Note the deliberate asymmetry with *instantiation*, which requires this
   * check on the template's org AND `canManageLocation` on the target: a
   * location admin may deploy a published org template into their own location
   * without being able to author one. That is model-once-deploy-many.
   */
  async canManageTemplate(jwt: JwtPayload, organizationId: string): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return true;
    }
    if (user.role === "organization_admin") {
      return this.canManageOrganization(jwt, organizationId);
    }
    return false;
  }

  /** Whether the user may manage the given asset (via its location). */
  async canManageAsset(jwt: JwtPayload, assetId: string): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return true;
    }
    const [row] = await this.db
      .select({ locationId: assets.locationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!row?.locationId) {
      return false;
    }
    return this.canManageLocation(jwt, row.locationId);
  }

  /** Resolves the DB user and enforces master-data role in one step. */
  async requireMasterDataUser(jwt: JwtPayload): Promise<DbUser> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    return user;
  }

  private async resolveDbUser(jwt: JwtPayload): Promise<DbUser> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);

    if (row) {
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: row.role as UserRole,
      };
    }

    return {
      id: jwt.sub,
      email: jwt.email,
      displayName: jwt.name,
      role: jwt.role,
    };
  }

  /**
   * Resolves the read scope for a user by walking the grant sources their role
   * allows, in precedence order. The first source that yields any location or
   * asset wins; if none does, the last source's (empty) scope is returned so
   * read-only roles without grants fail closed on `kind: "none"`.
   */
  private async scopeForUser(user: DbUser): Promise<AccessibleScope> {
    let scope: AccessibleScope = noAccessScope();
    for (const source of readScopeSourcesForRole(user.role)) {
      scope = await this.scopeFromSource(user, source);
      if (scope.assetIds.length > 0 || scope.locations.length > 0) {
        break;
      }
    }
    return scope;
  }

  private async scopeFromSource(
    user: DbUser,
    source: ReadScopeSource,
  ): Promise<AccessibleScope> {
    if (source === "global") {
      const [locationRows, assetRows] = await Promise.all([
        this.db
          .select({
            id: locations.id,
            code: locations.code,
            slug: locations.slug,
            name: locations.name,
            type: locations.type,
            province: locations.province,
          })
          .from(locations)
          .where(eq(locations.active, true))
          .orderBy(asc(locations.name)),
        this.db.select({ id: assets.id }).from(assets),
      ]);
      return {
        kind: "global",
        locations: locationRows.map((row) => ({
          ...row,
          type: row.type as AccessibleScope["locations"][number]["type"],
        })),
        assetGroups: [],
        assetIds: assetRows.map((row) => row.id),
      };
    }

    if (source === "organization") {
      const orgIds = await this.db
        .select({ organizationId: userOrganizationAccess.organizationId })
        .from(userOrganizationAccess)
        .where(eq(userOrganizationAccess.userId, user.id));
      const organizationIds = orgIds.map((row) => row.organizationId);
      const locationRows =
        organizationIds.length > 0
          ? await this.db
              .select({
                id: locations.id,
                code: locations.code,
                slug: locations.slug,
                name: locations.name,
                type: locations.type,
                province: locations.province,
              })
              .from(locations)
              .where(
                and(
                  inArray(locations.organizationId, organizationIds),
                  eq(locations.active, true),
                ),
              )
              .orderBy(asc(locations.name))
          : [];
      const locationIds = locationRows.map((row) => row.id);
      const assetRows =
        locationIds.length > 0
          ? await this.db
              .select({ id: assets.id })
              .from(assets)
              .where(inArray(assets.locationId, locationIds))
          : [];
      return {
        kind: "location",
        locations: locationRows.map((row) => ({
          ...row,
          type: row.type as AccessibleScope["locations"][number]["type"],
        })),
        assetGroups: [],
        assetIds: assetRows.map((row) => row.id),
      };
    }

    if (source === "location") {
      const locationRows = await this.db
        .select({
          id: locations.id,
          code: locations.code,
          slug: locations.slug,
          name: locations.name,
          type: locations.type,
          province: locations.province,
        })
        .from(userLocationAccess)
        .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
        .where(
          and(
            eq(userLocationAccess.userId, user.id),
            eq(locations.active, true),
          ),
        )
        .orderBy(asc(locations.name));
      const locationIds = locationRows.map((row) => row.id);
      const assetRows =
        locationIds.length > 0
          ? await this.db
              .select({ id: assets.id })
              .from(assets)
              .where(inArray(assets.locationId, locationIds))
          : [];
      return {
        kind: "location",
        locations: locationRows.map((row) => ({
          ...row,
          type: row.type as AccessibleScope["locations"][number]["type"],
        })),
        assetGroups: [],
        assetIds: assetRows.map((row) => row.id),
      };
    }

    if (source === "asset_group") {
      const groupRows = await this.db
        .select({
          id: assetGroups.id,
          locationId: assetGroups.locationId,
          code: assetGroups.code,
          name: assetGroups.name,
          locationCode: locations.code,
          locationSlug: locations.slug,
          locationName: locations.name,
          locationType: locations.type,
          province: locations.province,
        })
        .from(userAssetGroupAccess)
        .innerJoin(assetGroups, eq(userAssetGroupAccess.assetGroupId, assetGroups.id))
        .innerJoin(locations, eq(assetGroups.locationId, locations.id))
        .where(
          and(
            eq(userAssetGroupAccess.userId, user.id),
            eq(locations.active, true),
          ),
        )
        .orderBy(asc(locations.name), asc(assetGroups.name));
      const groupIds = groupRows.map((row) => row.id);
      const assetRows =
        groupIds.length > 0
          ? await this.db
              .select({ id: assets.id })
              .from(assetGroupMembers)
              .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
              .where(inArray(assetGroupMembers.assetGroupId, groupIds))
          : [];
      const locationById = new Map(
        groupRows.map((row) => [
          row.locationId,
          {
            id: row.locationId,
            code: row.locationCode,
            slug: row.locationSlug,
            name: row.locationName,
            type: row.locationType as AccessibleScope["locations"][number]["type"],
            province: row.province,
          },
        ]),
      );
      return {
        kind: "asset_group",
        locations: [...locationById.values()],
        assetGroups: groupRows.map((row) => ({
          id: row.id,
          locationId: row.locationId,
          code: row.code,
          name: row.name,
        })),
        assetIds: assetRows.map((row) => row.id),
      };
    }

    return noAccessScope();
  }
}
