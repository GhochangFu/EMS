import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import { assetDomains } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetDomainDto, AdminAssetDomainsListResponse, JwtPayload, UpdateAssetDomainBody } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";

/** The 403 of both routes. Never includes user data. */
export const ASSET_DOMAIN_ADMIN_DENIAL =
  "The asset domain vocabulary is fleet-wide master data — only a global administrator may manage it";

const DOMAIN_NOT_FOUND = "Asset domain not found";

const COLUMNS = {
  code: assetDomains.code,
  label: assetDomains.label,
  sortOrder: assetDomains.sortOrder,
  active: assetDomains.active,
  workOrderPrefix: assetDomains.workOrderPrefix,
};

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4; plan T7.1, D18) — the global
 * admin's read of `bms.asset_domains` and the one write this row gives it: a domain's
 * work-order reference prefix.
 *
 * **The `LocationTypesVocabularyAdminService` shape.** `bms.asset_domains` is platform
 * vocabulary with no `organization_id` and no row security; the write runs on
 * `FLEET_DRIZZLE` (so no revoke is owed on the table — AGENTS.md section 4.4, the
 * `asset_roles` precedent) and its audit row is org-less, in the same transaction.
 *
 * **Global admin only, the read included.** A prefix names every organization's
 * tickets of that domain, so a tenant administrator may not change it; the screen's
 * read is gated the same way so the page fails closed with its route.
 *
 * **Only the prefix.** A ticket already created keeps its reference (decision 2.3):
 * the allocator reads the prefix when a ticket is made, so a change reaches later
 * tickets only. Nothing is renumbered here.
 */
@Injectable()
export class AssetDomainsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Every domain, active and retired, in `sortOrder` then `code`. */
  async list(jwt: JwtPayload): Promise<AdminAssetDomainsListResponse> {
    await this.requireGlobalAdmin(jwt);
    const rows = await this.fleetDb.select(COLUMNS).from(assetDomains).orderBy(asc(assetDomains.sortOrder), asc(assetDomains.code));
    return { items: rows };
  }

  /** Sets or clears one domain's prefix. 404 for a code that is not a domain. */
  async update(jwt: JwtPayload, code: string, body: UpdateAssetDomainBody): Promise<AdminAssetDomainDto> {
    await this.requireGlobalAdmin(jwt);

    return this.fleetDb.transaction(async (tx) => {
      // Locked, so the audit row's `from` is the value this write replaced.
      const [current] = await tx
        .select({ workOrderPrefix: assetDomains.workOrderPrefix })
        .from(assetDomains)
        .where(eq(assetDomains.code, code))
        .for("update");
      if (!current) {
        throw new NotFoundException(DOMAIN_NOT_FOUND);
      }
      const [updated] = await tx
        .update(assetDomains)
        .set({ workOrderPrefix: body.workOrderPrefix })
        .where(eq(assetDomains.code, code))
        .returning(COLUMNS);
      if (!updated) {
        throw new NotFoundException(DOMAIN_NOT_FOUND);
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_domain.update",
          entityType: "asset_domain",
          // `bms.audit_log.entity_id` is `uuid`; the code travels in `payload`.
          entityId: null,
          organizationId: null,
          payload: { code, fromWorkOrderPrefix: current.workOrderPrefix, toWorkOrderPrefix: body.workOrderPrefix },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * The only gate on this surface. `requireMasterDataUser` resolves the JWT to a
   * `bms.users` row and refuses `operator` and `viewer`; `isGlobalAdmin` then refuses
   * every tenant administrator.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(ASSET_DOMAIN_ADMIN_DENIAL);
    }
  }
}
