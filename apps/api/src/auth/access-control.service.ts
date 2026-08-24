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

import { AUTH_DRIZZLE, FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
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

/**
 * `F4.16` / ADR 0043 — three pools, not one.
 *
 * `locations` and `user_organization_access` carry `ENABLE ROW LEVEL SECURITY`
 * (decision 10), and `bms_tenant`/`bms_fleet` only see rows for the organization
 * named by `SET LOCAL app.current_organization` — which this service cannot set
 * until it already knows the organization, and knowing it is this service's job.
 *
 * Rather than resolve that circularity with a `withTenant` transaction per
 * candidate organization (correct, but only needed where `bms_auth` cannot
 * already read the table), this service uses the grant Amendment 1 already put
 * in place for exactly this shape of read: `bms_auth` holds an unqualified
 * `SELECT` on `locations` and `user_organization_access`, via the
 * `auth_bootstrap_read` policy, specifically because the bootstrap needs to find
 * the organization before any tenant context exists. Every method below that
 * queries those two tables uses `authDb`, filtered by ids this service already
 * trusts (a grant row's own organization id, never a caller-supplied one) — the
 * same defense-in-depth those two tables already gave up **is not weakened
 * further** by this service also relying on it for authorization, not just
 * login. `E7.1` removes the grant and the policy; this file's `authDb` reads
 * come out in the same change (see the ADR's own removal note).
 *
 * `assets`, `asset_groups`, `asset_group_members` and `user_asset_group_access`
 * carry no policy yet and are not granted to `bms_auth`, so those queries run on
 * `tenantDb` (or `fleetDb` for a global admin) exactly as before — RLS is not in
 * play for them either way, so no `withTenant` wrapping is needed there either.
 */
@Injectable()
export class AccessControlService {
  constructor(
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

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
      return this.directOrganizationIds(user.id);
    }
    return this.locationDerivedOrganizationIds(user.id);
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
      const orgIds = await this.directOrganizationIds(user.id);
      if (orgIds.length === 0) {
        return [];
      }
      const rows = await this.authDb
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.organizationId, orgIds));
      return rows.map((row) => row.id);
    }
    const rows = await this.authDb
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
   * This method is **not** consulted by instantiation, and must not be — it
   * means "may author", which is false for `location_admin` by the design
   * above. ADR 0015 §7's table originally required it there *and*
   * `canManageLocation`, a conjunction no location admin can ever satisfy,
   * which denied the one role the same section exists to allow. Instantiation
   * instead requires template *readability* (`canManageOrganization`, the
   * predicate `list`/`getById` already use) plus `canManageLocation` on the
   * target — see ADR 0015 Amendment 1B. A location admin deploys a published
   * org template into their own location without being able to author one:
   * that is model-once-deploy-many.
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
    const [row] = await this.tenantDb
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

  /**
   * Resolves the caller against `bms.users` on the auth pool.
   *
   * ADR 0044: the row-absent fallback to the JWT claim now refuses a claimed
   * `admin` outright, rather than trusting the claim. Every other claimed role
   * still falls back to the claim — this is deliberate, not an oversight left
   * over from the `admin` fix. `writableOrganizationIds`/`writableLocationIds`
   * return the unrestricted `null` sentinel only inside their `role ===
   * "admin"` branch; every other role's authorization walks a grant table
   * keyed by user id, and an unprovisioned principal's fabricated `id`/`email`
   * matches no grant row regardless of claimed role — so `organization_admin`
   * and `location_admin` already resolve to `[]`, and `operator`/`viewer`
   * already resolve to `"none"`, with no change needed here. Refusing those
   * too would also remove the one thing that lets a freshly-federated
   * `operator`/`viewer` principal reach the app, with a correctly empty scope,
   * before a local row exists for them — see `assertUngrantedRolesFailClosed`.
   */
  private async resolveDbUser(jwt: JwtPayload): Promise<DbUser> {
    const [row] = await this.authDb
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

    if (jwt.role === "admin") {
      throw new ForbiddenException(
        "This token claims the admin role but matches no provisioned account",
      );
    }

    return {
      id: jwt.sub,
      email: jwt.email,
      displayName: jwt.name,
      role: jwt.role,
    };
  }

  /** Organization ids from this user's direct `user_organization_access` grants. */
  private async directOrganizationIds(userId: string): Promise<string[]> {
    const rows = await this.authDb
      .select({ id: userOrganizationAccess.organizationId })
      .from(userOrganizationAccess)
      .where(eq(userOrganizationAccess.userId, userId));
    return rows.map((row) => row.id);
  }

  /** Organization ids implied by this user's `user_location_access` grants. */
  private async locationDerivedOrganizationIds(userId: string): Promise<string[]> {
    const rows = await this.authDb
      .select({ id: locations.organizationId })
      .from(userLocationAccess)
      .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
      .where(eq(userLocationAccess.userId, userId));
    return [...new Set(rows.map((row) => row.id))];
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
        this.fleetDb
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
        this.fleetDb.select({ id: assets.id }).from(assets),
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
      const organizationIds = await this.directOrganizationIds(user.id);
      const locationRows =
        organizationIds.length > 0
          ? await this.authDb
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
          ? await this.tenantDb
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
      const locationRows = await this.authDb
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
          ? await this.tenantDb
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
      // assetGroups/userAssetGroupAccess are not policied and not granted to
      // bms_auth, so they run on the tenant pool. locations is both, so it is
      // queried separately on the auth pool rather than joined in — the original
      // single joined query cannot run unmodified on either pool alone.
      const groupRows = await this.tenantDb
        .select({
          id: assetGroups.id,
          locationId: assetGroups.locationId,
          code: assetGroups.code,
          name: assetGroups.name,
        })
        .from(userAssetGroupAccess)
        .innerJoin(assetGroups, eq(userAssetGroupAccess.assetGroupId, assetGroups.id))
        .where(eq(userAssetGroupAccess.userId, user.id));

      const locationIds = [...new Set(groupRows.map((row) => row.locationId))];
      const locationRows =
        locationIds.length > 0
          ? await this.authDb
              .select({
                id: locations.id,
                code: locations.code,
                slug: locations.slug,
                name: locations.name,
                type: locations.type,
                province: locations.province,
              })
              .from(locations)
              .where(and(inArray(locations.id, locationIds), eq(locations.active, true)))
          : [];
      const locationById = new Map(
        locationRows.map((row) => [
          row.id,
          { ...row, type: row.type as AccessibleScope["locations"][number]["type"] },
        ]),
      );

      // Matches the original INNER JOIN + `active = true` filter: a group whose
      // location is inactive (or, in principle, gone) drops out here.
      const activeGroupRows = groupRows
        .filter((row) => locationById.has(row.locationId))
        .sort((a, b) => {
          const nameA = locationById.get(a.locationId)?.name ?? "";
          const nameB = locationById.get(b.locationId)?.name ?? "";
          return nameA === nameB ? a.name.localeCompare(b.name) : nameA.localeCompare(nameB);
        });

      const groupIds = activeGroupRows.map((row) => row.id);
      const assetRows =
        groupIds.length > 0
          ? await this.tenantDb
              .select({ id: assets.id })
              .from(assetGroupMembers)
              .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
              .where(inArray(assetGroupMembers.assetGroupId, groupIds))
          : [];

      return {
        kind: "asset_group",
        locations: [...locationById.values()],
        assetGroups: activeGroupRows.map((row) => ({
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
