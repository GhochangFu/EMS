import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
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
  /** `bms.copilot_usage` rows dated before the cut-off day (ADR 0099 Amendment 1 A1). */
  readonly usageRowsDeleted: number;
  /** `bms.copilot_org_usage` rows dated before the cut-off day (A1). */
  readonly orgUsageRowsDeleted: number;
  readonly durationMs: number;
};

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — the `copilot-purge` tick's body: the
 * copilot history's 30-day retention, and since PR 6 the usage counters'
 * (ADR 0099 Amendment 1 A1).
 *
 * **Two pools, injected here.** The fleet pool lists `users.id` and
 * `organizations.id` and nothing else — `0105` revokes the three copilot
 * tables from `bms_fleet`, `0106` the two usage counters, and `bms_fleet`
 * holds a column grant on `users.id`. Every write then runs on the tenant
 * pool: the per-user steps inside `withUser(tenantDb, id)`, one transaction
 * per user, because the `user_isolation` policy compares `user_id` with
 * `app.current_user` and there is no fleet path through it; the
 * organization counters inside `withTenant` (below). A transaction
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
 *    from the audit log; it stays as a `failed` record rather than going;
 * 4. delete the user's `copilot_usage` counters dated before the cut-off day
 *    (`F3.85` PR 6, ADR 0099 Amendment 1 A1) — the same `user_isolation`.
 *
 * Then, per organization listed on the fleet pool, one `withTenant`
 * transaction deletes its `copilot_org_usage` counters dated before the
 * cut-off day: that table's policy is `tenant_isolation` on
 * `app.current_organization`, so a per-user transaction reaches none of it.
 * The cut-off day is the UTC calendar date of the cut-off instant.
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
    // The counters' `day` is a calendar date: the UTC date of the cut-off instant.
    const cutoffDay = cutoff.slice(0, 10);
    const { rows } = await this.fleetDb.execute<{ id: string }>(sql`SELECT id FROM bms.users ORDER BY id`);
    let conversationsDeleted = 0;
    let pendingChangesDeleted = 0;
    let claimsFailed = 0;
    let usageRowsDeleted = 0;
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
        const usage = await tx.execute(sql`
          DELETE FROM bms.copilot_usage
           WHERE day < ${cutoffDay}::date`);
        return {
          conversations: conversations.rowCount ?? 0,
          pending: pending.rowCount ?? 0,
          failed: failed.rowCount ?? 0,
          usage: usage.rowCount ?? 0,
        };
      });
      conversationsDeleted += counts.conversations;
      pendingChangesDeleted += counts.pending;
      claimsFailed += counts.failed;
      usageRowsDeleted += counts.usage;
    }
    const orgs = await this.fleetDb.execute<{ id: string }>(sql`SELECT id FROM bms.organizations ORDER BY id`);
    let orgUsageRowsDeleted = 0;
    for (const { id } of orgs.rows) {
      const deleted = await withTenant(this.tenantDb, id, (tx) =>
        tx.execute(sql`
          DELETE FROM bms.copilot_org_usage
           WHERE day < ${cutoffDay}::date`),
      );
      orgUsageRowsDeleted += deleted.rowCount ?? 0;
    }
    return {
      users: rows.length,
      conversationsDeleted,
      pendingChangesDeleted,
      claimsFailed,
      usageRowsDeleted,
      orgUsageRowsDeleted,
      durationMs: Date.now() - started,
    };
  }
}
