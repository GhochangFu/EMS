import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";

import {
  alarmEscalationProfiles,
  assetGroupMembers,
  assetGroups,
  assetPoints,
  assetRoles,
  assets,
  assetTemplates,
  automationRules,
  type BmsDb,
  calcParameters,
  dashboards,
  dashboardTemplates,
  dashboardWidgets,
  locations,
  locationTypes,
  mimicLayouts,
  mimicOrgSymbolLibraries,
  notificationChannels,
  organizations,
  pointKeys,
  rtus,
  siteControlRoomViews,
  templatePoints,
} from "@bms/db";
import {
  type JwtPayload,
  type TemplateLifecycleStatus,
  templateLifecycleStatusSchema,
  userGrantKindSchema,
  userRoleSchema,
} from "@bms/shared";
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
  /** `F4.282`: `vocabulary` targets of `locationType` — how many locations in the turn's organizations use the type. */
  readonly usageCount?: number;
  /** Template targets: the version's lifecycle status, for the propose tool's lifecycle mirror (`F4.246`). */
  readonly status?: TemplateLifecycleStatus;
  /**
   * `F4.247` (ADR 0099 Amendment 5 C1): `dashboard` and `assetTemplate` targets — the row's
   * `updated_at` as a millisecond ISO instant, read in the same `SELECT` as the row. A flagged
   * entry's propose tool stores it; the Confirm sends it as `If-Match`.
   */
  readonly updatedAt?: string;
  /** `F4.278` (Amendment 8 D3): `rule` targets — the rule's `lifecycle_status`, so a PATCH of a published rule carries the live line. */
  readonly lifecycle?: string
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
    /**
     * `F4.245` (ADR 0099 Amendment 4, review C1): `"record"` resolves the
     * record a wizard's path names **by its row alone** — the body-dependent
     * checks a proposal needs (a grant's `kind` and `targetId`, an
     * instantiate's site) are not run, because an open wizard's body is what
     * a fill is about to set. `userGrantAdd` reads as its `user` row and
     * `assetTemplateDeploy` as its template row with the organization check.
     * `"propose"` (the default) is every check.
     */
    mode?: CopilotResolveMode,
  ): Promise<ResolvedTarget | null>;
  /**
   * `F4.245` (ADR 0099 Amendment 4): the id of the dashboard `slug` names in
   * the allowed organizations, for the edit page an `open_page` call opens;
   * `null` when none has it or more than one does (the slug is unique per
   * organization only).
   */
  dashboardIdBySlug(slug: string, allowedOrganizationIds: readonly string[]): Promise<string | null>;
}

