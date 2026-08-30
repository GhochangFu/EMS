import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assetGroupMembers, assetGroups, assetRoles, assets, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdminAssetGroupDto,
  AdminAssetGroupMemberDto,
  AdminAssetGroupMembersResponse,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { SetAssetGroupMemberRoleBody } from "./asset-groups.schema";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface, and the write
 * that sets a membership's role.
 *
 * **This is the first asset-group read in the API.** `AccessControlService`
 * returns groups only as the *calling user's own scope*, and that array is
 * empty for `admin`, `organization_admin` and `location_admin` — exactly the
 * users who administer roles. So these reads are scoped by
 * `writableOrganizationIds`/`writableLocationIds`, the master-data axis, and
 * never by `AccessibleScope.assetGroups`.
 *
 * Reads run on `fleetDb` and trust the scope filter computed before the row is
 * returned — the "bypass, then trust an already-computed grant" shape
 * `AssetsAdminService` records (ADR 0043 Amendment 2/3). Writes run inside
 * `withTenant`, because `bms.asset_group_members` carries `tenant_isolation`
 * **and** `FORCE` through both its parents (`0047` lines 223-240), so an
 * `UPDATE` with no `app.current_organization` GUC is refused outright.
 *
 * **`asset_group_admin` cannot reach any of this, and that is deliberate.**
 * `isMasterDataRole` excludes it — "widening a role's read scope must never
 * widen its master-data write scope" — so the role that most obviously wants
 * to label its own group's members is refused here. That boundary belongs to
 * `F3.34`, and this row does not widen a permission as a side effect.
 */
