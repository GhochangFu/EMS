import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withUser } from "../database/user-context";

/** ADR 0099 decision 8: copilot history is kept for 30 days after its last use. */
export const COPILOT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

/** What one purge tick did — counts only, never an id or any content. */
export type CopilotPurgeSummary = {
  readonly users: number;
  readonly conversationsDeleted: number;
  readonly pendingChangesDeleted: number;
  readonly claimsFailed: number;
  readonly durationMs: number;
};

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — the `copilot-purge` tick's body: the
 * copilot history's 30-day retention.
 *
 * **Two pools, injected here.** The fleet pool lists `users.id` and nothing
 * else — `0105` revokes the three copilot tables from `bms_fleet`, and
 * `bms_fleet` holds a column grant on `users.id`. Every write then runs on
 * the tenant pool inside `withUser(tenantDb, id)`, one transaction per user,
 * because the `user_isolation` policy compares `user_id` with
 * `app.current_user` and there is no fleet path through it. A transaction
 * with no setting deletes nothing (`copilot-purge.integration.spec.ts`
 * proves it for the owner too, bound by FORCE).
 *
 * Per user, in this order:
 *
 * 1. delete the conversations whose `last_turn_at` is older than the cut-off
 *    — their messages cascade and their pending changes keep the row with
 *    `conversation_id` set to NULL (the composite FK in `0105`), so an
 *    applied change's record outlives its conversation;
 * 2. delete the orphaned `pending` and `rejected` changes proposed before the
 *    cut-off — after step 1, so a pending change step 1 just orphaned goes
 *    in the same tick;
 * 3. fail the `applying` claims older than the cut-off. A claim that old is
 *    past anything `sweepStuck` (five minutes, per request) could resolve
 *    from the audit log; it stays as a `failed` record rather than going.
 *
 * Every statement is idempotent, so a retried tick finds nothing more. The
 * cut-off is computed from `now` and bound as a parameter, never
 * concatenated.
 *
 * **Self-contained by rule.** This file imports nothing else from `copilot/`:
 * `tests/f4.24` rule 8 allows only the purge leaves in the worker's closure,
 * and anything else here would pull the API's copilot module (and its
 * controllers, rule 6) into the worker.
 */
@Injectable()
export class CopilotPurgeService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  async purge(now: Date = new Date()): Promise<CopilotPurgeSummary> {
    const started = Date.now();
    const cutoff = new Date(now.getTime() - COPILOT_RETENTION_DAYS * DAY_MS).toISOString();
    const { rows } = await this.fleetDb.execute<{ id: string }>(sql`SELECT id FROM bms.users ORDER BY id`);
    let conversationsDeleted = 0;
    let pendingChangesDeleted = 0;
    let claimsFailed = 0;
    for (const { id } of rows) {
      const counts = await withUser(this.tenantDb, id, async (tx) => {
        const conversations = await tx.execute(sql`
          DELETE FROM bms.copilot_conversations
           WHERE last_turn_at < ${cutoff}::timestamptz`);
        const pending = await tx.execute(sql`
          DELETE FROM bms.copilot_pending_changes
           WHERE conversation_id IS NULL
             AND status IN ('pending', 'rejected')
             AND proposed_at < ${cutoff}::timestamptz`);
        const failed = await tx.execute(sql`
          UPDATE bms.copilot_pending_changes
             SET status = 'failed', finished_at = now()
           WHERE status = 'applying'
             AND claimed_at < ${cutoff}::timestamptz`);
        return {
          conversations: conversations.rowCount ?? 0,
          pending: pending.rowCount ?? 0,
          failed: failed.rowCount ?? 0,
        };
      });
      conversationsDeleted += counts.conversations;
      pendingChangesDeleted += counts.pending;
      claimsFailed += counts.failed;
    }
    return {
      users: rows.length,
      conversationsDeleted,
      pendingChangesDeleted,
      claimsFailed,
      durationMs: Date.now() - started,
    };
  }
}
