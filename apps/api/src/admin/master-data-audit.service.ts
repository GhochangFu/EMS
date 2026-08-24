import { Inject, Injectable } from "@nestjs/common";
import { or, eq } from "drizzle-orm";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";

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
  constructor(@Inject(TENANT_DRIZZLE) private readonly db: BmsDb) {}

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
   */
  async write(input: AuditInput, executor: BmsDb = this.db): Promise<void> {
    const [actorRow] = await executor
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
