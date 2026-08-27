import { Inject, Injectable } from "@nestjs/common";
import { or, eq } from "drizzle-orm";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";

type AuditInput = {
  actor: Pick<JwtPayload, "sub" | "email">;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  payload?: Record<string, unknown>;
};

/** Writes audit rows for master-data mutations. */
@Injectable()
export class MasterDataAuditService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * Persists a master-data audit log entry.
   *
   * `executor` lets a caller pass its own open `tx` instead of `this.db`.
   * **Required** when the write happens inside a transaction: `pg`'s pool
   * defaults to `max: 10` with no acquisition timeout
   * (`apps/api/src/database/database.module.ts`), so asking the pool for a
   * *second* client while the first sits inside an open transaction can wedge
   * every pooled client waiting on one another with no timeout to break the
   * deadlock. Passing `tx` also makes the audit row atomic with the mutation
   * it describes — without it, a rolled-back transaction can leave an audit
   * row on disk describing a write that never happened.
   *
   * E7.1b Amendment 4 — the actor identity read runs on `fleetDb` (`bms_fleet`,
   * BYPASSRLS), not on the write `executor`. `bms.users` gains a NULL-tolerant
   * `tenant_isolation` policy + FORCE in `0047`. The audit-outside-`withTenant`
   * callers (assets, rtus, point-keys) invoke `write` with no
   * `app.current_organization` set, so a bare tenant read there would see only
   * NULL-org users — and a scoped actor's `organization_id` is non-NULL after
   * the `0046` backfill, so `actorId` would silently resolve to NULL and the
   * audit row would lose its actor. The fleet pool sees the row regardless of
   * org, and it is a separate `pg` pool from the tenant one, so this second
   * lookup never contends with an open tenant transaction on `executor`. The
   * insert itself stays on `executor` — its `organization_id` is NULL this item
   * (population is E7.1c), which the `0047` NULL-tolerant `WITH CHECK` admits
   * whether or not a GUC is set.
   */
  async write(input: AuditInput, executor: BmsDb = this.db): Promise<void> {
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, input.actor.sub), eq(users.email, input.actor.email)))
      .limit(1);

    await executor.insert(auditLog).values({
      actorId: actorRow?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      payload: input.payload ?? null,
    });
  }
}
