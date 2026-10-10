import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { copilotOrgSettings, copilotRoleSettings, copilotUserOverrides } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";
import { type CopilotAccessReads, type CopilotAvailability, decideCopilotAvailability } from "./copilot-availability";

function readsIn(tx: BmsTx, organizationId: string): CopilotAccessReads {
  return {
    orgEnabled: async () => {
      const [row] = await tx
        .select({ enabled: copilotOrgSettings.enabled })
        .from(copilotOrgSettings)
        .where(eq(copilotOrgSettings.organizationId, organizationId));
      return row?.enabled ?? null;
    },
    roleEnabled: async (role) => {
      const [row] = await tx
        .select({ enabled: copilotRoleSettings.enabled })
        .from(copilotRoleSettings)
        .where(and(eq(copilotRoleSettings.organizationId, organizationId), eq(copilotRoleSettings.role, role)));
      return row?.enabled ?? null;
    },
    userOverride: async (userId) => {
      const [row] = await tx
        .select({ allow: copilotUserOverrides.allow })
        .from(copilotUserOverrides)
        .where(and(eq(copilotUserOverrides.organizationId, organizationId), eq(copilotUserOverrides.userId, userId)));
      return row?.allow ?? null;
    },
  };
}

/**
 * Whether the administrator copilot is available to a user here (`F3.85`,
 * ADR 0099 decision 5). The rules are `decideCopilotAvailability`'s; this
 * service binds its reads to one `withTenant` transaction on the organization
 * asked about, so every read is policy-filtered to that organization. A
 * cross-organization question (the global admin, `null`) reads nothing.
 */
@Injectable()
export class CopilotAvailabilityService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  async decide(identity: ResolvedIdentity | null, organizationId: string | null): Promise<CopilotAvailability> {
    if (organizationId === null) {
      return decideCopilotAvailability(identity, null, () => {
        throw new Error("a cross-organization decision reads no switch");
      });
    }
    return withTenant(this.tenantDb, organizationId, (tx) =>
      decideCopilotAvailability(identity, organizationId, (id) => readsIn(tx, id)),
    );
  }
}
