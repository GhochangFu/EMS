import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import {
  assetGroupMembers,
  assetGroups,
  assetPoints,
  assets,
  assetTemplates,
  type BmsDb,
  calcParameters,
  dashboards,
  dashboardTemplates,
  dashboardWidgets,
  locations,
  organizations,
  pointKeys,
  rtus,
  siteControlRoomViews,
  templatePoints,
} from "@bms/db";
import { type JwtPayload, userGrantKindSchema, userRoleSchema } from "@bms/shared";
import type { CatalogEntry, CatalogRef, CatalogRefKind } from "@bms/shared/copilot";

import { UserGrantsService } from "../admin/users/user-grants.service";
import { mayAssignRole } from "../admin/users/user-management-rules";
import { UsersService } from "../admin/users/users.service";
import { AccessControlService } from "../auth/access-control.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";

/** What a proposal's target resolved to. */
export type ResolvedTarget = {
  readonly organizationId: string;
  readonly organizationName: string;
  /** The row's name (a parameter's key, an asset's name), or the organization's name for a create. */
  readonly targetName: string;
  /** `dashboard` targets: the dashboard's widgets now (decision 4.9's summary). */
  readonly currentWidgetIds?: readonly string[];
  /** `asset` and `assetTemplate` targets: the point keys now, the refs a formula may name. */
  readonly pointKeys?: readonly string[];
  /** `assetTemplate` targets: the stored `content`, which a proposal's sections merge over (ruling Q10). */
  readonly currentContent?: Readonly<Record<string, unknown>>;
  /** `F3.86` PR 4, `userGrantAdd` and `userGrant`: the grant target's name, for the summary. */
  readonly refName?: string;
};

/** What the user targets need from the users services: their own checks, called, never copied (plan §6.3). */
export type CopilotUserChecks = {
  readonly users: Pick<UsersService, "requireManager" | "requireManageableTarget">;
  readonly grants: Pick<UserGrantsService, "assertGrantAddable" | "assertGrantRemovable">;
};

/** The resolver as the propose tools use it; specs pass a fake. */
export interface CopilotTargets {
  resolve(
    entry: CatalogEntry,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    allowedOrganizationIds: readonly string[],
    user: JwtPayload,
    /**
     * `F3.86` PR 2: the conversation's bound organization, or `null` for a
     * cross-organization conversation. A `fleet` or `pointKey` target lives
     * in it, and is refused without one (ruling Q1).
     */
    boundOrganizationId?: string | null,
  ): Promise<ResolvedTarget | null>;
}

export const COPILOT_TARGETS = Symbol("COPILOT_TARGETS");

type Found = {
  organizationId: string;
  name: string;
  scope?: Scope;
  /** `rtu`, `assetGroup`, `assetGroupMember`: the site the row is at. */
  locationId?: string;
  /** `assetPoint`: the asset the point maps. */
  assetId?: string;
  /** `siteControlRoomView`: the stored view's `kind`, or `null` when the site has none. */
  storedKind?: string | null;
  refName?: string;
  currentWidgetIds?: string[];
  pointKeys?: string[];
  currentContent?: Record<string, unknown>;
};
type Scope = { locationId: string | null; assetGroupId: string | null; assetId: string | null };
type RowKind = Exclude<CatalogEntry["target"]["kind"], "organization" | "parent" | "fleet" | "onboardingSession" | UserKind>;
type UserKind = "user" | "userGrantAdd" | "userGrant";
type UserTarget = Extract<CatalogEntry["target"], { kind: UserKind }>;

/**
 * `F3.85` PR 8 / ADR 0099 decision 10 (plan §10.2) — the organization and
 * name of a proposed change's target, from the catalog entry's declarative
 * `target` and `refs`.
 *
 * **Only inside the turn's allowed set.** A row named by id is looked for in
 * each allowed organization in turn, under `withTenant` (every target table
 * has FORCE RLS and a tenant policy) and with an explicit organization
 * filter. A row that is in none of them, a row (or, for a create, an
 * organization and scope) the caller may not manage, and a row that does not
 * exist all answer `null` — one refusal, so the tool
 * never tells a model that another tenant's id exists, and never reads a
 * name from outside the scope the turn's key may send.
 *
 * Every id the body names (`refs`) must be a row of the same organization.
 * The route checks all of this again when the change is confirmed; this read
 * only keeps a change that cannot apply off the card.
 */
