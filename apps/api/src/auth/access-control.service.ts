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

import { AUTH_DRIZZLE, FLEET_DRIZZLE } from "../database/database.tokens";
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
 * `F4.16` / ADR 0043 (Amendments 2–4) — scope resolution runs **before** any
 * tenant context exists, so it cannot name an organization with `SET LOCAL
 * app.current_organization`: finding the organization is this service's job, and
 * an actor may hold grants across more than one, which a single GUC cannot
 * express.
 *
 * Every grant-walk and tenant-table read therefore runs on `fleetDb`
 * (`bms_fleet`, `BYPASSRLS`), filtered by ids this service already trusts — the
 * caller's own `userId`, or an organization/location id derived from that user's
 * own grant rows, never a caller-supplied one. The `WHERE` filter is the
 * isolation control (Amendment 2/3), the same "bypass, then trust an
 * already-computed grant" shape a global admin's `scopeFromSource("global")` has
 * always used. `E7.1b`'s `0047` removes `bms_auth`'s grants on `locations` and
 * `user_organization_access` and gives `assets`/`asset_groups` a policy, so the
 * older `authDb`/`tenantDb` reads here would lose their grant or fall to zero
 * rows — the fleet re-point is what keeps scope resolution whole across that flip.
 *
 * Only `resolveDbUser` stays on `authDb`: `bms_auth` keeps its narrow `SELECT`
 * on `bms.users` alone (Amendment 4's `auth_bootstrap_read` policy), which is the
 * one read that must work before the fleet pool is even reached. The tenant pool
 * is intentionally **not** injected here — this service never reads through a
 * tenant GUC.
 */
@Injectable()
export class AccessControlService {
  constructor(
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
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
      // fleetDb: pre-tenant scope resolution across the actor's org grants; a
      // single SET LOCAL cannot express the set, and the orgId WHERE filter is
      // the isolation control (ADR 0043 Amendment 2/3).
      const rows = await this.fleetDb
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.organizationId, orgIds));
      return rows.map((row) => row.id);
    }
    // fleetDb: pre-tenant resolution keyed by the actor's own userId (Amendment 2/3).
    const rows = await this.fleetDb
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
   * Whether the user may manage a notification channel — created, updated,
   * deleted or sent a test through, for the given organization.
   *
   * `E7.1c` (ADR 0043 Amendment 5, decision 7). The one deviation from
   * {@link canManagePointKey}'s template is the nullable parameter: a `null`
   * `organizationId` names a fleet-managed **global** channel, and it is
   * fleet-only — `organization_admin` gets `false` for it, not a delegated
   * `canManageOrganization` call, because there is no organization to check
   * membership against and a global row is a fleet actor's row, not a
   * tenant's. `admin` is unconditionally `true`, `null` included.
   */
  async canManageNotificationChannel(
    jwt: JwtPayload,
    organizationId: string | null,
  ): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    this.assertMasterDataRole(user.role);
    if (user.role === "admin") {
      return true;
    }
    if (user.role === "organization_admin") {
      if (organizationId === null) {
        return false;
      }
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
    // fleetDb: pre-tenant lookup of the asset's home location before any org
    // context exists (finding it is the point); isolation is the
    // canManageLocation check below, filtered by the actor's grants (Amendment 2/3).
    const [row] = await this.fleetDb
      .select({ locationId: assets.locationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!row?.locationId) {
      return false;
    }
    return this.canManageLocation(jwt, row.locationId);
  }

  /**
   * Whether the caller holds the global `admin` role **in the database**.
   *
   * Added for ADR 0046 Amendment 3 (`E8.6`), and it exists so a projection can
   * be keyed on the role without throwing for the roles it does not admit —
   * `requireMasterDataUser` refuses `operator` and `viewer`, which reach
   * `GET /rules/executions` legitimately.
   *
   * **Do not substitute a scope check for this.** `readableAssetIds` returns
   * `null` only for `admin` today, so `assetIds === null` picks out the same
   * callers — and that coincidence is exactly what Amendment 2 forbids relying
   * on. A future role resolving to an unrestricted scope would silently stop a
   * scope-keyed redaction; a role-keyed one keeps working.
   *
   * The claim cannot reach `true` here: ADR 0044 makes `resolveDbUser` throw on
   * a claimed `admin` with no `bms.users` row, so this returns `true` only for a
   * real provisioned row. Every other principal — including an unprovisioned
   * one falling back to its claim — yields `false`, which redacts. The failure
   * direction is closed.
   */
  async isGlobalAdmin(jwt: JwtPayload): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    return user.role === "admin";
  }

  /**
   * Whether the user may create, edit, delete, or replace the widgets of a
   * dashboard with the given organization and scope (`F3.1b`, ADR 0047
   * Amendment 2 ruling 2).
   *
   * **Deliberately does NOT gate through `assertMasterDataRole`/
   * `isMasterDataRole`**, unlike {@link canManageNotificationChannel} and
   * {@link canManageTemplate} which this otherwise mirrors.
   * `isMasterDataRole` excludes `asset_group_admin` on purpose everywhere
   * else in this service — but decision 2 explicitly admits it here for a
   * dashboard scoped to a group it holds. Gating through that helper would
   * refuse the one role this method exists to admit. `viewer`/`operator`
   * fall through every branch below to `false` rather than a thrown
   * `ForbiddenException`, because this method answers a boolean a caller
   * uses to decide whether to 403 — not one that throws its own.
   */
  async canManageDashboard(
    jwt: JwtPayload,
    organizationId: string,
    scope: { locationId: string | null; assetGroupId: string | null },
  ): Promise<boolean> {
    const user = await this.resolveDbUser(jwt);
    if (user.role === "admin") {
      return true;
    }
    if (user.role === "organization_admin") {
      return this.canManageOrganization(jwt, organizationId);
    }
    // An organization-wide dashboard (both scope columns NULL) has no scope
    // column and therefore no owner — only the two organization-level roles
    // above may create or edit one. This is the assertion a refactor is most
    // likely to lose, because every other assertion about location_admin is
    // about a foreign organization rather than its own.
    if (scope.locationId === null && scope.assetGroupId === null) {
      return false;
    }
    if (user.role === "location_admin") {
      return scope.locationId !== null && (await this.canManageLocation(jwt, scope.locationId));
    }
    if (user.role === "asset_group_admin") {
      if (scope.assetGroupId === null) {
        return false;
      }
      // Direct membership on the target group, NOT `canManageLocation`.
      // `canManageLocation` resolves through `writableLocationIds`, which
      // calls `assertMasterDataRole` — and `isMasterDataRole` deliberately
      // excludes `asset_group_admin` everywhere else in this service. Calling
      // it here would throw for the one role this branch exists to admit
      // (found empirically: the integration test below throws
      // ForbiddenException without this). An asset_group_admin's grant lives
      // on the GROUP (`user_asset_group_access`), never on a location, so the
      // membership check is on the group itself, not a location lookup —
      // `bms.asset_groups.location_id` being NOT NULL is what lets
      // `scopeFromSource("asset_group")` resolve a group's location
      // elsewhere in this file; it is not itself the predicate here.
      // fleetDb: pre-tenant grant walk keyed by the actor's own userId
      // (Amendment 2/3).
      const [row] = await this.fleetDb
        .select({ id: userAssetGroupAccess.assetGroupId })
        .from(userAssetGroupAccess)
        .where(
          and(
            eq(userAssetGroupAccess.userId, user.id),
            eq(userAssetGroupAccess.assetGroupId, scope.assetGroupId),
          ),
        )
        .limit(1);
      return row !== undefined;
    }
    return false;
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
   * and `location_admin` already resolve to `[]`, and `operator`/`viewer`/
   * `asset_group_admin` already resolve to `"none"`, with no change needed
   * here. (`asset_group_admin` is also admitted to the separate ADR 0017
   * operations-write surface — `operations-write.ts` — which this `null`
   * sentinel does not gate at all; that surface is closed the same way,
   * because `readableAssetIds` for it never returns `null` either. See
   * ADR 0044.) Refusing the non-admin fallback too would also remove the one
   * thing that lets a freshly-federated `operator`/`viewer` principal reach
   * the app, with a correctly empty scope, before a local row exists for
   * them — see `assertUngrantedRolesFailClosed`.
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
    // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
    const rows = await this.fleetDb
      .select({ id: userOrganizationAccess.organizationId })
      .from(userOrganizationAccess)
      .where(eq(userOrganizationAccess.userId, userId));
    return rows.map((row) => row.id);
  }

  /** Organization ids implied by this user's `user_location_access` grants. */
  private async locationDerivedOrganizationIds(userId: string): Promise<string[]> {
    // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
    const rows = await this.fleetDb
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
      // fleetDb: pre-tenant resolution filtered by the actor's own org grants (Amendment 2/3).
      const locationRows =
        organizationIds.length > 0
          ? await this.fleetDb
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
      // fleetDb: assets gains a policy in 0047; filtered by locationIds derived
      // from the actor's own grants above (Amendment 2/3).
      const assetRows =
        locationIds.length > 0
          ? await this.fleetDb
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
      // fleetDb: pre-tenant resolution keyed by the actor's own userId (Amendment 2/3).
      const locationRows = await this.fleetDb
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
      // fleetDb: assets gains a policy in 0047; filtered by locationIds derived
      // from the actor's own grants above (Amendment 2/3).
      const assetRows =
        locationIds.length > 0
          ? await this.fleetDb
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
      // fleetDb throughout: pre-tenant resolution before any org context exists.
      // asset_groups gains a policy in 0047 and locations already carries one;
      // both reads are keyed by the actor's own userId / user-derived location
      // ids, which is the isolation control (Amendment 2/3). The join is split
      // only because the original single query mixed a userId-keyed grant walk
      // with a location filter.
      const groupRows = await this.fleetDb
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
          ? await this.fleetDb
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
      // fleetDb: assets + the asset_group_members junction gain policies in 0047;
      // filtered by groupIds derived from the actor's own grants above (Amendment 2/3).
      const assetRows =
        groupIds.length > 0
          ? await this.fleetDb
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
