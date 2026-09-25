import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { assetGroups, dashboards, locations, siteControlRoomViews, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  builtinSiteViewKeySchema,
  siteControlRoomViewKindSchema,
  type BuiltinSiteViewKey,
  type JwtPayload,
  type ResolvedSiteControlRoomViewDto,
  type SiteControlRoomViewKind,
  type SiteControlRoomViewSettingDto,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import {
  type DashboardScopeRow,
  dashboardIsScopedToSite,
  resolveSiteControlRoomView,
} from "./site-control-room-view.pure";

/**
 * The `PUT` body the service accepts. A plain `type` (not an `interface`, so it
 * assigns to the audit `payload`), declared here because the request schema is
 * plan unit U4's file: U4's `putSiteControlRoomViewBodySchema` owns the pair
 * rules and its `z.infer` must stay assignable to this.
 */
export type PutSiteControlRoomViewBody = {
  kind: SiteControlRoomViewKind;
  dashboardId?: string | null;
  builtinKey?: BuiltinSiteViewKey | null;
};

type SettingRow = typeof siteControlRoomViews.$inferSelect;

/**
 * `F3.67` / ADR 0076 decision 5 — the per-site Control Room view setting: the
 * admin read and write, and the resolve read every later row consumes.
 *
 * **Reads run on `fleetDb` with a `WHERE` as the isolation control** (ADR 0043
 * Amendment 3, the `locations.service.ts` shape): the location, the setting row
 * keyed by `location_id`, the chosen dashboard and the site's asset groups, each
 * already bound to an id the caller was authorized for. **The write runs inside
 * `withTenant(tenantDb, <the location's organization>, …)`**, so migration
 * `0082`'s `tenant_isolation` policy — its own column plus the `locations` and
 * `dashboards` legs — is the backstop behind the same-organization rule the
 * service enforces first (plan D2).
 */
@Injectable()
export class SiteControlRoomViewService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** The stored setting for the admin form; no row answers `generated` with nulls. */
  async getSetting(jwt: JwtPayload, locationId: string): Promise<SiteControlRoomViewSettingDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    await this.assertCanManageLocation(jwt, locationId);
    const location = await this.readLocation(locationId, "Location not found");

    const [row] = await this.fleetDb
      .select()
      .from(siteControlRoomViews)
      .where(eq(siteControlRoomViews.locationId, locationId))
      .limit(1);
    if (!row) {
      return {
        locationId,
        organizationId: location.organizationId,
        kind: "generated",
        dashboardId: null,
        builtinKey: null,
        updatedAt: null,
        updatedBy: null,
      };
    }
    return toSettingDto(row);
  }

  /**
   * Writes the setting (plan D3: `generated` upserts a row, it never deletes
   * one). `builtin` is the global `admin`'s alone (owner ruling OQ1) — decided
   * on the **database** role `requireMasterDataUser` resolved, never the JWT
   * claim.
   */
  async putSetting(
    jwt: JwtPayload,
    locationId: string,
    body: PutSiteControlRoomViewBody,
  ): Promise<SiteControlRoomViewSettingDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    await this.assertCanManageLocation(jwt, locationId);
    if (body.kind === "builtin" && user.role !== "admin") {
      throw new ForbiddenException("Only the global admin may set a built-in Control Room view");
    }
    const location = await this.readLocation(locationId, "Location not found");

    let dashboardId: string | null = null;
    let builtinKey: BuiltinSiteViewKey | null = null;
    if (body.kind === "dashboard") {
      dashboardId = await this.eligibleDashboardId(body.dashboardId, locationId, location.organizationId);
    } else if (body.kind === "builtin") {
      if (!body.builtinKey) {
        throw new BadRequestException("A built-in view needs a builtinKey");
      }
      builtinKey = body.builtinKey;
    }

    const updatedBy = await this.provisionedUserId(user.id);
    const organizationId = location.organizationId;
    const written = await withTenant(this.tenantDb, organizationId, async (tx) => {
      const updatedAt = new Date();
      const [row] = await tx
        .insert(siteControlRoomViews)
        .values({ locationId, organizationId, kind: body.kind, dashboardId, builtinKey, updatedAt, updatedBy })
        .onConflictDoUpdate({
          target: siteControlRoomViews.locationId,
          // Every column the kind decides is overwritten: a `generated` write
          // over a `builtin` row must null `builtin_key`, or the pair CHECK
          // refuses the update.
          set: { kind: body.kind, dashboardId, builtinKey, updatedAt, updatedBy },
        })
        .returning();

      await this.audit.write(
        {
          actor: jwt,
          action: "master.location.control_room_view.set",
          entityType: "site_control_room_view",
          entityId: locationId,
          organizationId,
          payload: body,
        },
        tx,
      );
      return row;
    });
    return toSettingDto(written);
  }

  /**
   * The effective view for a site (ADR 0076 decision 5). Readable is "can read
   * the site" (ADR 0076 Q14) — the `DashboardController.locationDashboard`
   * rule: a global scope, or the site among the scope's locations. Anything
   * else is a 404, so an out-of-scope site is indistinguishable from a missing
   * one.
   */
  async resolve(jwt: JwtPayload, locationId: string): Promise<ResolvedSiteControlRoomViewDto> {
    const { scope } = await this.accessControl.currentUser(jwt);
    const readable =
      scope.kind === "global" || scope.locations.some((location) => location.id === locationId);
    if (!readable) {
      throw new NotFoundException("Location not found or outside your access scope");
    }
    await this.readLocation(locationId, "Location not found or outside your access scope");

    const [row] = await this.fleetDb
      .select()
      .from(siteControlRoomViews)
      .where(eq(siteControlRoomViews.locationId, locationId))
      .limit(1);

    let dashboard: DashboardScopeRow | null = null;
    let siteGroupIds: ReadonlySet<string> = new Set();
    if (row?.kind === "dashboard" && row.dashboardId !== null) {
      dashboard = await this.readDashboard(row.dashboardId);
      siteGroupIds = await this.siteGroupIds(locationId);
    }

    return resolveSiteControlRoomView(
      locationId,
      row ?? null,
      dashboard,
      siteGroupIds,
      builtinSiteViewKeySchema.options,
    );
  }

  private async assertCanManageLocation(jwt: JwtPayload, locationId: string): Promise<void> {
    if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
  }

  private async readLocation(
    locationId: string,
    notFound: string,
  ): Promise<{ id: string; organizationId: string }> {
    const [location] = await this.fleetDb
      .select({ id: locations.id, organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!location) {
      throw new NotFoundException(notFound);
    }
    return location;
  }

  /**
   * The dashboard a `dashboard` write names, if the site may show it: in the
   * site's organization (read with that organization in the `WHERE`, so another
   * organization's id is simply absent) and scoped to the site or one of its
   * asset groups.
   */
  private async eligibleDashboardId(
    requested: string | null | undefined,
    locationId: string,
    organizationId: string,
  ): Promise<string> {
    if (!requested) {
      throw new BadRequestException("A dashboard view needs a dashboardId");
    }
    const dashboard = await this.readDashboard(requested, organizationId);
    if (dashboard === null) {
      throw new BadRequestException("Dashboard must belong to this site's organization");
    }
    if (!dashboardIsScopedToSite(dashboard, locationId, await this.siteGroupIds(locationId))) {
      throw new BadRequestException(
        "Dashboard must be scoped to this site or to one of its asset groups",
      );
    }
    return dashboard.id;
  }

  /**
   * One dashboard by id — within `organizationId` when one is given (the write
   * path), or wherever it now sits (the resolve path, whose resolver compares
   * the organization itself, plan D5). The id is always in the `WHERE`.
   */
  private async readDashboard(
    id: string,
    organizationId?: string,
  ): Promise<DashboardScopeRow | null> {
    const byId = eq(dashboards.id, id);
    const [dashboard] = await this.fleetDb
      .select({
        id: dashboards.id,
        slug: dashboards.slug,
        organizationId: dashboards.organizationId,
        locationId: dashboards.locationId,
        assetGroupId: dashboards.assetGroupId,
        assetId: dashboards.assetId,
      })
      .from(dashboards)
      .where(organizationId === undefined ? byId : and(byId, eq(dashboards.organizationId, organizationId)))
      .limit(1);
    return dashboard ?? null;
  }

  private async siteGroupIds(locationId: string): Promise<ReadonlySet<string>> {
    const rows = await this.fleetDb
      .select({ id: assetGroups.id })
      .from(assetGroups)
      .where(eq(assetGroups.locationId, locationId));
    return new Set(rows.map((row) => row.id));
  }

  /**
   * `updated_by` is a foreign key to `bms.users`, so it takes an id read back
   * from that table, never the id `requireMasterDataUser` hands over as-is: for
   * an unprovisioned principal that is the unverified JWT `sub`. No such
   * principal can pass `canManageLocation` today (its grants are keyed by an id
   * no grant row holds), so this read is the fail-closed guard for the day that
   * changes, not a path any caller takes now.
   */
  private async provisionedUserId(userId: string): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.id ?? null;
  }
}

/**
 * A stored row as the contract DTO. `kind` and `builtin_key` are narrowed
 * against the contract enums' own options, not `.parse`d (F4.108: a stored
 * value must never surface as a caller's 400). The CHECKs make a miss
 * impossible; if one happens anyway it reads as the generated view.
 */
function toSettingDto(row: SettingRow): SiteControlRoomViewSettingDto {
  const kind = siteControlRoomViewKindSchema.options.find((known) => known === row.kind);
  const builtinKey = builtinSiteViewKeySchema.options.find((known) => known === row.builtinKey);
  return {
    locationId: row.locationId,
    organizationId: row.organizationId,
    kind: kind ?? "generated",
    dashboardId: row.dashboardId,
    builtinKey: builtinKey ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}