@Injectable()
export class CopilotTargetResolver implements CopilotTargets {
  private readonly users: CopilotUserChecks["users"];
  private readonly grants: CopilotUserChecks["grants"];

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(AccessControlService) private readonly access: AccessControlService,
    @Inject(UsersService) users: UsersService,
    @Inject(UserGrantsService) grants: UserGrantsService,
  ) {
    this.users = users;
    this.grants = grants;
  }

  async resolve(
    entry: CatalogEntry,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    allowedOrganizationIds: readonly string[],
    user: JwtPayload,
    boundOrganizationId: string | null = null,
  ): Promise<ResolvedTarget | null> {
    const target = entry.target;
    let found: Found | null;
    if (target.kind === "onboardingSession") {
      // `F3.86` PR 6: only a server-made change has this target (the onboarding commit, decision 7);
      // no propose tool reaches the resolver with it, so a call is refused.
      return null;
    }
    if (target.kind === "organization") {
      const organizationId = body.organizationId;
      if (typeof organizationId !== "string" || !allowedOrganizationIds.includes(organizationId)) return null;
      const name = await this.organizationName(organizationId);
      found = name === null ? null : { organizationId, name };
      if (found !== null && !(await this.safely(() => this.mayCreate(target.manage, organizationId, body, user)))) found = null;
    } else if (target.kind === "parent") {
      // A create under a row the body names: the row's organization, and the route's check on that row.
      // The create's body is not the parent's: no parent check reads it (a create's `parentId` is no move).
      const parentId = body[target.field];
      if (typeof parentId !== "string") return null;
      const of = target.of;
      found = await this.findRow(of, parentId, allowedOrganizationIds);
      if (found !== null && !(await this.safely(() => this.mayManage(of, parentId, found as Found, user, {})))) found = null;
    } else if (target.kind === "user" || target.kind === "userGrantAdd" || target.kind === "userGrant") {
      // `F3.86` PR 4: the users services' own checks; a 403 or 404 from them is the one refusal.
      found = await this.findUserTarget(target, params, body, user, allowedOrganizationIds).catch(() => null);
      if (found !== null && !allowedOrganizationIds.includes(found.organizationId)) found = null;
    } else if (target.kind === "fleet" || target.kind === "pointKey") {
      // Ruling Q1: a row with no organization lives in the conversation's bound organization.
      if (boundOrganizationId === null || !allowedOrganizationIds.includes(boundOrganizationId)) return null;
      const organizationName = await this.organizationName(boundOrganizationId);
      if (organizationName === null) return null;
      if (target.kind === "fleet") {
        found = { organizationId: boundOrganizationId, name: organizationName };
      } else {
        const id = params[target.param];
        if (id === undefined) return null;
        const code = await this.pointKeyCode(id);
        found = code === null ? null : { organizationId: boundOrganizationId, name: code };
      }
      if (found !== null && !(await this.safely(() => this.mayManageFleet(user)))) found = null;
    } else {
      const id = params[target.param];
      if (id === undefined) return null;
      const kind = target.kind;
      found = await this.findRow(kind, id, allowedOrganizationIds);
      if (found !== null && !(await this.safely(() => this.mayManage(kind, id, found as Found, user, body)))) found = null;
    }
    if (found === null) return null;
    for (const ref of entry.refs) {
      const value = body[ref.field];
      if (value === undefined || value === null) continue;
      const kind = refKindOf(ref, body);
      if (kind === null || typeof value !== "string" || !(await this.refBelongs(kind, value, found.organizationId))) return null;
    }
    const organizationName =
      target.kind === "organization" ? found.name : ((await this.organizationName(found.organizationId)) ?? "");
    return {
      organizationId: found.organizationId,
      organizationName,
      targetName: found.name,
      ...(found.currentWidgetIds ? { currentWidgetIds: found.currentWidgetIds } : {}),
      ...(found.pointKeys ? { pointKeys: found.pointKeys } : {}),
      ...(found.currentContent ? { currentContent: found.currentContent } : {}),
      ...(found.refName !== undefined ? { refName: found.refName } : {}),
    };
  }

  /**
   * `F3.86` PR 4 / ADR 0099 decision 3 — a user target, through
   * `UsersService.requireManager` and `requireManageableTarget` (ADR 0089's
   * who-may-manage-whom), then for a grant `UserGrantsService`'s pre-write
   * checks. A global admin (no home organization) is never a target: changing
   * that role is the Users page's. Throws what the services throw.
   */
  private async findUserTarget(
    target: UserTarget,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    user: JwtPayload,
    allowedOrganizationIds: readonly string[],
  ): Promise<Found | null> {
    const manager = await this.users.requireManager(user);
    const userId = params[target.kind === "userGrant" ? target.userParam : target.param];
    if (userId === undefined) return null;
    const row = await this.users.requireManageableTarget(manager, userId);
    if (row.organizationId === null) return null;
    // Decision 10: the user's name reaches the model, so the user's own organization must be in the
    // turn's scope too — for a grant as well, whose change lives in the grant target's organization.
    if (!allowedOrganizationIds.includes(row.organizationId)) return null;
    const name = row.displayName;
    if (target.kind === "user") return { organizationId: row.organizationId, name };
    if (target.kind === "userGrantAdd") {
      const kind = userGrantKindSchema.safeParse(body.kind);
      if (!kind.success || typeof body.targetId !== "string") return null;
      const checked = await this.grants.assertGrantAddable(user, manager, row, { kind: kind.data, targetId: body.targetId });
      return { organizationId: checked.organizationId, name, refName: checked.targetName };
    }
    if (target.kind !== "userGrant") return null;
    const kind = userGrantKindSchema.safeParse(params[target.kindParam]);
    const grantId = params[target.param];
    if (!kind.success || grantId === undefined) return null;
    const checked = await this.grants.assertGrantRemovable(user, manager, row, kind.data, grantId);
    return { organizationId: checked.organizationId, name, refName: checked.targetName };
  }

  private async organizationName(organizationId: string): Promise<string | null> {
    // `bms.organizations` carries no row-level security (`LlmResolver.listOrganizationIds`).
    const [row] = await this.tenantDb
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row?.name ?? null;
  }

  /** A point key's code (`bms.point_keys` is fleet-wide and carries no row-level security, migration 0057). */
  private async pointKeyCode(id: string): Promise<string | null> {
    const [row] = await this.tenantDb.select({ code: pointKeys.code }).from(pointKeys).where(eq(pointKeys.id, id)).limit(1);
    return row?.code ?? null;
  }

  private async findRow(
    kind: RowKind,
    id: string,
    allowed: readonly string[],
  ): Promise<Found | null> {
    for (const organizationId of allowed) {
      const found = await withTenant(this.tenantDb, organizationId, (tx) => this.readRow(tx, kind, id, organizationId));
      if (found !== null) return found;
    }
    return null;
  }

  private async readRow(tx: BmsTx, kind: RowKind, id: string, organizationId: string): Promise<Found | null> {
    switch (kind) {
      case "location":
      case "siteLayout": {
        const [row] = await tx
          .select({ name: locations.name })
          .from(locations)
          .where(and(eq(locations.id, id), eq(locations.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name } : null;
      }
      case "siteControlRoomView": {
        const [row] = await tx
          .select({ name: locations.name })
          .from(locations)
          .where(and(eq(locations.id, id), eq(locations.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        // The route's `storedKind` read (`site-control-room-view.service.ts`), here under the tenant.
        const [view] = await tx
          .select({ kind: siteControlRoomViews.kind })
          .from(siteControlRoomViews)
          .where(and(eq(siteControlRoomViews.locationId, id), eq(siteControlRoomViews.organizationId, organizationId)))
          .limit(1);
        return { organizationId, name: row.name, storedKind: view?.kind ?? null };
      }
      case "rtu": {
        const [row] = await tx
          .select({ name: rtus.displayName, locationId: rtus.locationId })
          .from(rtus)
          .where(and(eq(rtus.id, id), eq(rtus.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name, locationId: row.locationId } : null;
      }
      case "assetGroup": {
        const [row] = await tx
          .select({ name: assetGroups.name, locationId: assetGroups.locationId })
          .from(assetGroups)
          .where(and(eq(assetGroups.id, id), eq(assetGroups.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name, locationId: row.locationId } : null;
      }
      case "assetGroupMember": {
        // A membership has no organization column; its group's is the row's.
        const [row] = await tx
          .select({ group: assetGroups.name, asset: assets.name, locationId: assetGroups.locationId })
          .from(assetGroupMembers)
          .innerJoin(assetGroups, eq(assetGroups.id, assetGroupMembers.assetGroupId))
          .innerJoin(assets, eq(assets.id, assetGroupMembers.assetId))
          .where(and(eq(assetGroupMembers.id, id), eq(assetGroups.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: `${row.asset} in ${row.group}`, locationId: row.locationId } : null;
      }
      case "assetPoint": {
        const [row] = await tx
          .select({ pointKey: assetPoints.pointKey, assetId: assetPoints.assetId, assetCode: assets.code })
          .from(assetPoints)
          .innerJoin(assets, eq(assets.id, assetPoints.assetId))
          .where(and(eq(assetPoints.id, id), eq(assetPoints.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: `${row.assetCode} ${row.pointKey}`, assetId: row.assetId } : null;
      }
      case "pointKey":
        // Never read per organization: `resolve` reads a point key on the fleet path.
        return null;
      case "dashboard": {
        const [row] = await tx
          .select({
            name: dashboards.name,
            locationId: dashboards.locationId,
            assetGroupId: dashboards.assetGroupId,
            assetId: dashboards.assetId,
          })
          .from(dashboards)
          .where(and(eq(dashboards.id, id), eq(dashboards.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const widgets = await tx
          .select({ id: dashboardWidgets.id })
          .from(dashboardWidgets)
          .where(and(eq(dashboardWidgets.dashboardId, id), eq(dashboardWidgets.organizationId, organizationId)));
        return {
          organizationId,
          name: row.name,
          scope: { locationId: row.locationId, assetGroupId: row.assetGroupId, assetId: row.assetId },
          currentWidgetIds: widgets.map((widget) => widget.id),
        };
      }
      case "dashboardTemplate": {
        const [row] = await tx
          .select({ name: dashboardTemplates.name })
          .from(dashboardTemplates)
          .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name } : null;
      }
      case "calcParameter": {
        const [row] = await tx
          .select({ key: calcParameters.key, locationId: calcParameters.locationId, assetId: calcParameters.assetId })
          .from(calcParameters)
          .where(and(eq(calcParameters.id, id), eq(calcParameters.organizationId, organizationId)))
          .limit(1);
        return row
          ? { organizationId, name: row.key, scope: { locationId: row.locationId, assetGroupId: null, assetId: row.assetId } }
          : null;
      }
      case "asset": {
        const [row] = await tx
          .select({ name: assets.name })
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const points = await tx
          .select({ pointKey: assetPoints.pointKey })
          .from(assetPoints)
          .where(and(eq(assetPoints.assetId, id), eq(assetPoints.organizationId, organizationId)));
        return { organizationId, name: row.name, pointKeys: points.map((point) => point.pointKey) };
      }
      case "assetTemplate": {
        const [row] = await tx
          .select({ name: assetTemplates.name, content: assetTemplates.content })
          .from(assetTemplates)
          .where(and(eq(assetTemplates.id, id), eq(assetTemplates.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const points = await tx
          .select({ pointKey: templatePoints.pointKey })
          .from(templatePoints)
          .where(and(eq(templatePoints.templateId, id), eq(templatePoints.organizationId, organizationId)));
        const content = row.content;
        return {
          organizationId,
          name: row.name,
          pointKeys: points.map((point) => point.pointKey),
          // The column is `jsonb NOT NULL`; anything but an object merges as empty (ruling Q10).
          currentContent:
            typeof content === "object" && content !== null && !Array.isArray(content) ? (content as Record<string, unknown>) : {},
        };
      }
    }
  }

  /**
   * A manage check that throws (`assertMasterDataRole` refuses an
   * `asset_group_admin` with a 403) is a `false`: otherwise the tool's answer
   * would differ between "not found" and "found but forbidden" (review L1).
   */
  private async safely(check: () => Promise<boolean>): Promise<boolean> {
    try {
      return await check();
    } catch {
      return false;
    }
  }

  /** The point-key routes' check (`point-keys.service.ts` `requireGlobalAdmin`): a master-data user who is a global admin. */
  private async mayManageFleet(user: JwtPayload): Promise<boolean> {
    await this.access.requireMasterDataUser(user);
    return this.access.isGlobalAdmin(user);
  }

  /** A create's authority: the route's own check, on the body's organization and scope. */
  private async mayCreate(
    manage: Extract<CatalogEntry["target"], { kind: "organization" }>["manage"],
    organizationId: string,
    body: Readonly<Record<string, unknown>>,
    user: JwtPayload,
  ): Promise<boolean> {
    const id = (key: string): string | null => (typeof body[key] === "string" ? (body[key] as string) : null);
    switch (manage) {
      case "dashboard":
        return this.access.canManageDashboard(user, organizationId, {
          locationId: id("locationId"),
          assetGroupId: id("assetGroupId"),
          assetId: id("assetId"),
        });
      case "template":
        return this.access.canManageTemplate(user, organizationId);
      case "calcParameter": {
        const assetId = id("assetId");
        const locationId = id("locationId");
        if (assetId !== null) return this.access.canManageAsset(user, assetId);
        if (locationId !== null) return this.access.canManageLocation(user, locationId);
        return this.access.canManageOrganization(user, organizationId);
      }
      // `users.service.ts` `create` (ADR 0089): a manager, a role it may give, an organization it may write.
      case "user": {
        const manager = await this.users.requireManager(user);
        const role = userRoleSchema.safeParse(body.role);
        if (!role.success || !mayAssignRole(manager.role, role.data)) return false;
        return manager.writable === null || manager.writable.includes(organizationId);
      }
      // `locations.service.ts` `create`: a master-data user, never a `location_admin`, who manages the organization.
      case "location": {
        const dbUser = await this.access.requireMasterDataUser(user);
        if (dbUser.role === "location_admin") return false;
        return this.access.canManageOrganization(user, organizationId);
      }
    }
  }

  /**
   * The same authority the route checks, so a card the caller could never
   * apply is not offered. Each `F3.86` case names the route it mirrors; the
   * route checks again on Confirm.
   */
  private async mayManage(
    kind: RowKind,
    id: string,
    found: Found,
    user: JwtPayload,
    body: Readonly<Record<string, unknown>> = {},
  ): Promise<boolean> {
    switch (kind) {
      // The location, RTU and asset-group routes: a master-data user who manages the site.
      // `F3.86` PR 3a: `LocationsAdminService.update` — a body that names `parentId` (any value,
      // `null` included) is a move, which only an organization-level administrator makes.
      case "location":
        await this.access.requireMasterDataUser(user);
        if (!(await this.access.canManageLocation(user, id))) return false;
        if (body.parentId === undefined) return true;
        return this.access.isOrganizationLevelAdmin(user, found.organizationId);
      case "rtu":
      case "assetGroup":
      case "assetGroupMember":
        await this.access.requireMasterDataUser(user);
        return this.access.canManageLocation(user, found.locationId as string);
      // `asset-points.service.ts`: the asset the point maps.
      case "assetPoint":
        return this.access.canManageAsset(user, found.assetId as string);
      case "pointKey":
        return this.mayManageFleet(user);
      // `SiteControlRoomViewService.putSetting`: the site, then a built-in view is the global admin's only.
      case "siteControlRoomView": {
        const dbUser = await this.access.requireMasterDataUser(user);
        if (!(await this.access.canManageLocation(user, id))) return false;
        if (body.kind === "builtin" && dbUser.role !== "admin") return false;
        return dbUser.role === "admin" || found.storedKind !== "builtin";
      }
      // `SiteLayoutService.makeForSite`: the site, then a dashboard on the site's scope.
      case "siteLayout":
        await this.access.requireMasterDataUser(user);
        if (!(await this.access.canManageLocation(user, id))) return false;
        return this.access.canManageDashboard(user, found.organizationId, { locationId: id, assetGroupId: null, assetId: null });
      case "dashboard":
        return this.access.canManageDashboard(user, found.organizationId, found.scope as Scope);
      case "dashboardTemplate":
        return this.access.canManageTemplate(user, found.organizationId);
      // The route's `assertCanAuthor`: `requireMasterDataUser`, no `location_admin`, then this
      // check, which is already false for a `location_admin`; a throw is the same refusal (`safely`).
      case "assetTemplate":
        return this.access.canManageTemplate(user, found.organizationId);
      case "calcParameter": {
        const scope = found.scope as Scope;
        if (scope.assetId !== null) return this.access.canManageAsset(user, scope.assetId);
        if (scope.locationId !== null) return this.access.canManageLocation(user, scope.locationId);
        return this.access.canManageOrganization(user, found.organizationId);
      }
      // `F3.86` PR 3b: `AssetsAdminService.update` — a body that names `locationId` moves the
      // asset, and the route checks the new site too (its own truthiness test, mirrored).
      // A create under an asset (`parent`) passes `{}`; `calcOverride.set`'s body has no `locationId`.
      case "asset":
        if (!(await this.access.canManageAsset(user, id))) return false;
        if (!body.locationId) return true;
        return this.access.canManageLocation(user, body.locationId as string);
    }
  }

  private async refBelongs(kind: CatalogRefKind, id: string, organizationId: string): Promise<boolean> {
    if (kind === "organization") return id === organizationId;
    const table = {
      location: locations,
      assetGroup: assetGroups,
      asset: assets,
      rtu: rtus,
      dashboard: dashboards,
      dashboardTemplate: dashboardTemplates,
    }[kind];
    const rows = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.organizationId, organizationId)))
        .limit(1),
    );
    return rows.length === 1;
  }
}

/**
 * `F3.86` PR 2 — the row kind a ref names: its own, or, for a field whose kind
 * depends on another field (a grant's `targetId` and `kind`), the one the map
 * gives that field's value. `null` when the map does not name the value: the
 * proposal is refused.
 */
export function refKindOf(ref: CatalogRef, body: Readonly<Record<string, unknown>>): CatalogRefKind | null {
  if ("kind" in ref) return ref.kind;
  const value = body[ref.kindField];
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ref.kinds, value) ? (ref.kinds[value] ?? null) : null;
}
