import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { portalSettings, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { colourProfileOrDefault, designSystemOrDefault } from "@bms/shared";
import type {
  JwtPayload,
  PortalAppearanceDto,
  PublicAppearanceDto,
  SetMyAppearanceBody,
  SetPortalAppearanceBody,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";

/**
 * `F4.341` (ADR 0118 decisions 9, 10 and 12) — the portal default appearance and a user's own.
 *
 * Every read and write here runs on `fleetDb`. `bms.portal_settings` is a global table with no
 * organization (no RLS, the `location_types` shape) and one row, seeded by migration 0134; the
 * pool holds SELECT and UPDATE on it and nothing else. `bms.users` is reached for the caller's own
 * row only (`requireProvisionedUserId`), so a global `admin` with no home organization can set
 * theirs too; the pool holds a column UPDATE grant on the two appearance columns alone.
 */
@Injectable()
export class PortalSettingsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** The portal row. A missing row (the migration seeds it) reads as today's look, never a 500. */
  private async readRow(db: BmsDb = this.fleetDb): Promise<PortalAppearanceDto> {
    const [row] = await db.select().from(portalSettings).where(eq(portalSettings.id, 1)).limit(1);
    return {
      designSystem: designSystemOrDefault(row?.designSystem),
      colourProfile: colourProfileOrDefault(row?.colourProfile),
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /** `GET /public/appearance` — no session: exactly the two enum values, nothing else. */
  async readPublic(): Promise<PublicAppearanceDto> {
    const { designSystem, colourProfile } = await this.readRow();
    return { designSystem, colourProfile };
  }

  /** `GET /admin/portal-settings/appearance` — the global `admin` only. */
  async read(jwt: JwtPayload): Promise<PortalAppearanceDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);
    return this.readRow();
  }

  /**
   * `PUT /admin/portal-settings/appearance` — the global `admin` only; every other role is a 403
   * before any read. One platform audit row (`organizationId: null`) with the old and the new
   * values, in the same transaction as the write.
   */
  async write(jwt: JwtPayload, body: SetPortalAppearanceBody): Promise<PortalAppearanceDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    return this.fleetDb.transaction(async (tx) => {
      const before = await this.readRow(tx);
      await tx
        .update(portalSettings)
        .set({ designSystem: body.designSystem, colourProfile: body.colourProfile, updatedAt: sql`now()`, updatedBy: user.id })
        .where(eq(portalSettings.id, 1));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.portal.appearance.update",
          entityType: "portal_settings",
          entityId: null,
          organizationId: null,
          payload: {
            from: { designSystem: before.designSystem, colourProfile: before.colourProfile },
            to: { designSystem: body.designSystem, colourProfile: body.colourProfile },
          },
        },
        tx,
      );
      return this.readRow(tx);
    });
  }

  /**
   * `PUT /me/appearance` — any signed-in, provisioned user, for their own row only (the id comes
   * from the session, never the request). `null` clears a value. One audit row with the old and
   * the new values; `organizationId` is the user's home organization (null for a global admin).
   */
  async writeMine(jwt: JwtPayload, body: SetMyAppearanceBody): Promise<SetMyAppearanceBody> {
    const userId = await this.accessControl.requireProvisionedUserId(jwt);

    return this.fleetDb.transaction(async (tx) => {
      const [before] = await tx
        .select({ designSystem: users.designSystem, colourProfile: users.colourProfile, organizationId: users.organizationId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const updated = await tx
        .update(users)
        .set({ designSystem: body.designSystem, colourProfile: body.colourProfile })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (updated.length === 0) {
        // The row went between the identity lookup and the write: no audit row, no claimed success.
        throw new ConflictException("This account changed while saving; sign in again and retry");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "user.appearance.update",
          entityType: "user",
          entityId: userId,
          organizationId: before?.organizationId ?? null,
          payload: {
            from: { designSystem: before?.designSystem ?? null, colourProfile: before?.colourProfile ?? null },
            to: { designSystem: body.designSystem, colourProfile: body.colourProfile },
          },
        },
        tx,
      );
      return { designSystem: body.designSystem, colourProfile: body.colourProfile };
    });
  }
}