@Injectable()
export class AssetGroupsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly vocabularies: VocabulariesService,
  ) {}

  /** Lists asset groups the caller may administer, ordered by `code`. */
  async list(jwt: JwtPayload, locationId?: string): Promise<{ items: AdminAssetGroupDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableLocations = await this.accessControl.writableLocationIds(jwt);
    const writableOrgs = await this.accessControl.writableOrganizationIds(jwt);

    const conditions = [];
    if (locationId) {
      // Asked for one location: authorize *that* location rather than
      // filtering it out silently, so a caller learns their request was out of
      // scope instead of reading an empty list as "this location has no groups".
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      conditions.push(eq(assetGroups.locationId, locationId));
    }
    // `null` from either accessor means unrestricted (global admin). An empty
    // array means "scoped, and to nothing", which `inArray` renders as a false
    // predicate — the correct answer, not an unfiltered one.
    if (writableLocations !== null) {
      conditions.push(inArray(assetGroups.locationId, writableLocations));
    }
    if (writableOrgs !== null) {
      conditions.push(inArray(assetGroups.organizationId, writableOrgs));
    }

    const rows = await this.fleetDb
      .select({
        id: assetGroups.id,
        code: assetGroups.code,
        name: assetGroups.name,
        description: assetGroups.description,
        locationId: assetGroups.locationId,
        locationName: locations.name,
        organizationId: assetGroups.organizationId,
        // A subquery rather than a join + GROUP BY: the join would multiply the
        // group row per member and every other column would need aggregating.
        memberCount: sql<number>`(
          SELECT count(*)::int FROM bms.asset_group_members m
          WHERE m.asset_group_id = ${assetGroups.id}
        )`,
        createdAt: assetGroups.createdAt,
      })
      .from(assetGroups)
      .leftJoin(locations, eq(assetGroups.locationId, locations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(assetGroups.code));

    return {
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Lists one group's members with their roles, plus a count per role.
   *
   * **Ordered by `assets.code`, and that is the contract.** `assets.code` is
   * `NOT NULL UNIQUE`, so it is a *total* order. ADR 0049 put no unique index
   * on `(asset_group_id, role)` — the mock's own nodes are plural — so a role
   * resolves to N bindings, and ordering by `id` or insertion order would make
   * one stock template instantiated twice in an organization produce two
   * different tile orders with no visible cause.
   */
  async members(jwt: JwtPayload, groupId: string): Promise<AdminAssetGroupMembersResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    await this.requireManageableGroup(jwt, groupId);

    const rows = await this.fleetDb
      .select({
        membershipId: assetGroupMembers.id,
        assetId: assets.id,
        assetCode: assets.code,
        assetName: assets.name,
        assetDomain: assets.domain,
        role: assetGroupMembers.role,
        roleLabel: assetRoles.label,
      })
      .from(assetGroupMembers)
      .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
      // LEFT, not INNER: `role` is nullable, and an INNER join would drop every
      // member that has no role yet — which is every member before 0051.
      .leftJoin(assetRoles, eq(assetGroupMembers.role, assetRoles.code))
      .where(eq(assetGroupMembers.assetGroupId, groupId))
      .orderBy(asc(assets.code));

    // Decision 6's spectrum: zero bindings is visible on the dashboard, but two
    // of three chillers carrying the role renders a widget that looks right and
    // is one short. Counted here so a person can see it before it ships.
    const roleCounts: Record<string, number> = {};
    for (const row of rows) {
      if (row.role) {
        roleCounts[row.role] = (roleCounts[row.role] ?? 0) + 1;
      }
    }

    return { items: rows as AdminAssetGroupMemberDto[], roleCounts };
  }

  /**
   * Sets or clears one membership's role. `null` clears it.
   *
   * Four things happen in order, and none is optional: the caller must be a
   * master-data user; the membership's group must be inside their writable
   * scope; an unknown or retired role code must be a 400 naming the live codes
   * rather than the foreign key's 500; and the write must run inside
   * `withTenant` with the audit row on the *same* transaction.
   */
  async setMemberRole(
    jwt: JwtPayload,
    membershipId: string,
    body: SetAssetGroupMemberRoleBody,
  ): Promise<AdminAssetGroupMemberDto> {
    await this.accessControl.requireMasterDataUser(jwt);

    const [membership] = await this.fleetDb
      .select({
        id: assetGroupMembers.id,
        assetGroupId: assetGroupMembers.assetGroupId,
        role: assetGroupMembers.role,
        organizationId: assetGroups.organizationId,
        locationId: assetGroups.locationId,
      })
      .from(assetGroupMembers)
      .innerJoin(assetGroups, eq(assetGroupMembers.assetGroupId, assetGroups.id))
      .where(eq(assetGroupMembers.id, membershipId))
      .limit(1);

    if (!membership) {
      throw new NotFoundException("Asset group membership not found");
    }
    // §4.7: authorize the group this membership belongs to. Without it a
    // location-scoped admin could relabel another site's plant.
    if (!(await this.accessControl.canManageLocation(jwt, membership.locationId))) {
      throw new ForbiddenException("Asset group is outside your access scope");
    }

    // Before the write, so an unknown code is a 400 naming the live values and
    // not `asset_group_members_role_fkey` as a 500.
    if (body.role !== null) {
      await this.vocabularies.assertAssetRole(body.role);
    }

    const organizationId = membership.organizationId;
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      // `.returning()`, and the emptiness check below it, are the point.
      //
      // The GUC comes from the group alone, but `0047`'s `tenant_isolation` on
      // `bms.asset_group_members` requires it to match **both** parents — the
      // group's organization AND the asset's. RLS refuses by *filtering*, so a
      // membership whose asset sits in another organization updates zero rows
      // and raises nothing. Without this guard the audit row below still
      // commits, describing a change that never landed, and `fetchMember`
      // re-reads on `fleetDb` (BYPASSRLS) and answers 200 with the old value —
      // a write that is refused, recorded, and reported as success.
      //
      // The same shape fires for a membership deleted between the `fleetDb`
      // read above and this statement.
      //
      // Not reachable from any application path today: nothing but the seeds
      // writes this table, and `assets.service.ts` refuses a cross-org
      // relocation outright. It is guarded anyway because that file's own
      // comment names this exact failure — "would update zero rows and still
      // return a success DTO" — and this table can reach it through a second
      // parent that `bms.assets` does not have.
      const updated = await tx
        .update(assetGroupMembers)
        .set({ role: body.role })
        .where(eq(assetGroupMembers.id, membershipId))
        .returning({ id: assetGroupMembers.id });

      if (updated.length === 0) {
        throw new NotFoundException("Asset group membership not found");
      }

      // `tx`, not the default executor. `MasterDataAuditService.write`'s
      // docblock is explicit that the default fails both ways after `0048`,
      // and that a second pool client acquired while this transaction is open
      // can wedge the pool with no timeout. `E7.1c` already paid that cost.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_group_member.role.set",
          entityType: "asset_group_member",
          entityId: membershipId,
          organizationId,
          payload: { from: membership.role, to: body.role },
        },
        tx,
      );
    });

    return this.fetchMember(membershipId);
  }

  /** Re-reads one membership for the response, joined the same way `members` joins. */
  private async fetchMember(membershipId: string): Promise<AdminAssetGroupMemberDto> {
    const [row] = await this.fleetDb
      .select({
        membershipId: assetGroupMembers.id,
        assetId: assets.id,
        assetCode: assets.code,
        assetName: assets.name,
        assetDomain: assets.domain,
        role: assetGroupMembers.role,
        roleLabel: assetRoles.label,
      })
      .from(assetGroupMembers)
      .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
      .leftJoin(assetRoles, eq(assetGroupMembers.role, assetRoles.code))
      .where(eq(assetGroupMembers.id, membershipId))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Asset group membership not found");
    }
    return row as AdminAssetGroupMemberDto;
  }

  /** Refuses a group the caller may not administer, and a group that does not exist. */
  private async requireManageableGroup(jwt: JwtPayload, groupId: string): Promise<void> {
    const [group] = await this.fleetDb
      .select({ locationId: assetGroups.locationId })
      .from(assetGroups)
      .where(eq(assetGroups.id, groupId))
      .limit(1);

    if (!group) {
      throw new NotFoundException("Asset group not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, group.locationId))) {
      throw new ForbiddenException("Asset group is outside your access scope");
    }
  }
}
