import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { LocationAssetScopeService } from "../auth/location-asset-scope.service";
import type { LocationAssetScope } from "../auth/location-asset-scope.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";

/** The schedule write check's sentence (`F3.5b`), and the site filter's for a location the candidates do not hold. */
export const LOCATION_IDS_OUTSIDE_ORGANIZATION = "locationIds names a location outside the organization";

/** The schedule write check's sentence (`F3.5b`), and the site filter's for a location outside the caller's grant. */
export const LOCATION_IDS_OUTSIDE_SCOPE = "locationIds is outside your access scope";

/** `F4.290`: a site filter is one organization's report; a global admin names one organization's sites per request. */
export const LOCATION_IDS_SEVERAL_ORGANIZATIONS = "locationIds names locations of more than one organization";

/** `LocationAssetScopeService`'s refusal as the HTTP answer a report route gives. */
export function locationIdsRefusal(reason: Extract<LocationAssetScope, { ok: false }>["reason"]): HttpException {
  if (reason === "outside_grant") return new ForbiddenException(LOCATION_IDS_OUTSIDE_SCOPE);
  return new BadRequestException(reason === "several_organizations" ? LOCATION_IDS_SEVERAL_ORGANIZATIONS : LOCATION_IDS_OUTSIDE_ORGANIZATION);
}

/**
 * `F3.5b` (R-12) — the `locationIds` half of `ReportSchedulesService.checkWriteScope`,
 * moved here byte for byte by `F4.290` so the on-demand save stamps a named
 * site list under the schedule's own rule: every id a location of the
 * organization (400), every id in the caller's writable set (403), and `[]`
 * for organization-level rights only (403).
 */
export async function assertLocationIdsInScope(
  deps: { readonly fleetDb: Pick<BmsDb, "select">; readonly accessControl: Pick<AccessControlService, "reportFileReadScope"> },
  jwt: JwtPayload,
  organizationId: string,
  locationIds: readonly string[],
  writableLocations: string[] | null,
): Promise<void> {
  if (locationIds.length > 0) {
    // fleetDb: the organization's own locations, bounded by the requested ids.
    const rows = await deps.fleetDb
      .select({ locationId: locations.id })
      .from(locations)
      .where(and(eq(locations.organizationId, organizationId), inArray(locations.id, [...locationIds])));
    const inOrganization = new Set(rows.map((row) => row.locationId));
    if (!locationIds.every((locationId) => inOrganization.has(locationId))) {
      throw new BadRequestException(LOCATION_IDS_OUTSIDE_ORGANIZATION);
    }
    if (writableLocations !== null) {
      const held = new Set(writableLocations);
      if (!locationIds.every((locationId) => held.has(locationId))) {
        throw new ForbiddenException(LOCATION_IDS_OUTSIDE_SCOPE);
      }
    }
  } else {
    const scope = await deps.accessControl.reportFileReadScope(jwt);
    if (scope.kind === "location") {
      throw new ForbiddenException("An empty location scope requires organization-level rights");
    }
  }
}

/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — the site filter of the on-demand
 * energy report: `locationIds` (each a site and its descendants) to the asset
 * ids the report reads.
 *
 * **Thin on purpose (owner ruling P5).** The subtree walk and the
 * intersection with the caller's readable assets — the security control,
 * "an asset inside the subtree and outside the caller's scope is not read" —
 * are `LocationAssetScopeService`'s (`auth/`), the one helper the copilot's
 * `locationId` reads use too. This file adds only what a report route needs
 * and the copilot does not: the candidate organizations of an HTTP caller (the
 * copilot has its turn's allowed set) and the refusal as an HTTP answer. The
 * scheduled render (`report-render.service.ts`) keeps its own subtree read: it
 * runs with no caller, inside the schedule's tenant transaction, so a
 * caller-scoped service is not its seam.
 *
 * With no `locationIds` every method answers exactly what the routes read
 * before `F4.290` (`readableAssetIds`), and the shared service is not called.
 */
@Injectable()
export class ReportScopeService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: Pick<BmsDb, "selectDistinct">,
    @Inject(AccessControlService)
    private readonly access: Pick<AccessControlService, "readableAssetIds" | "readableOrganizationIds">,
    @Inject(LocationAssetScopeService)
    private readonly locationScope: Pick<LocationAssetScopeService, "readableAssetIdsInLocations">,
  ) {}

  /**
   * The four energy routes: `undefined` → the caller's readable asset ids
   * (`null`: the global admin's whole fleet), as before. Named sites → the
   * caller's readable assets of their subtrees, among the organizations the
   * caller reads; for the global admin (who reads every organization) the
   * candidates are the named locations' own organizations.
   */
  async assetIdsForCaller(jwt: JwtPayload, locationIds: readonly string[] | undefined): Promise<string[] | null> {
    if (locationIds === undefined) return this.access.readableAssetIds(jwt);
    const candidates = (await this.access.readableOrganizationIds(jwt)) ?? (await this.organizationsOf(locationIds));
    return this.assetIdsIn(jwt, candidates, locationIds);
  }

  /** The on-demand save: the named sites' readable assets in the one organization the save resolved. */
  async assetIdsInOrganization(jwt: JwtPayload, organizationId: string, locationIds: readonly string[]): Promise<string[]> {
    return this.assetIdsIn(jwt, [organizationId], locationIds);
  }

  private async assetIdsIn(jwt: JwtPayload, candidates: readonly string[], locationIds: readonly string[]): Promise<string[]> {
    const place = await this.locationScope.readableAssetIdsInLocations(jwt, candidates, locationIds);
    if (!place.ok) throw locationIdsRefusal(place.reason);
    return [...place.assetIds];
  }

  /** fleetDb: the global admin reads every organization, so a named location's own organization is a candidate. */
  private async organizationsOf(locationIds: readonly string[]): Promise<string[]> {
    const rows = await this.fleetDb
      .selectDistinct({ organizationId: locations.organizationId })
      .from(locations)
      .where(inArray(locations.id, [...locationIds]));
    return rows.map((row) => row.organizationId);
  }
}
