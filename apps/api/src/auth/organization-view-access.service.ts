import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { dashboards, locations, organizationControlRoomViews, userLocationAccess } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { AccessControlService } from "./access-control.service";

/**
 * `F4.317` task 4.1 (ADR 0112 decision 5) — who may change an organization's Control Room strip,
 * and which dashboard its view row points at. A sibling of `AccessControlService` rather than
 * more of it (that file sits at the AGENTS.md §4.5 cap).
 *
 * **The `location_admin` grant is narrow, and this is where it is stated.** A location admin of
 * an organization may change that organization's strip: its `organization` templates (task 3.2),
 * its view row, and the ONE dashboard the row points at. It is not a leg of
 * `AccessControlService.canManageDashboard`: that predicate's organization-wide refusal (ADR 0047
 * Amendment 2 ruling 2, `F3.1d`) stands for every other organization-wide dashboard, and the
 * grant is applied beside it only where both predicates of this file hold (task 4.3).
 *
 * **Both reads are on `fleetDb` (BYPASSRLS) with every predicate explicit**: the grant read binds
 * the location's `organization_id`, and the pointer read binds the row's organization, its
 * dashboard and that dashboard's own organization, so neither can be answered by another
 * organization's row.
 */
@Injectable()
export class OrganizationViewAccessService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * The global admin; an `organization_admin` holding a direct grant on the organization; a
   * `location_admin` holding a direct location grant at a location of the organization. Every
   * other role — `asset_group_admin`, `operator`, `viewer` — is `false`, never a throw: the caller
   * owns the 403 and its sentence.
   */
  async canManageOrganizationView(jwt: JwtPayload, organizationId: string): Promise<boolean> {
    if (await this.accessControl.isOrganizationLevelAdmin(jwt, organizationId)) {
      return true;
    }
    const { user } = await this.accessControl.currentUser(jwt);
    if (user.role !== "location_admin") {
      return false;
    }
    // An unprovisioned principal's `id` is the JWT `sub`, which no grant row holds: `false`.
    const [grant] = await this.fleetDb
      .select({ id: userLocationAccess.id })
      .from(userLocationAccess)
      .innerJoin(locations, eq(locations.id, userLocationAccess.locationId))
      .where(and(eq(userLocationAccess.userId, user.id), eq(locations.organizationId, organizationId)))
      .limit(1);
    return grant !== undefined;
  }

  /** Whether `dashboardId` is the dashboard `organizationId`'s view row points at, in that organization. */
  async isPointedOrganizationDashboard(organizationId: string, dashboardId: string): Promise<boolean> {
    const [row] = await this.fleetDb
      .select({ organizationId: organizationControlRoomViews.organizationId })
      .from(organizationControlRoomViews)
      .innerJoin(dashboards, eq(dashboards.id, organizationControlRoomViews.dashboardId))
      .where(
        and(
          eq(organizationControlRoomViews.organizationId, organizationId),
          eq(organizationControlRoomViews.dashboardId, dashboardId),
          eq(dashboards.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * `F4.317` task 4.3 — the narrow grant `DashboardsService.putWidgets` and `update` apply where
   * `canManageDashboard` refused. True only when ALL hold: the stored dashboard is
   * organization-wide, the write leaves it organization-wide (`nextScope`: `update`'s merged scope;
   * `putWidgets` passes the stored one), it is the dashboard its organization's view row points
   * at, and the caller may change that organization's strip. A re-home (the `F3.1d` case) changes
   * the scope and is refused; `remove` and `create` never ask.
   */
  async mayEditPointedDashboard(
    jwt: JwtPayload,
    dashboard: DashboardScopeRow,
    nextScope: ScopeColumns,
  ): Promise<boolean> {
    if (!isOrganizationWide(dashboard) || !isOrganizationWide(nextScope)) {
      return false;
    }
    if (!(await this.isPointedOrganizationDashboard(dashboard.organizationId, dashboard.id))) {
      return false;
    }
    return this.canManageOrganizationView(jwt, dashboard.organizationId);
  }
}

/** The three nullable scope columns of a dashboard write. */
type ScopeColumns = {
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
};

/** The stored row the grant asks about: its id, its organization and its scope. */
type DashboardScopeRow = ScopeColumns & { readonly id: string; readonly organizationId: string };

function isOrganizationWide(scope: ScopeColumns): boolean {
  return scope.locationId === null && scope.assetGroupId === null && scope.assetId === null;
}
