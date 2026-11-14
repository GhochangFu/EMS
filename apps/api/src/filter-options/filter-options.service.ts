import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetGroupMembers, assets, locations, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { FilterOptionsResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import { buildFilterOptions } from "./filter-options.rows";
import { assetGroupReadScope, readableAssetGroups } from "./readable-asset-groups";

/**
 * `F4.361` U3 (ADR 0132 decision 2) — `GET /filter-options`: the
 * organizations, location tree, asset groups and assets the caller reads.
 * Every list is built from the caller's own read scope —
 * `currentUser(jwt).scope` (the same source as `/me`) for locations and
 * groups, `readableOrganizationIds` for organizations, `readableAssetIds` for
 * assets — so it lists nothing the caller cannot read. Active rows only
 * (`bms.asset_groups` has no `active`; a group is listed at a listed location).
 *
 * §4.3 fleet read, by name: every read below runs on `fleetDb` because the
 * answer spans **every organization the caller reads** — a multi-organization
 * caller and the global admin's picker list several tenants at once, which no
 * single tenant GUC can serve. Each read is keyed by ids from the caller's own
 * resolved scope (organization, location, group or asset ids), never by a
 * request value; only the admin's (`null`) scopes read unbounded, as
 * `readableAssetIds` already does for it.
 */
@Injectable()
export class FilterOptionsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(AccessControlService)
    private readonly accessControl: Pick<AccessControlService, "currentUser" | "readableAssetIds" | "readableOrganizationIds">,
  ) {}

  async options(user: JwtPayload): Promise<FilterOptionsResponse> {
    const { scope } = await this.accessControl.currentUser(user);
    const readableOrganizations = await this.accessControl.readableOrganizationIds(user);
    const readableAssets = await this.accessControl.readableAssetIds(user);
    const scopeLocationIds = scope.locations.map((location) => location.id);

    const organizationRows =
      readableOrganizations !== null && readableOrganizations.length === 0
        ? []
        : await this.fleetDb
            .select({ id: organizations.id, code: organizations.code, name: organizations.name })
            .from(organizations)
            .where(
              and(
                eq(organizations.active, true),
                readableOrganizations === null ? undefined : inArray(organizations.id, readableOrganizations),
              ),
            )
            .orderBy(asc(organizations.name), asc(organizations.id));

    const locationRows =
      scopeLocationIds.length === 0
        ? []
        : await this.fleetDb
            .select({
              id: locations.id,
              name: locations.name,
              code: locations.code,
              parentId: locations.parentId,
              organizationId: locations.organizationId,
            })
            .from(locations)
            .where(and(inArray(locations.id, scopeLocationIds), eq(locations.active, true)))
            .orderBy(asc(locations.name), asc(locations.id));

    const groupRows = await readableAssetGroups(this.fleetDb, assetGroupReadScope(scope));
    const groupIds = groupRows.map((group) => group.id);
    const memberRows =
      groupIds.length === 0
        ? []
        : await this.fleetDb
            .select({ assetGroupId: assetGroupMembers.assetGroupId, assetId: assetGroupMembers.assetId })
            .from(assetGroupMembers)
            .where(inArray(assetGroupMembers.assetGroupId, groupIds));

    const listedLocationIds = locationRows.map((location) => location.id);
    const assetRows =
      listedLocationIds.length === 0 || (readableAssets !== null && readableAssets.length === 0)
        ? []
        : await this.fleetDb
            .select({
              id: assets.id,
              code: assets.code,
              name: assets.name,
              locationId: assets.locationId,
              organizationId: assets.organizationId,
            })
            .from(assets)
            .where(
              and(
                eq(assets.active, true),
                inArray(assets.locationId, listedLocationIds),
                readableAssets === null ? undefined : inArray(assets.id, readableAssets),
              ),
            )
            .orderBy(asc(assets.name), asc(assets.code), asc(assets.id));

    return buildFilterOptions({
      organizations: organizationRows,
      locations: locationRows,
      assetGroups: groupRows,
      members: memberRows,
      assets: assetRows,
    });
  }
}
