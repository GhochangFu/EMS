import "reflect-metadata";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BmsDb } from "@bms/db";

import { CopilotPurgeService, type CopilotPurgeSummary } from "./copilot-purge.service";

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — `CopilotPurgeService` against fake
 * pools. The sibling `.test.ts` is the Vitest entry point (ADR 0014).
 *
 * **The fake models `user_isolation`.** The fake tenant transaction records
 * the `set_config('app.current_user', …)` value, and every DELETE or UPDATE
 * acts only on rows whose `userId` equals it — the policy `0105` puts on
 * all three tables. So a purge that opened one transaction with no setting
 * deletes nothing here, as it would on the real database, and the
 * once-per-user row reddens. The fake also models the two foreign keys: a
 * deleted conversation cascades to its messages and sets `conversationId`
 * to null on its pending changes. Every statement is rendered through
 * `PgDialect` (the `report-dispatch.service.spec.ts` shape) and matched by
 * its head; the cut-off is the statement's bound parameter, so a service
 * that computes the wrong cut-off moves rows across the 30-day line.
 *
 * What the fake cannot see — the exact predicates against the real schema,
 * the real cascade and `SET NULL`, the owner bound by FORCE — is
 * `copilot-purge.integration.spec.ts`'s.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The tick's clock, injected through `purge(now)`. */
