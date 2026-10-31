import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { assetDomains, locations, orgTrendPoints, organizations, pointKeys, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  OrgTrendPointsDto,
  PutOrgTrendPointsBody,
  SiteTrendPointsDto,
  TrendPointSegmentDto,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { type ResolveOptions, resolveSegments } from "./trend-points.pure";

/**
 * `F4.300` / ADR 0108 decision 3 — the effective trend points per segment, and
 * an organization's replace-all override.
 *
 * **Reads run on `fleetDb` with `organization_id` in the `WHERE`** (ADR 0043
 * Amendment 3): `fleetDb` bypasses Row Level Security, so the predicate is the
 * isolation control, each read bound to an organization the caller was
 * authorized for first. `asset_domains` and `point_keys` are global tables.
 * **The write runs inside `withTenant(tenantDb, organizationId, …)`**, so
 * migration `0117`'s FORCE `tenant_isolation` policy is the backstop behind the
 * `isOrganizationLevelAdmin` gate.
 *
 * Who reads (decision 3.6): everyone who can read the site — the
 * `SiteControlRoomViewService.resolve` rule, an unreadable site a 404. Who
 * edits (decision 3.5): `requireMasterDataUser`, then
 * `isOrganizationLevelAdmin` — an organization admin for their own
 * organization, a global admin for any.
 */
@Injectable()
export class TrendPointsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * The effective list for a site's organization. Readable is "can read the
   * site" (the `SiteControlRoomViewService.resolve` rule): a global scope, or
   * the site among the scope's locations. Anything else is a 404, so an
   * out-of-scope site reads as a missing one. Inactive codes are left out.
   */
  async forSite(jwt: JwtPayload, locationId: string): Promise<SiteTrendPointsDto> {
    const { scope } = await this.accessControl.currentUser(jwt);
    const readable =
      scope.kind === "global" || scope.locations.some((location) => location.id === locationId);
    if (!readable) {
      throw new NotFoundException("Location not found or outside your access scope");
    }
    const [location] = await this.fleetDb
      .select({ id: locations.id, organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!location) {
      throw new NotFoundException("Location not found or outside your access scope");
    }
    return {
      locationId,
      organizationId: location.organizationId,
      segments: await this.effective(location.organizationId, {}),
    };
  }

  /** The admin read: every active segment, with an inactive override code kept and marked (plan C8). */
  async forOrganization(jwt: JwtPayload, organizationId: string): Promise<OrgTrendPointsDto> {
    await this.requireOrganizationEditor(jwt, organizationId);
    await this.requireOrganization(organizationId);
    return { organizationId, segments: await this.effective(organizationId, { includeInactive: true }) };
  }

  /**
   * Replace-all for one (organization, segment) (decision 3.4): delete the
   * segment's rows, insert the body in order (`sort_order` = index). An empty
   * body leaves no row, which is "back to the catalog default". An unknown or
   * inactive segment is a 404; a code not in `point_keys` is a 400 naming it.
   */
  async putSegment(
    jwt: JwtPayload,
    organizationId: string,
    domain: string,
    body: PutOrgTrendPointsBody,
  ): Promise<TrendPointSegmentDto> {
    const user = await this.requireOrganizationEditor(jwt, organizationId);
    await this.requireOrganization(organizationId);

    const [segment] = await this.fleetDb
      .select({ code: assetDomains.code })
      .from(assetDomains)
      .where(and(eq(assetDomains.code, domain), eq(assetDomains.active, true)))
      .limit(1);
    if (!segment) {
      throw new NotFoundException(`Segment ${domain} not found`);
    }

    if (body.pointKeys.length > 0) {
      const known = await this.fleetDb
        .select({ code: pointKeys.code })
        .from(pointKeys)
        .where(inArray(pointKeys.code, body.pointKeys));
      const knownCodes = new Set(known.map((row) => row.code));
      const missing = body.pointKeys.filter((code) => !knownCodes.has(code));
      if (missing.length > 0) {
        throw new BadRequestException(`Unknown point key(s): ${missing.join(", ")}`);
      }
    }

    const updatedBy = await this.provisionedUserId(user.id);
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .delete(orgTrendPoints)
        .where(and(eq(orgTrendPoints.organizationId, organizationId), eq(orgTrendPoints.domain, domain)));
      if (body.pointKeys.length > 0) {
        const updatedAt = new Date();
        await tx.insert(orgTrendPoints).values(
          body.pointKeys.map((pointKey, index) => ({
            organizationId,
            domain,
            pointKey,
            sortOrder: index,
            updatedAt,
            updatedBy,
          })),
        );
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.organization.trend_points.set",
          entityType: "org_trend_points",
          entityId: organizationId,
          organizationId,
          payload: { domain, pointKeys: body.pointKeys },
        },
        tx,
      );
    });

    const segments = await this.effective(organizationId, { includeInactive: true });
    const written = segments.find((s) => s.domain === domain);
    if (!written) {
      // The segment was active a moment ago; a concurrent retire is the only way here.
      throw new NotFoundException(`Segment ${domain} not found`);
    }
    return written;
  }

  private async effective(organizationId: string, options: ResolveOptions): Promise<TrendPointSegmentDto[]> {
    const [domains, catalog, overrides] = await Promise.all([
      this.fleetDb
        .select({
          code: assetDomains.code,
          label: assetDomains.label,
          sortOrder: assetDomains.sortOrder,
          active: assetDomains.active,
        })
        .from(assetDomains)
        .where(eq(assetDomains.active, true)),
      this.fleetDb
        .select({
          code: pointKeys.code,
          name: pointKeys.name,
          unit: pointKeys.unit,
          domain: pointKeys.domain,
          active: pointKeys.active,
          trendDefault: pointKeys.trendDefault,
          headlineRank: pointKeys.headlineRank,
        })
        .from(pointKeys),
      this.fleetDb
        .select({
          domain: orgTrendPoints.domain,
          pointKey: orgTrendPoints.pointKey,
          sortOrder: orgTrendPoints.sortOrder,
          updatedAt: orgTrendPoints.updatedAt,
          updatedBy: orgTrendPoints.updatedBy,
        })
        .from(orgTrendPoints)
        .where(eq(orgTrendPoints.organizationId, organizationId)),
    ]);
    return resolveSegments(domains, catalog, overrides, options);
  }

  /** Decision 3.5: a master-data user, and an organization-level admin of THIS organization. */
  private async requireOrganizationEditor(jwt: JwtPayload, organizationId: string) {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isOrganizationLevelAdmin(jwt, organizationId))) {
      throw new ForbiddenException(
        "Only an organization admin of this organization or a global admin may edit its trend points",
      );
    }
    return user;
  }

  private async requireOrganization(organizationId: string): Promise<void> {
    const [row] = await this.fleetDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Organization not found");
    }
  }

  /**
   * `updated_by` is a foreign key to `bms.users`, so it takes an id read back
   * from that table, never the unverified JWT `sub` an unprovisioned principal
   * hands over (the `SiteControlRoomViewService` precedent).
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
