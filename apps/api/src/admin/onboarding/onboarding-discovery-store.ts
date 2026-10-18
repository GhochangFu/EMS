import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";

import { onboardingSessions, type BmsDb } from "@bms/db";
import type { OnboardingDiscoveryStored } from "@bms/shared";

import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { DISCOVERY_KEY } from "./onboarding-discovery-state";
import { lockSession, type LockedSession } from "./onboarding-locked-writes";

/** The advisory-lock key of one organization's discoveries (security review M3). */
export function discoveryLockKey(organizationId: string): string {
  return `onboarding_discovery:${organizationId}`;
}

/**
 * `F3.24b` U3 (ADR 0103 decisions 5 and 9) — the database half of the
 * discovery route, behind one provider so `onboarding-discovery.service.spec.ts`
 * records what the route decides without a database (the worker's
 * `DiscoveryJobStore` precedent).
 *
 * **Lock order.** The organization's advisory lock first, then the session
 * row (`FOR UPDATE`). Only this route takes the advisory lock, and it always
 * takes it first, so two routes cannot hold the two locks crosswise. A chat
 * turn or the worker takes the row lock only.
 *
 * **`jsonb_set`, never the whole draft**, as the worker writes it.
 */
@Injectable()
export class OnboardingDiscoveryStore {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  inTenant<T>(organizationId: string, fn: (tx: BmsTx) => Promise<T>): Promise<T> {
    return withTenant(this.tenantDb, organizationId, fn);
  }

  /** Serialises every discovery start in one organization until the transaction ends. */
  async lockOrganization(tx: BmsTx, organizationId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${discoveryLockKey(organizationId)}, 0))`);
  }

  lock(tx: BmsTx, sessionId: string): Promise<LockedSession> {
    return lockSession(tx, sessionId);
  }

  /**
   * The raw `_discovery` blobs of the organization's **other** draft sessions
   * whose stored status reads `queued` or `running`. The caller parses each
   * and applies the stale rule (`discoveryIsBusy`); a blob that does not parse
   * is not busy, as it is not on the session itself.
   */
  async activeDiscoveriesElsewhere(tx: BmsTx, organizationId: string, sessionId: string): Promise<unknown[]> {
    const rows = await tx
      .select({ discovery: sql<unknown>`${onboardingSessions.draft}->${DISCOVERY_KEY}` })
      .from(onboardingSessions)
      .where(
        and(
          eq(onboardingSessions.organizationId, organizationId),
          eq(onboardingSessions.status, "draft"),
          ne(onboardingSessions.id, sessionId),
          sql`${onboardingSessions.draft}->${DISCOVERY_KEY}->>'status' in ('queued', 'running')`,
        ),
      );
    return rows.map((row) => row.discovery);
  }

  async writeDiscovery(tx: BmsTx, sessionId: string, stored: OnboardingDiscoveryStored): Promise<void> {
    await tx
      .update(onboardingSessions)
      .set({
        draft: sql`jsonb_set(${onboardingSessions.draft}, '{_discovery}', ${JSON.stringify(stored)}::jsonb, true)`,
      })
      .where(eq(onboardingSessions.id, sessionId));
  }
}
