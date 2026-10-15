import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { copilotOrgSettings, copilotRoleSettings, copilotUserOverrides, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { CopilotAccessDto, JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { AUTH_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";
import type { PutCopilotAccessBody } from "./copilot-access.schema";

/** Who an exception may name: an administrator whose home organization is the one being set. */
export interface OverrideTarget {
  organizationId: string | null;
  role: string;
}

/** The roles an exception can apply to — `decideCopilotAvailability` reads one only for these. */
const EXCEPTION_ROLES = ["organization_admin", "location_admin", "asset_group_admin"];

export const COPILOT_ACCESS_ROLE_MESSAGE = "The copilot access settings require admin or organization_admin role";
export const COPILOT_ACCESS_SCOPE_MESSAGE = "Organization is outside your access scope";
export const COPILOT_ORG_SWITCH_MESSAGE = "Only the global admin switches the copilot on or off for an organization";
/**
 * `F3.87` plan D3: the organization admin's attachment write on an
 * organization with no switch row. A state conflict (409), as
 * `MIMIC_LAYOUT_STALE_MESSAGE` is — the row is the global admin's to create.
 */
export const COPILOT_ATTACHMENTS_NEEDS_ORG_SWITCH_MESSAGE = "Turn the copilot on for this organization first";
/** One message for an unknown user, another organization's user and a non-administrator alike. */
export const COPILOT_EXCEPTION_TARGET_MESSAGE =
  "A copilot exception can name only an administrator of this organization";

/**
 * An organization's copilot availability settings (`F3.85` PR 3, ADR 0099
 * decision 5): the organization switch, the two role switches and the
 * named-user exceptions.
 *
 * Every method calls `gate()` first. The **role** comes first — `admin` or
 * `organization_admin` — and then `isOrganizationLevelAdmin`, never
 * `canManageOrganization`, which admits a `location_admin` in every
 * organization where it holds one node (security review H1; the
 * `AiAssistantSettingsService.gate()` precedent). A scoped administrator
 * therefore cannot read the settings, set a role switch or grant itself an
 * exception.
 */
@Injectable()
export class CopilotAccessService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  private async gate(jwt: JwtPayload, organizationId: string): Promise<{ id: string; role: string }> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException(COPILOT_ACCESS_ROLE_MESSAGE);
    }
    if (!(await this.accessControl.isOrganizationLevelAdmin(jwt, organizationId))) {
      throw new ForbiddenException(COPILOT_ACCESS_SCOPE_MESSAGE);
    }
    return user;
  }

  /**
   * The home organization and role of the user an exception names, or `null`.
   * Read on the auth pool, which sees every `bms.users` row (the identity
   * resolver's pool). Replaced in specs.
   */
  loadOverrideTarget = async (userId: string): Promise<OverrideTarget | null> => {
    const [row] = await this.authDb
      .select({ organizationId: users.organizationId, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  };

  private async readDto(tx: BmsTx, organizationId: string): Promise<CopilotAccessDto> {
    const [org] = await tx
      .select({ enabled: copilotOrgSettings.enabled, attachmentsEnabled: copilotOrgSettings.attachmentsEnabled })
      .from(copilotOrgSettings)
      .where(eq(copilotOrgSettings.organizationId, organizationId));
    const roles = await tx
      .select({ role: copilotRoleSettings.role, enabled: copilotRoleSettings.enabled })
      .from(copilotRoleSettings)
      .where(eq(copilotRoleSettings.organizationId, organizationId));
    const overrides = await tx
      .select({ userId: copilotUserOverrides.userId, allow: copilotUserOverrides.allow })
      .from(copilotUserOverrides)
      .where(eq(copilotUserOverrides.organizationId, organizationId))
      .orderBy(copilotUserOverrides.userId);
    const roleSwitch = (role: string) => roles.find((row) => row.role === role)?.enabled ?? true;
    return {
      organizationId,
      enabled: org?.enabled ?? false,
      attachmentsEnabled: org?.attachmentsEnabled ?? false,
      roles: { location_admin: roleSwitch("location_admin"), asset_group_admin: roleSwitch("asset_group_admin") },
      overrides,
    };
  }

  async get(jwt: JwtPayload, organizationId: string): Promise<CopilotAccessDto> {
    await this.gate(jwt, organizationId);
    return withTenant(this.tenantDb, organizationId, (tx) => this.readDto(tx, organizationId));
  }

  async put(jwt: JwtPayload, organizationId: string, body: PutCopilotAccessBody): Promise<CopilotAccessDto> {
    const actor = await this.gate(jwt, organizationId);
    if (body.enabled !== undefined && actor.role !== "admin") {
      throw new ForbiddenException(COPILOT_ORG_SWITCH_MESSAGE);
    }
    // A remove only narrows, so it never depends on the user still qualifying:
    // a demoted or moved user's stale row must stay removable. The delete is
    // bounded to this organization by its predicate and by RLS.
    if (body.override !== undefined && body.override.allow !== null) {
      const target = await this.loadOverrideTarget(body.override.userId);
      if (!target || target.organizationId !== organizationId || !EXCEPTION_ROLES.includes(target.role)) {
        throw new ForbiddenException(COPILOT_EXCEPTION_TARGET_MESSAGE);
      }
    }
    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const stamp = { updatedBy: actor.id, updatedAt: new Date() };
      if (body.enabled !== undefined) {
        const values = { enabled: body.enabled, ...stamp };
        await tx
          .insert(copilotOrgSettings)
          .values({ organizationId, ...values })
          .onConflictDoUpdate({ target: copilotOrgSettings.organizationId, set: values });
      }
      if (body.attachmentsEnabled !== undefined) {
        // ADR 0099 Amendment 3 A7. The global admin upserts the switch; a new
        // row takes `enabled` at its column default, false (ruling Q3(a)). The
        // organization admin only UPDATEs an existing row: an insert would
        // create the organization switch it may not set (plan D3).
        const values = { attachmentsEnabled: body.attachmentsEnabled, ...stamp };
        if (actor.role === "admin") {
          await tx
            .insert(copilotOrgSettings)
            .values({ organizationId, ...values })
            .onConflictDoUpdate({ target: copilotOrgSettings.organizationId, set: values });
        } else {
          const updated = await tx
            .update(copilotOrgSettings)
            .set(values)
            .where(eq(copilotOrgSettings.organizationId, organizationId))
            .returning({ organizationId: copilotOrgSettings.organizationId });
          if (updated.length === 0) {
            throw new ConflictException(COPILOT_ATTACHMENTS_NEEDS_ORG_SWITCH_MESSAGE);
          }
        }
      }
      for (const [role, enabled] of Object.entries(body.roles ?? {})) {
        if (enabled === undefined) continue;
        const values = { enabled, ...stamp };
        await tx
          .insert(copilotRoleSettings)
          .values({ organizationId, role, ...values })
          .onConflictDoUpdate({ target: [copilotRoleSettings.organizationId, copilotRoleSettings.role], set: values });
      }
      if (body.override !== undefined) {
        const { userId, allow } = body.override;
        if (allow === null) {
          await tx
            .delete(copilotUserOverrides)
            .where(and(eq(copilotUserOverrides.organizationId, organizationId), eq(copilotUserOverrides.userId, userId)));
        } else {
          const values = { allow, ...stamp };
          await tx
            .insert(copilotUserOverrides)
            .values({ organizationId, userId, ...values })
            .onConflictDoUpdate({
              target: [copilotUserOverrides.organizationId, copilotUserOverrides.userId],
              set: values,
            });
        }
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.copilot_access.update",
          entityType: "copilot_access",
          entityId: organizationId,
          organizationId,
          payload: {
            enabled: body.enabled,
            attachmentsEnabled: body.attachmentsEnabled,
            roles: body.roles,
            override: body.override,
          },
        },
        tx,
      );
      return this.readDto(tx, organizationId);
    });
  }
}
