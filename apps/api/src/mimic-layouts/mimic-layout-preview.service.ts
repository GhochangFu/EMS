import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { assetGroups } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { DashboardMimicNodesResponseDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F4.308` / ADR 0081 Amendment 2 — "Preview with site": one stored layout resolved against one
 * asset group, read-only. Nothing is written and no audit row is made.
 *
 * **The check order (plan C2; decisions 2 and 3: every 404 before the 403).**
 * 1. The layout, through `MimicLayoutsService.fetchReadable` — outside the caller's readable
 *    organizations it is "Mimic layout not found", so an id reveals nothing.
 * 2. The group, which must belong to the LAYOUT's organization — missing, or another
 *    organization's, or outside the caller's readable locations, it is "Asset group not found".
 *    Read on `TENANT_DRIZZLE` inside `withTenant(layout.organizationId)` (§4.3: a tenant read
 *    defaults to `withTenant`); the `organization_id` predicate restates the policy so the check
 *    does not rest on RLS alone.
 * 3. `assertCanAuthor` — only `admin` and `organization_admin` managing that organization
 *    (Q3 a); any other role is the 403 here, after the 404s.
 * 4. `readableAssetIds` narrows the members, as on a dashboard.
 * 5. The resolver (`MimicNodesService.readLayoutPreview`, on `FLEET_POOL`, every statement
 *    carrying the organization). A layout it no longer finds — deleted between (1) and (5) — is
 *    the same 404 as (1) (plan C5).
 */
@Injectable()
export class MimicLayoutPreviewService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly layouts: MimicLayoutsService,
    private readonly resolver: MimicNodesService,
    private readonly accessControl: AccessControlService,
  ) {}

  async preview(jwt: JwtPayload, layoutId: string, assetGroupId: string): Promise<DashboardMimicNodesResponseDto> {
    const layout = await this.layouts.fetchReadable(jwt, layoutId);
    const [group] = await withTenant(this.tenantDb, layout.organizationId, (tx) =>
      tx
        .select({ id: assetGroups.id, locationId: assetGroups.locationId })
        .from(assetGroups)
        .where(and(eq(assetGroups.id, assetGroupId), eq(assetGroups.organizationId, layout.organizationId)))
        .limit(1),
    );
    // A group outside the caller's readable locations is the same 404 as an unknown id, so a
    // scoped caller cannot learn that an unseen group exists (decision 2; security review).
    const readableLocations = group ? await this.accessControl.readableLocationIds(jwt) : null;
    if (!group || (readableLocations !== null && !readableLocations.includes(group.locationId))) {
      throw new NotFoundException("Asset group not found");
    }
    await this.layouts.assertCanAuthor(jwt, layout.organizationId);
    const readableAssetIds = await this.accessControl.readableAssetIds(jwt);
    const answer = await this.resolver.readLayoutPreview(
      layout.organizationId,
      layout.id,
      assetGroupId,
      readableAssetIds,
      Date.now(),
    );
    if (answer.widgets.length === 0) {
      throw new NotFoundException("Mimic layout not found");
    }
    return answer;
  }
}
