import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { onboardingSessions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, OnboardingSessionDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import { assertLockerIsGlobalAdmin } from "./onboarding-session-lock.service";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.339` (ADR 0117 decision 9, plan R12) — a global administrator's unlock
 * of an onboarding draft. Its own class so its audit write is reached from one
 * route only (the `F3.85` two-list ledger); the lock is
 * `OnboardingSessionLockService`.
 */
@Injectable()
export class OnboardingSessionUnlockService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly sessions: OnboardingService,
  ) {}

  /** Unlocks a draft: 403 unless a global admin; idempotent — an unlocked draft answers 200 and writes nothing. */
  async unlock(jwt: JwtPayload, sessionId: string): Promise<OnboardingSessionDto> {
    await assertLockerIsGlobalAdmin(this.accessControl, jwt);
    const session = await this.sessions.loadSession(jwt, sessionId);
    await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      const [row] = await tx
        .select({ lockReason: onboardingSessions.lockReason })
        .from(onboardingSessions)
        .where(eq(onboardingSessions.id, sessionId))
        .for("update");
      if (!row || row.lockReason === null) return;
      await tx
        .update(onboardingSessions)
        .set({ lockedAt: null, lockedBy: null, lockReason: null })
        .where(eq(onboardingSessions.id, sessionId));
      await this.audit.write(
        {
          actor: jwt,
          action: "onboarding.session.unlock",
          entityType: "onboarding_session",
          entityId: sessionId,
          organizationId: session.organizationId,
        },
        tx,
      );
    });
    return this.sessions.getSession(jwt, sessionId);
  }
}
