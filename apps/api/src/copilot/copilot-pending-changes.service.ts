import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { withUser } from "../database/user-context";

/** What the interceptor needs before it claims: the row's organization, for the availability check. */
export type PendingChangePeek = { organizationId: string };

/** The stored request a claimed change must match. */
export type ClaimedChange = {
  method: string;
  path: string;
  bodyHash: string;
  organizationId: string;
  catalogId: string;
};

export type PendingChangeOutcome = "applied" | "failed";

/** A claim older than this is stuck: the request that held it died before it recorded an outcome (plan Q4). */
export const STUCK_AFTER_MINUTES = 5;

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — the pending-change rows behind the
 * `X-Copilot-Change` header. Every statement runs in `withUser` on
 * `bms_tenant`, so the `user_isolation` policy confines it to the caller's own
 * rows; each also names `user_id` explicitly, so a policy regression does not
 * widen what one statement can touch.
 *
 * The life of a row: `pending` → (`claim`) `applying` → (`record`) `applied`
 * or `failed`. `release` puts a claimed row back to `pending` when the request
 * does not match it. Each transition is one compare-and-set on `status`, so two
 * concurrent requests can never both apply one change.
 */
@Injectable()
export class CopilotPendingChangesService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  /** The organization of a live pending change of this user, or `null`. Reads; changes nothing. */
  async peek(userId: string, id: string): Promise<PendingChangePeek | null> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{ organization_id: string }>(sql`
        SELECT organization_id FROM bms.copilot_pending_changes
         WHERE id = ${id} AND user_id = ${userId} AND status = 'pending' AND expires_at > now()`),
    );
    const row = rows[0];
    return row ? { organizationId: row.organization_id } : null;
  }

  /** `pending` → `applying` in one statement; `null` when the row is not this user's, not pending, or expired. */
  async claim(userId: string, id: string): Promise<ClaimedChange | null> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{ method: string; path: string; body_hash: string; organization_id: string; catalog_id: string }>(sql`
        UPDATE bms.copilot_pending_changes
           SET status = 'applying', claimed_at = now()
         WHERE id = ${id} AND user_id = ${userId} AND status = 'pending' AND expires_at > now()
        RETURNING method, path, body_hash, organization_id, catalog_id`),
    );
    const row = rows[0];
    return row
      ? {
          method: row.method,
          path: row.path,
          bodyHash: row.body_hash,
          organizationId: row.organization_id,
          catalogId: row.catalog_id,
        }
      : null;
  }

  /** `applying` → `pending`: the request did not match the change, so it stays confirmable. */
  async release(userId: string, id: string): Promise<void> {
    await withUser(this.tenantDb, userId, (tx) =>
      tx.execute(sql`
        UPDATE bms.copilot_pending_changes
           SET status = 'pending', claimed_at = NULL
         WHERE id = ${id} AND user_id = ${userId} AND status = 'applying'`),
    );
  }

  /** `applying` → `applied` or `failed`, with the status the client saw. A row in any other state is left alone. */
  async record(
    userId: string,
    id: string,
    outcome: PendingChangeOutcome,
    resultStatus: number,
    resourceId: string | null,
  ): Promise<void> {
    await withUser(this.tenantDb, userId, (tx) =>
      tx.execute(sql`
        UPDATE bms.copilot_pending_changes
           SET status = ${outcome}, finished_at = now(), result_status = ${resultStatus},
               resource_id = ${resourceId === null ? null : resourceId.slice(0, 128)}
         WHERE id = ${id} AND user_id = ${userId} AND status = 'applying'`),
    );
  }

  /**
   * Resolves this user's stuck claims (plan Q4): a row `applying` for more than
   * {@link STUCK_AFTER_MINUTES} minutes is `applied` when the audit log holds a
   * row the change wrote (`payload.changeId`, in its organization, at or after
   * the claim), else `failed`. Returns how many rows it resolved.
   *
   * The audit read runs in `withTenant` on the change's organization (the
   * audit log is a tenant table); the transition is a compare-and-set on
   * `applying`, so a request that records its own outcome first wins.
   */
  async sweepStuck(userId: string): Promise<number> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{ id: string; organization_id: string; claimed_at: string }>(sql`
        SELECT id, organization_id, claimed_at::text AS claimed_at FROM bms.copilot_pending_changes
         WHERE user_id = ${userId} AND status = 'applying'
           AND claimed_at < now() - make_interval(mins => ${STUCK_AFTER_MINUTES})`),
    );
    let resolved = 0;
    for (const row of rows) {
      const audited = await withTenant(this.tenantDb, row.organization_id, (tx) =>
        tx.execute<{ found: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM bms.audit_log
             WHERE organization_id = ${row.organization_id}
               AND created_at >= ${row.claimed_at}::timestamptz
               AND payload->>'changeId' = ${row.id}
          ) AS found`),
      );
      const outcome: PendingChangeOutcome = audited.rows[0]?.found === true ? "applied" : "failed";
      const updated = await withUser(this.tenantDb, userId, (tx) =>
        tx.execute(sql`
          UPDATE bms.copilot_pending_changes
             SET status = ${outcome}, finished_at = now()
           WHERE id = ${row.id} AND user_id = ${userId} AND status = 'applying'`),
      );
      resolved += updated.rowCount ?? 0;
    }
    return resolved;
  }
}
