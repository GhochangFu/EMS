import { Inject, Injectable } from "@nestjs/common";
import { or, eq } from "drizzle-orm";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";

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
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Persists a master-data audit log entry. */
  async write(input: AuditInput): Promise<void> {
    const [actorRow] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, input.actor.sub), eq(users.email, input.actor.email)))
      .limit(1);

    await this.db.insert(auditLog).values({
      actorId: actorRow?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      payload: input.payload ?? null,
    });
  }
}
