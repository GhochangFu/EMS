import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { onboardingSessions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, LockOnboardingSessionBody, OnboardingSessionDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveActorId } from "../../auth/identity-resolver";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { looksLikeCredential } from "../../security/credential-detect";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingService } from "./onboarding.service";

/** `F4.339` (plan R12): the 403 of a lock or unlock by anyone but a global administrator. */
export const LOCK_NEEDS_GLOBAL_ADMIN = "Only a global administrator can lock or unlock an onboarding draft.";
/** `F4.339`: the 409 of a lock on a session that is not a draft. */
export const LOCK_NEEDS_DRAFT = "Only a draft can be locked.";
/** `F4.339`: the 409 of a lock on a draft that is already locked. */
export const ALREADY_LOCKED = "This draft is already locked; unlock it first.";
/** `F4.339` review L2: the 400 of a reason that looks like a secret — it is copied into every refusal and the audit. */
export const LOCK_REASON_LOOKS_LIKE_A_SECRET = "The lock reason looks like it contains a credential; describe the reason without it.";

/**
 * `F4.339` (ADR 0117 decision 9, plan R12, ruling Q7) — a global
 * administrator's lock on an onboarding draft. A locked draft refuses every
 * write with one 409 sentence (`assertSessionStillDraft`) and stays readable.
 * The write runs under the row lock, so a turn in flight either commits first
 * or sees the lock. Kept out of `OnboardingService`, which is at the line cap;
 * the unlock is its own class (`OnboardingSessionUnlockService`) so each audit
 * write has one route (the `F3.85` two-list ledger).
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
    if (looksLikeCredential(body.reason)) throw new BadRequestException(LOCK_REASON_LOOKS_LIKE_A_SECRET);
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

  private assertGlobalAdmin(jwt: JwtPayload): Promise<void> {
    return assertLockerIsGlobalAdmin(this.accessControl, jwt);
  }
}

/** `F4.339`: the 403 unless a global administrator — shared with {@link OnboardingSessionUnlockService}. */
export async function assertLockerIsGlobalAdmin(accessControl: AccessControlService, jwt: JwtPayload): Promise<void> {
  if (!(await accessControl.isGlobalAdmin(jwt))) {
    throw new ForbiddenException(LOCK_NEEDS_GLOBAL_ADMIN);
  }
}
