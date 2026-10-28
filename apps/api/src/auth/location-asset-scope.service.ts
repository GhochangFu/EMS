import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { AccessControlService } from "./access-control.service";
import { expandLocationSubtrees } from "./location-tree";

/**
 * The answer of {@link LocationAssetScopeService.readableAssetIdsInLocations}:
 * the one organization the locations lie in and the caller's readable asset
 * ids of their subtrees (sorted by id, so an offset cursor over them is
 * stable), or the reason the locations are refused.
 *
 * - `not_found`: no location, or a location id that names no row in the
 *   candidate organizations (another tenant's node starts nothing).
 * - `several_organizations`: the locations lie in more than one organization.
 * - `outside_grant`: the locations exist in a candidate organization, their
 *   subtrees hold no asset the caller reads, and none of them is a location
 *   the caller reads. A site inside the grant that holds no asset is NOT this
 *   refusal: it answers `ok` with no asset ids.
 */
export type LocationAssetScope =
  | { readonly ok: true; readonly organizationId: string; readonly assetIds: readonly string[] }
  | { readonly ok: false; readonly reason: "not_found" | "several_organizations" | "outside_grant" };

/**
 * `F4.291` (ADR 0099 Amendment 9 E5; owner ruling P5, 2026-10-27) — the one
 * place that turns locations (a site and everything under it) into the asset
 * ids the caller may read there. The copilot's list and energy reads use it
 * for `locationId`; `F4.288` and `F4.290` reuse it, which is why it lives in
 * `auth/` and is exported by the `@Global()` `AuthModule` rather than provided
 * by `CopilotModule` (a `ReportsModule` service could not inject a
 * `CopilotModule` provider without a module cycle).
 *
 * Steps, all on `fleetDb` (pre-tenant scope resolution, ADR 0043 Amendment
 * 2/3, as `AccessControlService` reads):
 *
 * 1. place the locations: `bms.locations` rows whose id is asked AND whose
 *    organization is one of `candidateOrganizationIds` — the caller's
 *    server-authorized set (the copilot passes the turn's allowed
 *    organizations), never a raw request value alone;
 * 2. walk their subtrees with `expandLocationSubtrees` (the one recursive CTE
 *    over `bms.locations`, `tests/f2.10-recursive-cte-invariants.test.ts`),
 *    bound to the placed organization;
 * 3. read the caller's readable ids in that organization
 *    (`readableAssetIdsInOrganization`, the grant / RLS scope every copilot
 *    read already uses); none → no asset query;
 * 4. the assets whose `location_id` is in the subtree AND whose id is
 *    readable. **That intersection is the security control**: an asset
 *    inside the subtree and outside the caller's scope is not returned.
 *
 * An empty answer is then told apart from a location outside the grant by
 * `readableLocationIds` (one more scope read, only on the empty path).
 */
@Injectable()
export class LocationAssetScopeService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: Pick<BmsDb, "execute">,
    @Inject(AccessControlService)
    private readonly access: Pick<AccessControlService, "readableAssetIdsInOrganization" | "readableLocationIds">,
  ) {}

  async readableAssetIdsInLocations(
    user: JwtPayload,
    candidateOrganizationIds: readonly string[],
    locationIds: readonly string[],
  ): Promise<LocationAssetScope> {
    const ids = [...new Set(locationIds)];
    if (ids.length === 0 || candidateOrganizationIds.length === 0) return { ok: false, reason: "not_found" };
    const placed = await this.fleetDb.execute<{ id: string; organization_id: string }>(sql`
      SELECT l.id, l.organization_id
        FROM bms.locations l
       WHERE l.id = ANY(${sql.param(ids)}::uuid[])
         AND l.organization_id = ANY(${sql.param([...candidateOrganizationIds])}::uuid[])`);
    if (placed.rows.length !== ids.length) return { ok: false, reason: "not_found" };
    const organizations = new Set(placed.rows.map((row) => row.organization_id));
    if (organizations.size !== 1) return { ok: false, reason: "several_organizations" };
    const [organizationId] = [...organizations] as [string];

    const subtree = await expandLocationSubtrees(this.fleetDb, { organizationIds: [organizationId], ids });
    const readable = await this.access.readableAssetIdsInOrganization(user, organizationId);
    const assetIds = readable.length === 0 || subtree.length === 0 ? [] : await this.assetsIn(subtree, readable);
    if (assetIds.length > 0) return { ok: true, organizationId, assetIds };
    return (await this.insideTheGrant(user, ids)) ? { ok: true, organizationId, assetIds: [] } : { ok: false, reason: "outside_grant" };
  }

  /** Step 4: the subtree's assets the caller reads, sorted by id. */
  private async assetsIn(subtree: readonly string[], readable: readonly string[]): Promise<string[]> {
    const rows = await this.fleetDb.execute<{ id: string }>(sql`
      SELECT a.id
        FROM bms.assets a
       WHERE a.location_id = ANY(${sql.param([...subtree])}::uuid[])
         AND a.id = ANY(${sql.param([...readable])}::uuid[])
       ORDER BY a.id`);
    return rows.rows.map((row) => row.id);
  }

  /** A global admin reads every location; anyone else reads a location in their scope's list. */
  private async insideTheGrant(user: JwtPayload, ids: readonly string[]): Promise<boolean> {
    const readable = await this.access.readableLocationIds(user);
    return readable === null || ids.some((id) => readable.includes(id));
  }
}