/** What `resolve` checks: a proposal's every check, or an open wizard's record by its row alone. */
export type CopilotResolveMode = "propose" | "record";

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
  status?: TemplateLifecycleStatus;
  updatedAt?: string;
  usageCount?: number;
  lifecycle?: string
};
type Scope = { locationId: string | null; assetGroupId: string | null; assetId: string | null };
type RowKind = Exclude<CatalogEntry["target"]["kind"], "organization" | "parent" | "fleet" | "vocabulary" | "onboardingSession" | UserKind>;
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
    mode: CopilotResolveMode = "propose",
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
      // `F4.245` (review C1): an open grant-add drawer's record is its user; the grant is what a fill sets.
      const asked: UserTarget = mode === "record" && target.kind === "userGrantAdd" ? { kind: "user", param: target.param } : target;
      found = await this.findUserTarget(asked, params, body, user, allowedOrganizationIds).catch(() => null);
      if (found !== null && !allowedOrganizationIds.includes(found.organizationId)) found = null;
    } else if (target.kind === "fleet" || target.kind === "pointKey" || target.kind === "vocabulary") {
      // Ruling Q1: a row with no organization lives in the conversation's bound organization.
      if (boundOrganizationId === null || !allowedOrganizationIds.includes(boundOrganizationId)) return null;
      const organizationName = await this.organizationName(boundOrganizationId);
      if (organizationName === null) return null;
      if (target.kind === "fleet") {
        found = { organizationId: boundOrganizationId, name: organizationName };
      } else if (target.kind === "vocabulary") {
        // `F4.282` (Amendment 8 D2): an unknown code is refused before the gate is asked.
        const code = params[target.param];
        if (code === undefined) return null;
        found = await this.vocabularyRow(target.of, code, allowedOrganizationIds, boundOrganizationId);
      } else {
        const id = params[target.param];
        if (id === undefined) return null;
        const code = await this.pointKeyCode(id);
        found = code === null ? null : { organizationId: boundOrganizationId, name: code };
      }
      if (found !== null && !(await this.safely(() => this.mayManageFleet(user)))) found = null;
    } else if (target.kind === "rule" && "field" in target) {
      // `F4.278` (Amendment 8 D2): a rule create — the organization is its asset's (`resolveWriteOrg`),
      // and the route's two gates run on the body's asset.
      const assetId = body[target.field];
      if (typeof assetId !== "string") return null;
      found = await this.ruleAsset(assetId, allowedOrganizationIds);
      if (found !== null && !(await this.safely(() => this.mayWriteRule(user, assetId)))) found = null;
    } else {
      const id = params[target.param];
      if (id === undefined) return null;
      const kind = target.kind;
      found = await this.findRow(kind, id, allowedOrganizationIds);
      if (found !== null && !(await this.safely(() => this.mayManage(kind, id, found as Found, user, body, mode)))) found = null;
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
      ...(found.status !== undefined ? { status: found.status } : {}),
      ...(found.updatedAt !== undefined ? { updatedAt: found.updatedAt } : {}),
      ...(found.usageCount !== undefined ? { usageCount: found.usageCount } : {}),
      ...(found.lifecycle !== undefined ? { lifecycle: found.lifecycle } : {}),
    };
  }

  async dashboardIdBySlug(slug: string, allowedOrganizationIds: readonly string[]): Promise<string | null> {
    const ids: string[] = [];
    for (const organizationId of allowedOrganizationIds) {
      const rows = await withTenant(this.tenantDb, organizationId, (tx) =>
        tx
          .select({ id: dashboards.id })
          .from(dashboards)
          .where(and(eq(dashboards.slug, slug), eq(dashboards.organizationId, organizationId)))
          .limit(2),
      );
      ids.push(...rows.map((row) => row.id));
    }
    return ids.length === 1 ? (ids[0] as string) : null;
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

  /**
   * `F4.282` (ADR 0099 Amendment 8 D2) — a vocabulary row's label, by code. Both tables are
   * fleet-wide with no row-level security (the `pointKeyCode` precedent; `VocabulariesService`
   * reads them on the tenant pool). A location type also carries how many locations use it,
   * inactive ones included, summed over the turn's allowed organizations under `withTenant` —
   * never outside the turn's scope. A vocabulary target needs a bound conversation, so that is
   * the bound organization's count alone, not the page's fleet-wide OQ4 count: the card names
   * the organization it counted (`locationType.deactivate`'s summary).
   */
  private async vocabularyRow(
    of: "locationType" | "assetRole",
    code: string,
    allowedOrganizationIds: readonly string[],
    organizationId: string,
  ): Promise<Found | null> {
    if (of === "assetRole") {
      const [role] = await this.tenantDb.select({ label: assetRoles.label }).from(assetRoles).where(eq(assetRoles.code, code)).limit(1);
      return role ? { organizationId, name: role.label } : null;
    }
    const [type] = await this.tenantDb
      .select({ label: locationTypes.label })
      .from(locationTypes)
      .where(eq(locationTypes.code, code))
      .limit(1);
    if (!type) return null;
    let usageCount = 0;
    for (const allowed of allowedOrganizationIds) {
      const [row] = await withTenant(this.tenantDb, allowed, (tx) =>
        tx
          .select({ n: count(locations.id) })
          .from(locations)
          .where(and(eq(locations.type, code), eq(locations.organizationId, allowed))),
      );
      usageCount += Number(row?.n ?? 0);
    }
    return { organizationId, name: type.label, usageCount };
  }

  /** `F4.278`: the asset a rule create names, in the first allowed organization that has it (its name and organization). */
  private async ruleAsset(assetId: string, allowed: readonly string[]): Promise<Found | null> {
    for (const organizationId of allowed) {
      const [row] = await withTenant(this.tenantDb, organizationId, (tx) =>
        tx
          .select({ name: assets.name })
          .from(assets)
          .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
          .limit(1),
      );
      if (row) return { organizationId, name: row.name, assetId };
    }
    return null;
  }

  /**
   * `F4.278` (Amendment 8 D2): the rule routes' own two gates and nothing more —
   * `rules.controller.ts`'s `assertOperationsWriteRole(user, "configuration")` (a throw is a
   * refusal, `safely`), then `RulesService.assertAssetInScope` on the caller's **read** scope:
   * a global admin (`null`) reads every asset; anyone else needs the asset among theirs.
   */
  private async mayWriteRule(user: JwtPayload, ...assetIds: readonly (string | null)[]): Promise<boolean> {
    await this.access.assertOperationsWriteRole(user, "configuration");
    const readable = await this.access.readableAssetIds(user);
    if (readable === null) return true;
    return assetIds.every((assetId) => assetId !== null && readable.includes(assetId));
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
      // `F3.87` PR 2: a layout and an organization symbol library, each `organization_id NOT NULL`.
      case "mimicLayout": {
        const [row] = await tx
          .select({ name: mimicLayouts.name })
          .from(mimicLayouts)
          .where(and(eq(mimicLayouts.id, id), eq(mimicLayouts.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name } : null;
      }
      case "mimicLibrary": {
        const [row] = await tx
          .select({ label: mimicOrgSymbolLibraries.label })
          .from(mimicOrgSymbolLibraries)
          .where(and(eq(mimicOrgSymbolLibraries.id, id), eq(mimicOrgSymbolLibraries.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.label } : null;
      }
      case "dashboard": {
        const [row] = await tx
          .select({
            name: dashboards.name,
            locationId: dashboards.locationId,
            assetGroupId: dashboards.assetGroupId,
            assetId: dashboards.assetId,
            updatedAt: dashboards.updatedAt,
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
          updatedAt: row.updatedAt.toISOString(),
        };
      }
      case "dashboardTemplate": {
        const [row] = await tx
          .select({ name: dashboardTemplates.name, status: dashboardTemplates.status })
          .from(dashboardTemplates)
          .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name, ...lifecycleStatusOf(row.status) } : null;
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
      // `F4.279` (Amendment 8 D2, Q13): a channel of this organization. The organization filter is
      // what keeps a fleet-wide (NULL-organization) channel from ever being found.
      case "notificationChannel": {
        const [row] = await tx
          .select({ name: notificationChannels.name })
          .from(notificationChannels)
          .where(and(eq(notificationChannels.id, id), eq(notificationChannels.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name } : null;
      }
      // `F4.279` (D6): a profile, with the stamp its ladder replace binds to.
      case "escalationProfile": {
        const [row] = await tx
          .select({ name: alarmEscalationProfiles.name, updatedAt: alarmEscalationProfiles.updatedAt })
          .from(alarmEscalationProfiles)
          .where(and(eq(alarmEscalationProfiles.id, id), eq(alarmEscalationProfiles.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name, updatedAt: row.updatedAt.toISOString() } : null;
      }
      // `F4.278`: a rule row — its asset (the scope gate's input) and its lifecycle (D3's live line).
      case "rule": {
        const [row] = await tx
          .select({
            name: automationRules.name,
            assetId: automationRules.assetId,
            lifecycleStatus: automationRules.lifecycleStatus,
          })
          .from(automationRules)
          .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        return {
          organizationId,
          name: row.name,
          ...(row.assetId ? { assetId: row.assetId } : {}),
          lifecycle: row.lifecycleStatus,
        };
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
      // `F4.254` PR 3: the deploy kind reads the same row; only its authority differs (`mayManage`).
      case "assetTemplate":
      case "assetTemplateDeploy": {
        const [row] = await tx
          .select({
            name: assetTemplates.name,
            content: assetTemplates.content,
            status: assetTemplates.status,
            updatedAt: assetTemplates.updatedAt,
          })
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
          ...lifecycleStatusOf(row.status),
          pointKeys: points.map((point) => point.pointKey),
          updatedAt: row.updatedAt.toISOString(),
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

  /**
   * The point-key routes' check (`point-keys.service.ts` `requireGlobalAdmin`): a master-data user who is a global admin.
   * `F4.282`: also the vocabulary routes' `requireGlobalAdmin` (location types, unit roles).
   */
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
      // `F3.87` PR 2: a layout or library create, or a built-in library setting — the mimic services'
      // `assertCanAuthor` on the body's organization.
      case "mimic":
        return this.mayAuthorMimic(user, organizationId);
      // `F4.279`: a channel or profile create, or the severity map — the routes' gate on the body's organization.
      case "notification":
        return this.mayManageNotification(user, organizationId);
    }
  }

  /**
   * `F4.279` (ADR 0099 Amendment 8 D2) — the notification routes' gate, exactly
   * `ChannelsService.loadById`'s and `EscalationProfilesService`'s:
   * `requireMasterDataUser` (a throw, as for an `asset_group_admin`, is a refusal
   * through `safely`), then `canManageNotificationChannel`, which admits `admin`
   * and an `organization_admin` of the organization only.
   */
  private async mayManageNotification(user: JwtPayload, organizationId: string): Promise<boolean> {
    await this.access.requireMasterDataUser(user);
    return this.access.canManageNotificationChannel(user, organizationId);
  }

  /**
   * `F3.87` PR 2 — the mimic services' `assertCanAuthor`
   * (`mimic-layouts.service.ts`, `mimic-symbol-libraries.service.ts`): a
   * master-data user of role `admin` or `organization_admin` (the role first:
   * `canManageOrganization` alone admits a `location_admin`), managing the
   * organization.
   */
  private async mayAuthorMimic(user: JwtPayload, organizationId: string): Promise<boolean> {
    const dbUser = await this.access.requireMasterDataUser(user);
    if (dbUser.role !== "admin" && dbUser.role !== "organization_admin") return false;
    return this.access.canManageOrganization(user, organizationId);
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
    mode: CopilotResolveMode = "propose",
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
      // `F3.87` PR 2: the layout or library row's organization, with the mimic authoring check.
      case "mimicLayout":
      case "mimicLibrary":
        return this.mayAuthorMimic(user, found.organizationId);
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
      // `F4.254` PR 3: the instantiate route's deploy authority (ADR 0015 §7,
      // `AssetTemplateInstantiationService.instantiate` then `instantiateTemplateCore`): a master-data
      // user who manages the template's organization, then the target site — the body's `locationId`,
      // or the site of its `rtuId` (read on the template's organization). `canManageTemplate` is never
      // asked: it is false for a `location_admin`, the one role §7 lets deploy. The refs loop in
      // `resolve` then proves both ids are of the organization (the route's cross-organization 400).
      case "assetTemplateDeploy": {
        await this.access.requireMasterDataUser(user);
        if (!(await this.access.canManageOrganization(user, found.organizationId))) return false;
        // `F4.245` (review C1): an open instantiate wizard's record is the template; the site is what a fill sets.
        if (mode === "record") return true;
        const locationId =
          typeof body.locationId === "string"
            ? body.locationId
            : typeof body.rtuId === "string"
              ? await this.rtuLocationId(body.rtuId, found.organizationId)
              : null;
        return locationId !== null && this.access.canManageLocation(user, locationId);
      }
      case "calcParameter": {
        const scope = found.scope as Scope;
        if (scope.assetId !== null) return this.access.canManageAsset(user, scope.assetId);
        if (scope.locationId !== null) return this.access.canManageLocation(user, scope.locationId);
        return this.access.canManageOrganization(user, found.organizationId);
      }
      // `F3.86` PR 3b: `AssetsAdminService.update` — a body that names `locationId` moves the
      // asset, and the route checks the new site too (its own truthiness test, mirrored).
      // A create under an asset (`parent`) passes `{}`; `calcOverride.set`'s body has no `locationId`.
      // `F4.279` (Amendment 8 D2): the notification routes' gate, on the row's organization.
      case "notificationChannel":
      case "escalationProfile":
        return this.mayManageNotification(user, found.organizationId);
      // `F4.278` (Amendment 8 D2): the rule routes' role class and read-scope gate.
      // `RulesService.updateRule` checks the current asset and the merged one (`mergeRuleDraft`:
      // an absent `assetId` keeps the current asset, `null` clears it), so a body that names
      // `assetId` is checked too — before the proposal check reads that asset's telemetry.
      case "rule": {
        const current = found.assetId ?? null;
        if (mode === "record" || body.assetId === undefined) return this.mayWriteRule(user, current);
        const next = typeof body.assetId === "string" ? body.assetId : null;
        return this.mayWriteRule(user, current, next);
      }
      case "asset":
        if (!(await this.access.canManageAsset(user, id))) return false;
        if (!body.locationId) return true;
        return this.access.canManageLocation(user, body.locationId as string);
    }
  }

  /** The site of an RTU of `organizationId` (the `rtu` row read, under that tenant), or `null`. */
  private async rtuLocationId(rtuId: string, organizationId: string): Promise<string | null> {
    const rtu = await this.findRow("rtu", rtuId, [organizationId]);
    return rtu?.locationId ?? null;
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

/**
 * `F4.246` — a template row's `status` column as the lifecycle vocabulary. A
 * value outside it is left off, so the propose tool's mirror fails closed on
 * it rather than reading an unknown state as admissible.
 */
function lifecycleStatusOf(status: string): { status?: TemplateLifecycleStatus } {
  const parsed = templateLifecycleStatusSchema.safeParse(status);
  return parsed.success ? { status: parsed.data } : {};
}
