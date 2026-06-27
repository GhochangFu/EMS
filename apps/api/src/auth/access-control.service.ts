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
    if (
      role !== "admin" &&
      role !== "organization_admin" &&
      role !== "location_admin"
    ) {
      throw new ForbiddenException(
        "Master data administration requires admin, organization_admin, or location_admin role",
      );
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

  private async scopeForUser(user: DbUser): Promise<AccessibleScope> {
    if (user.role === "admin") {
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

    if (user.role === "organization_admin") {
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

    if (user.role === "location_admin") {
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

    if (user.role === "asset_group_admin") {
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

    return { kind: "none", locations: [], assetGroups: [], assetIds: [] };
  }
}
