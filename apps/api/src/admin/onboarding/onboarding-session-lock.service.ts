import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { onboardingSessions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, LockOnboardingSessionBody, OnboardingSessionDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveActorId } from "../../auth/identity-resolver";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingService } from "./onboarding.service";

/** `F4.339` (plan R12): the 403 of a lock or unlock by anyone but a global administrator. */
export const LOCK_NEEDS_GLOBAL_ADMIN = "Only a global administrator can lock or unlock an onboarding draft.";
/** `F4.339`: the 409 of a lock on a session that is not a draft. */
export const LOCK_NEEDS_DRAFT = "Only a draft can be locked.";
/** `F4.339`: the 409 of a lock on a draft that is already locked. */
export const ALREADY_LOCKED = "This draft is already locked; unlock it first.";

/**
 * `F4.339` (ADR 0117 decision 9, plan R12, ruling Q7) — a global
 * administrator's lock on an onboarding draft. A locked draft refuses every
 * write with one 409 sentence (`assertSessionStillDraft`) and stays readable.
 * The write runs under the row lock, so a turn in flight either commits first
 * or sees the lock. Kept out of `OnboardingService`, which is at the line cap.
 */
@Injectable()
export class OnboardingSessionLockService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly sessions: OnboardingService,
  ) {}

  /** Locks a draft: 403 unless a global admin, 409 on a non-draft or an already locked draft. */
  async lock(jwt: JwtPayload, sessionId: string, body: LockOnboardingSessionBody): Promise<OnboardingSessionDto> {
    await this.assertGlobalAdmin(jwt);
    const session = await this.sessions.loadSession(jwt, sessionId);
    const actorId = await resolveActorId(this.fleetDb, jwt);
    await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      const [row] = await tx
        .select({ status: onboardingSessions.status, lockReason: onboardingSessions.lockReason })
        .from(onboardingSessions)
        .where(eq(onboardingSessions.id, sessionId))
        .for("update");
      if (!row || row.status !== "draft") throw new ConflictException(LOCK_NEEDS_DRAFT);
      if (row.lockReason !== null) throw new ConflictException(ALREADY_LOCKED);
      await tx
        .update(onboardingSessions)
        .set({ lockedAt: sql`now()`, lockedBy: actorId, lockReason: body.reason })
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")));
      await this.audit.write(
        {
          actor: jwt,
          action: "onboarding.session.lock",
          entityType: "onboarding_session",
          entityId: sessionId,
          organizationId: session.organizationId,
          payload: { reason: body.reason },
        },
        tx,
      );
    });
    return this.sessions.getSession(jwt, sessionId);
  }

  /** Unlocks a draft: 403 unless a global admin; idempotent — an unlocked draft answers 200 and writes nothing. */
  async unlock(jwt: JwtPayload, sessionId: string): Promise<OnboardingSessionDto> {
    await this.assertGlobalAdmin(jwt);
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

  private async assertGlobalAdmin(jwt: JwtPayload): Promise<void> {
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(LOCK_NEEDS_GLOBAL_ADMIN);
    }
  }
}