export const NOW = new Date("2026-10-10T12:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

export const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** A user the fleet list does not return — its rows must survive, whatever their age. */
export const USER_UNLISTED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type FakeConversation = { id: string; userId: string; lastTurnAt: Date };
type FakeMessage = { id: string; conversationId: string; userId: string };
type FakeChange = {
  id: string;
  userId: string;
  conversationId: string | null;
  status: string;
  proposedAt: Date;
  claimedAt: Date | null;
  finishedAt: Date | null;
};

export type PurgeHarness = {
  readonly service: CopilotPurgeService;
  readonly conversations: FakeConversation[];
  readonly messages: FakeMessage[];
  readonly changes: FakeChange[];
  /** The `app.current_user` value of every tenant transaction, in order (null: none was set). */
  readonly transactions: (string | null)[];
  /** Statements the tenant pool ran outside a transaction. */
  readonly tenantOutsideTx: string[];
  /** Statements the fleet pool ran. */
  readonly fleetStatements: string[];
};

const dialect = new PgDialect();

function head(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The fixture, one row per claim:
 *
 * - A's `conv-old` (31 days), with a message and an `applied` change;
 * - A's `conv-young` (29 days), with a message;
 * - A's `conv-old-pending` (31 days) with a `pending` change proposed 31 days
 *   ago — statement 1 sets it to null, statement 2 then deletes it;
 * - A's orphan changes: `pending` and `rejected` at 31 days (deleted),
 *   `pending` at 29 days and `failed` at 31 days (kept);
 * - A's `applying` claims at 31 days (failed) and 29 days (kept);
 * - B's `conv-b-old` (31 days, deleted in B's own transaction);
 * - the unlisted user's `conv-unlisted-old` (31 days, kept).
 */
export function makeHarness(listedUsers: readonly string[] = [USER_A, USER_B]): PurgeHarness {
  const conversations: FakeConversation[] = [
    { id: "conv-old", userId: USER_A, lastTurnAt: daysAgo(31) },
    { id: "conv-young", userId: USER_A, lastTurnAt: daysAgo(29) },
    { id: "conv-old-pending", userId: USER_A, lastTurnAt: daysAgo(31) },
    { id: "conv-b-old", userId: USER_B, lastTurnAt: daysAgo(31) },
    { id: "conv-unlisted-old", userId: USER_UNLISTED, lastTurnAt: daysAgo(31) },
  ];
  const messages: FakeMessage[] = [
    { id: "msg-old", conversationId: "conv-old", userId: USER_A },
    { id: "msg-young", conversationId: "conv-young", userId: USER_A },
  ];
  const change = (
    id: string,
    conversationId: string | null,
    status: string,
    proposedDaysAgo: number,
    claimedDaysAgo: number | null = null,
  ): FakeChange => ({
    id,
    userId: USER_A,
    conversationId,
    status,
    proposedAt: daysAgo(proposedDaysAgo),
    claimedAt: claimedDaysAgo === null ? null : daysAgo(claimedDaysAgo),
    finishedAt: null,
  });
  const changes: FakeChange[] = [
    change("chg-applied-in-old", "conv-old", "applied", 31),
    change("chg-pending-in-old", "conv-old-pending", "pending", 31),
    change("chg-orphan-pending-31", null, "pending", 31),
    change("chg-orphan-rejected-31", null, "rejected", 31),
    change("chg-orphan-pending-29", null, "pending", 29),
    change("chg-orphan-failed-31", null, "failed", 31),
    change("chg-applying-31", null, "applying", 31, 31),
    change("chg-applying-29", null, "applying", 29, 29),
  ];
  const transactions: (string | null)[] = [];
  const tenantOutsideTx: string[] = [];
  const fleetStatements: string[] = [];

  const run = (user: string | null, statement: SQL): { rows: unknown[]; rowCount: number } => {
    const rendered = dialect.sqlToQuery(statement);
    const text = head(rendered.sql);
    const cutoff = (): Date => new Date(String(rendered.params[0]));
    const mine = (row: { userId: string }) => user !== null && row.userId === user;
    if (text.startsWith("select set_config('app.current_user'")) {
      transactions[transactions.length - 1] = String(rendered.params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("delete from bms.copilot_conversations")) {
      const doomed = conversations.filter((c) => mine(c) && c.lastTurnAt < cutoff());
      for (const c of doomed) {
        conversations.splice(conversations.indexOf(c), 1);
        for (const m of messages.filter((m) => m.conversationId === c.id)) {
          messages.splice(messages.indexOf(m), 1);
        }
        for (const p of changes.filter((p) => p.conversationId === c.id)) {
          p.conversationId = null;
        }
      }
      return { rows: [], rowCount: doomed.length };
    }
    if (text.startsWith("delete from bms.copilot_pending_changes")) {
      const doomed = changes.filter(
        (p) =>
          mine(p) &&
          p.conversationId === null &&
          (p.status === "pending" || p.status === "rejected") &&
          p.proposedAt < cutoff(),
      );
      for (const p of doomed) changes.splice(changes.indexOf(p), 1);
      return { rows: [], rowCount: doomed.length };
    }
    if (text.startsWith("update bms.copilot_pending_changes")) {
      const stuck = changes.filter(
        (p) => mine(p) && p.status === "applying" && p.claimedAt !== null && p.claimedAt < cutoff(),
      );
      for (const p of stuck) {
        p.status = "failed";
        p.finishedAt = NOW;
      }
      return { rows: [], rowCount: stuck.length };
    }
    throw new Error(`fake tenant tx: unexpected statement ${rendered.sql}`);
  };

  const tenantDb = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions.push(null);
      const index = transactions.length - 1;
      const tx = { execute: async (statement: SQL) => run(transactions[index] ?? null, statement) };
      return fn(tx);
    },
    execute: async (statement: SQL) => {
      tenantOutsideTx.push(dialect.sqlToQuery(statement).sql);
      return run(null, statement);
    },
  } as unknown as BmsDb;

  const fleetDb = {
    execute: async (statement: SQL) => {
      const rendered = dialect.sqlToQuery(statement);
      fleetStatements.push(rendered.sql);
      if (!head(rendered.sql).startsWith("select id from bms.users")) {
        throw new Error(`fake fleet pool: unexpected statement ${rendered.sql}`);
      }
      return { rows: listedUsers.map((id) => ({ id })), rowCount: listedUsers.length };
    },
  } as unknown as BmsDb;

  return {
    service: new CopilotPurgeService(tenantDb, fleetDb),
    conversations,
    messages,
    changes,
    transactions,
    tenantOutsideTx,
    fleetStatements,
  };
}

export async function runPurge(h: PurgeHarness): Promise<CopilotPurgeSummary> {
  return h.service.purge(NOW);
}

const ids = (rows: readonly { id: string }[]): string => rows.map((r) => r.id).sort().join(", ");
const changeOf = (h: PurgeHarness, id: string): FakeChange | undefined => h.changes.find((p) => p.id === id);

export function assertTheOldConversationIsDeleted(h: PurgeHarness): void {
  assert(
    !h.conversations.some((c) => c.id === "conv-old"),
    `expected the 31-day conversation deleted; conversations left: ${ids(h.conversations)}`,
  );
}

export function assertTheOldConversationsMessagesCascaded(h: PurgeHarness): void {
  assert(
    !h.messages.some((m) => m.id === "msg-old"),
    `expected the 31-day conversation's message gone with it; messages left: ${ids(h.messages)}`,
  );
}

export function assertTheAppliedChangeSurvivesWithANullConversation(h: PurgeHarness): void {
  const applied = changeOf(h, "chg-applied-in-old");
  assert(
    applied !== undefined && applied.conversationId === null && applied.status === "applied",
    `expected the applied change kept with conversationId null; got ${JSON.stringify(applied)}`,
  );
}

