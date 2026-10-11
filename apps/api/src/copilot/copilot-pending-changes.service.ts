import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { type BmsDb, copilotPendingChanges } from "@bms/db";
import type { CopilotPendingChangeDto } from "@bms/shared";

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

/** A change the propose tool stores (`F3.85` PR 8); `body` is the body the browser will send. */
export type NewPendingChange = {
  conversationId: string;
  organizationId: string;
  catalogId: string;
  method: CopilotPendingChangeDto["method"];
  path: string;
  body: Record<string, unknown>;
  bodyHash: string;
  summary: string;
  risk: CopilotPendingChangeDto["risk"];
};

/** What the follow-up turn reads of a finished change (decision 4.7). */
export type FinishedChange = {
  conversationId: string | null;
  organizationId: string;
  catalogId: string;
  status: string;
  resultStatus: number | null;
  resourceId: string | null;
  summary: string;
};

/** Drafter choice 1: a proposal can be confirmed for this long. */
export const PENDING_CHANGE_TTL_MINUTES = 15;

type PendingRow = typeof copilotPendingChanges.$inferSelect;

export function toPendingChangeDto(row: PendingRow): CopilotPendingChangeDto {
  return {
    id: row.id,
    catalogId: row.catalogId,
    method: row.method as CopilotPendingChangeDto["method"],
    path: row.path,
    body: row.body as Record<string, unknown>,
    summary: row.summary,
    risk: row.risk as CopilotPendingChangeDto["risk"],
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

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
   * `F3.85` PR 8 — stores one proposal as `pending`, confirmable for
   * {@link PENDING_CHANGE_TTL_MINUTES} minutes, **unless the conversation
   * already has a change in flight**: then it stores nothing and answers
   * `null`. The check and the insert run in one transaction under a
   * transaction-scoped advisory lock on the conversation, so two turns that
   * propose at once (a follow-up and a user turn, or two tabs) store one row,
   * not two (review L5).
   */
  async propose(userId: string, change: NewPendingChange): Promise<CopilotPendingChangeDto | null> {
    const [row] = await withUser(this.tenantDb, userId, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${change.conversationId}, 3085))`);
      const { rows } = await tx.execute<{ open: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM bms.copilot_pending_changes
           WHERE user_id = ${userId} AND conversation_id = ${change.conversationId}
             AND (status = 'applying' OR (status = 'pending' AND expires_at > now()))
        ) AS open`);
      if (rows[0]?.open === true) return [];
      return tx
        .insert(copilotPendingChanges)
        .values({
          userId,
          conversationId: change.conversationId,
          organizationId: change.organizationId,
          catalogId: change.catalogId,
          method: change.method,
          path: change.path,
          body: change.body,
          bodyHash: change.bodyHash,
          summary: change.summary,
          risk: change.risk,
          status: "pending",
          expiresAt: sql`now() + make_interval(mins => ${PENDING_CHANGE_TTL_MINUTES})`,
        })
        .returning();
    });
    return row ? toPendingChangeDto(row) : null;
  }

  /**
   * Whether the conversation has a change in flight: `pending` and unexpired,
   * or `applying`. The propose tool refuses while it has (plan §10.2): one
   * card at a time, and never a second change beside one being applied.
   */
  async hasOpen(userId: string, conversationId: string): Promise<boolean> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{ open: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM bms.copilot_pending_changes
           WHERE user_id = ${userId} AND conversation_id = ${conversationId}
             AND (status = 'applying' OR (status = 'pending' AND expires_at > now()))
        ) AS open`),
    );
    return rows[0]?.open === true;
  }

  /** The conversation's changes still waiting for a Confirm, oldest first. */
  async listOpen(userId: string, conversationId: string): Promise<CopilotPendingChangeDto[]> {
    const rows = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .select()
        .from(copilotPendingChanges)
        .where(
          and(
            eq(copilotPendingChanges.userId, userId),
            eq(copilotPendingChanges.conversationId, conversationId),
            eq(copilotPendingChanges.status, "pending"),
            gt(copilotPendingChanges.expiresAt, sql`now()`),
          ),
        )
        .orderBy(asc(copilotPendingChanges.proposedAt)),
    );
    return rows.map(toPendingChangeDto);
  }

  /**
   * `pending` → `rejected` (decision 4): the Reject button. An expired row can
   * be rejected too, so a stale card can be cleared. `null` when the row is
   * not this user's or is not `pending`.
   */
  async reject(
    userId: string,
    id: string,
  ): Promise<{ conversationId: string | null; organizationId: string; summary: string } | null> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{ conversation_id: string | null; organization_id: string; summary: string }>(sql`
        UPDATE bms.copilot_pending_changes
           SET status = 'rejected', finished_at = now()
         WHERE id = ${id} AND user_id = ${userId} AND status = 'pending'
        RETURNING conversation_id, organization_id, summary`),
    );
    const row = rows[0];
    return row ? { conversationId: row.conversation_id, organizationId: row.organization_id, summary: row.summary } : null;
  }

  /**
   * `pending` → `rejected` for changes a turn proposed and then could not
   * report (a cap or a provider error stopped it, so the card never reached
   * the user). Without this the hidden row would block the conversation's
   * next proposal until it expired.
   */
  async discard(userId: string, ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.reject(userId, id);
    }
  }

  /** A finished change, for the follow-up turn; `null` when it is not this user's or is still pending or applying. */
  async finished(userId: string, id: string): Promise<FinishedChange | null> {
    const { rows } = await withUser(this.tenantDb, userId, (tx) =>
      tx.execute<{
        conversation_id: string | null;
        organization_id: string;
        catalog_id: string;
        status: string;
        result_status: number | null;
        resource_id: string | null;
        summary: string;
      }>(sql`
        SELECT conversation_id, organization_id, catalog_id, status, result_status, resource_id, summary
          FROM bms.copilot_pending_changes
         WHERE id = ${id} AND user_id = ${userId} AND status IN ('applied', 'failed')`),
    );
    const row = rows[0];
    return row
      ? {
          conversationId: row.conversation_id,
          organizationId: row.organization_id,
          catalogId: row.catalog_id,
          status: row.status,
          resultStatus: row.result_status,
          resourceId: row.resource_id,
          summary: row.summary,
        }
      : null;
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
