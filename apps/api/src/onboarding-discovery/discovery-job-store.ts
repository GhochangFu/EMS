import { auditLog, onboardingSessions, type BmsDb } from "@bms/db";
import type { OnboardingDiscoveryStored } from "@bms/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { lockSession, type LockedSession } from "../admin/onboarding/onboarding-locked-writes";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";

/**
 * `F3.24b` (ADR 0103 decisions 6 and 9) — the discovery job's three database
 * writes, behind one provider so `discovery-job.service.spec.ts` can record
 * what the job decides without a database.
 *
 * **`jsonb_set`, never the whole draft.** A chat turn can write the draft
 * between the job's two transactions; storing a draft read earlier would
 * undo that turn. Only `draft._discovery` is replaced.
 *
 * **The audit row is written here, directly, on the tenant transaction.**
 * `MasterDataAuditService` imports `copilot/copilot-request-context.ts`,
 * which `tests/f4.24` rule 8 keeps out of the worker's closure. The row
 * carries the session's `organizationId` (the payload's, which the producer
 * took from the locked session row), `actorId: null` (the worker acts for
 * nobody) and never a credential or a sample value.
 */

export type StoredDiscovery = OnboardingDiscoveryStored;

export type DiscoveryAuditRow = {
  readonly organizationId: string;
  readonly sessionId: string;
  readonly action: "onboarding.discovery.finish" | "onboarding.discovery.refuse";
  readonly payload: Record<string, unknown>;
};

@Injectable()
export class DiscoveryJobStore {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  /** A second tenant transaction, opened after the broker window (the first is `runProcessor`'s). */
  inTenant<T>(organizationId: string, fn: (tx: BmsTx) => Promise<T>): Promise<T> {
    return withTenant(this.tenantDb, organizationId, fn);
  }

  lock(tx: BmsTx, sessionId: string): Promise<LockedSession> {
    return lockSession(tx, sessionId);
  }

  async writeDiscovery(tx: BmsTx, sessionId: string, stored: StoredDiscovery): Promise<void> {
    await tx
      .update(onboardingSessions)
      .set({
        draft: sql`jsonb_set(${onboardingSessions.draft}, '{_discovery}', ${JSON.stringify(stored)}::jsonb, true)`,
      })
      .where(eq(onboardingSessions.id, sessionId));
  }

  async audit(tx: BmsTx, row: DiscoveryAuditRow): Promise<void> {
    await tx.insert(auditLog).values({
      organizationId: row.organizationId,
      actorId: null,
      action: row.action,
      entityType: "onboarding_session",
      entityId: row.sessionId,
      payload: row.payload,
    });
  }
}