export function assertTheYoungConversationSurvives(h: PurgeHarness): void {
  assert(
    h.conversations.some((c) => c.id === "conv-young") && h.messages.some((m) => m.id === "msg-young"),
    `expected the 29-day conversation and its message kept; conversations=${ids(h.conversations)} messages=${ids(h.messages)}`,
  );
}

export function assertOldOrphanPendingAndRejectedChangesAreDeleted(h: PurgeHarness): void {
  const left = ["chg-orphan-pending-31", "chg-orphan-rejected-31"].filter((id) => changeOf(h, id));
  assert(left.length === 0, `expected the 31-day orphan pending and rejected changes deleted; left: ${left.join(", ")}`);
}

export function assertAPendingChangeOrphanedThisTickIsDeletedThisTick(h: PurgeHarness): void {
  assert(
    changeOf(h, "chg-pending-in-old") === undefined,
    "expected the 31-day pending change whose conversation the tick deleted to go in the same tick — statement 2 must run after statement 1",
  );
}

export function assertYoungOrFinishedOrphansSurvive(h: PurgeHarness): void {
  const missing = ["chg-orphan-pending-29", "chg-orphan-failed-31"].filter((id) => !changeOf(h, id));
  assert(
    missing.length === 0,
    `expected the 29-day orphan pending change and the 31-day failed one kept; missing: ${missing.join(", ")}`,
  );
}

export function assertAnOldApplyingClaimBecomesFailed(h: PurgeHarness): void {
  const row = changeOf(h, "chg-applying-31");
  assert(
    row !== undefined && row.status === "failed" && row.finishedAt !== null,
    `expected the applying row claimed 31 days ago to be failed with finishedAt set; got ${JSON.stringify(row)}`,
  );
}

export function assertAYoungApplyingClaimIsUntouched(h: PurgeHarness): void {
  const row = changeOf(h, "chg-applying-29");
  assert(
    row !== undefined && row.status === "applying" && row.finishedAt === null,
    `expected the applying row claimed 29 days ago untouched (sweepStuck owns it); got ${JSON.stringify(row)}`,
  );
}

export function assertOneTransactionPerListedUserInOrder(h: PurgeHarness): void {
  assert(
    JSON.stringify(h.transactions) === JSON.stringify([USER_A, USER_B]),
    `expected one tenant transaction per listed user, each naming its user — got ${JSON.stringify(h.transactions)}`,
  );
}

export function assertTheSecondListedUsersRowsArePurgedInTheirOwnTransaction(h: PurgeHarness): void {
  assert(
    !h.conversations.some((c) => c.id === "conv-b-old"),
    `expected B's 31-day conversation deleted under B's own setting; conversations left: ${ids(h.conversations)}`,
  );
}

export function assertAnUnlistedUsersRowsSurvive(h: PurgeHarness): void {
  assert(
    h.conversations.some((c) => c.id === "conv-unlisted-old"),
    "expected the unlisted user's 31-day conversation kept — the purge reached a user the fleet list did not name",
  );
}

export function assertTheUserListIsReadOnTheFleetPoolOnly(h: PurgeHarness): void {
  assert(
    h.fleetStatements.length === 1 && h.tenantOutsideTx.length === 0,
    `expected one fleet read and no tenant statement outside withUser; fleet=${JSON.stringify(h.fleetStatements)} tenantOutsideTx=${JSON.stringify(h.tenantOutsideTx)}`,
  );
}

export function assertTheSummaryCountsWhatWasPurged(summary: CopilotPurgeSummary): void {
  // A: conv-old, conv-old-pending; B: conv-b-old. Changes: chg-pending-in-old,
  // the two 31-day orphans. Claims: chg-applying-31.
  const counts = {
    users: summary.users,
    conversationsDeleted: summary.conversationsDeleted,
    pendingChangesDeleted: summary.pendingChangesDeleted,
    claimsFailed: summary.claimsFailed,
  };
  assert(
    JSON.stringify(counts) ===
      JSON.stringify({ users: 2, conversationsDeleted: 3, pendingChangesDeleted: 3, claimsFailed: 1 }),
    `expected the summary to count 2 users, 3 conversations, 3 pending changes, 1 failed claim; got ${JSON.stringify(counts)}`,
  );
}

export function assertNoListedUserMeansNoTransaction(h: PurgeHarness, summary: CopilotPurgeSummary): void {
  assert(
    h.transactions.length === 0 && summary.users === 0 && summary.conversationsDeleted === 0,
    `expected an empty user list to open no transaction and purge nothing; transactions=${h.transactions.length} summary=${JSON.stringify(summary)}`,
  );
}
