import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.85` PR 4 / ADR 0099 decisions 4 and 8 — migration `0105` creates the
 * copilot's per-user tables: the conversations (`bms.copilot_conversations`),
 * their messages (`bms.copilot_messages`) and the pending changes behind the
 * `X-Copilot-Change` header (`bms.copilot_pending_changes`).
 *
 * Decision 8: each row is its user's alone. The policy binds `user_id` to the
 * `app.current_user` setting that `withUser` sets, there is **no**
 * `tenant_isolation` policy, and `bms_fleet` — which reads across
 * organizations — loses every privilege on the three tables.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.21` model. What
 * Postgres enforces (the user boundary, the fleet revoke, the atomic claim) is
 * `apps/api/src/database/user-context.integration.spec.ts` and
 * `apps/api/src/copilot/copilot-pending-changes.integration.spec.ts`; this
 * file pins the text, so a deleted `REVOKE` or `NOT NULL` is red here without
 * a database.
 */
const MIGRATION_TAG = "0105_copilot_history";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0104_copilot_access";

const TABLES = ["copilot_conversations", "copilot_messages", "copilot_pending_changes"] as const;

/** The per-user predicate (decision 8). `current_user` is reserved, so the setting is only ever read through `current_setting`. */
const USER_PREDICATE = "user_id = nullif(current_setting('app.current_user', true), '')::uuid";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion
 * about a statement that was actually deleted (`f3.1a`'s lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One statement, from `start` to its `;`, so a clause in a neighbour cannot decide a claim. */
const statementFrom = (sql: string, start: string): string => {
  const at = sql.indexOf(start);
  if (at < 0) throw new Error(`no "${start}" in the migration`);
  const end = sql.indexOf(";", at);
  return end < 0 ? sql.slice(at) : sql.slice(at, end + 1);
};

/** One drizzle table literal, from its declaration to the table's closing `);`. */
const drizzleBlock = (schema: string, name: string): string => {
  const start = schema.indexOf(`export const ${name} = bmsSchema.table(`);
  if (start < 0) throw new Error(`no ${name} table in ${SCHEMA_REL}`);
  const end = schema.indexOf("\n);", start);
  const close = schema.indexOf("\n});", start);
  const stop = [end, close].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return stop === undefined ? schema.slice(start) : schema.slice(start, stop + 4);
};

const columnsOf = (block: string): string[] =>
  [...block.matchAll(/^\s+\w+: (\w+)\("(\w+)"/gm)].map((m) => m[2]);

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.85 migration 0105 — the copilot history and pending-change tables (ADR 0099 decisions 4, 8)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
    }
  });

  it("registers 0105 in the journal one idx after 0104, when above 0104's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0104 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0104's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("takes and returns the owner role, and writes no GRANT", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(reset, "RESET ROLE not found").toBeGreaterThanOrEqual(0);
    for (const table of TABLES) {
      const create = sql.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table}`);
      expect(setRole).toBeLessThan(create);
      expect(create).toBeLessThan(reset);
    }
    // 0041's default privileges reach bms_tenant; nothing is granted by hand.
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
  });

  it("revokes every privilege on the three tables from bms_fleet, inside the owner block (decision 8)", () => {
    const revoke = statementFrom(sql, "REVOKE ALL ON");
    expect(revoke).toMatch(/FROM\s+bms_fleet\s*;$/);
    for (const table of TABLES) {
      expect(revoke).toContain(`bms.${table}`);
    }
    const at = sql.indexOf("REVOKE ALL ON");
    expect(sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/)).toBeLessThan(at);
    expect(at).toBeLessThan(sql.search(/\bRESET\s+ROLE\s*;/));
    // Positive control: no other REVOKE that could be the one the regex found.
    expect(sql.match(/\bREVOKE\b/gi)).toHaveLength(1);
  });

  it("ties every row to a user that cascades it away", () => {
    for (const table of TABLES) {
      const create = statementFrom(sql, `CREATE TABLE IF NOT EXISTS bms.${table}`);
      expect(create).toMatch(/user_id uuid NOT NULL REFERENCES bms\.users\(id\) ON DELETE CASCADE/);
    }
  });

  it("lets a conversation have no organization (the global admin's cross-organization view, decision 10)", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_conversations");
    expect(create).toMatch(/organization_id uuid REFERENCES bms\.organizations\(id\) ON DELETE CASCADE,/);
    expect(create).not.toMatch(/organization_id uuid NOT NULL/);
    expect(create).toMatch(/title varchar\(200\)/);
    expect(create).toMatch(/last_turn_at timestamptz NOT NULL DEFAULT now\(\)/);
  });

  it("indexes conversations by user and last turn, the predicate the list and the purge filter on", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS copilot_conversations_user_last_turn_idx\s+ON bms\.copilot_conversations \(user_id, last_turn_at\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS copilot_messages_conversation_created_idx\s+ON bms\.copilot_messages \(conversation_id, created_at\)/,
    );
  });

  it("limits a message's role by a named CHECK and records the organizations its tools read", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_messages");
    expect(create).toMatch(/conversation_id uuid NOT NULL,/);
    expect(create).toMatch(/organization_ids uuid\[\] NOT NULL DEFAULT '\{\}'/);
    expect(create).toMatch(
      /CONSTRAINT copilot_messages_role_check CHECK \(role IN \('user', ?'assistant', ?'action'\)\)/,
    );
  });

  it("gives every pending change an organization, so the interceptor's availability check cannot be skipped", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_pending_changes");
    expect(create).toMatch(
      /organization_id uuid NOT NULL REFERENCES bms\.organizations\(id\) ON DELETE CASCADE/,
    );
    expect(create).toMatch(/conversation_id uuid,/);
    expect(create).toMatch(/body jsonb NOT NULL/);
    expect(create).toMatch(/body_hash char\(64\) NOT NULL/);
    expect(create).toMatch(/expires_at timestamptz NOT NULL/);
  });

  it("lets a child row join only a conversation of its own user (composite keys)", () => {
    const conversations = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_conversations");
    expect(conversations).toMatch(/CONSTRAINT copilot_conversations_id_user_key UNIQUE \(id, user_id\)/);

    const messages = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_messages");
    expect(messages).toMatch(
      /CONSTRAINT copilot_messages_conversation_user_fkey FOREIGN KEY \(conversation_id, user_id\)\s+REFERENCES bms\.copilot_conversations \(id, user_id\) ON DELETE CASCADE,/,
    );

    // Drafter choice 8 keeps applied and failed rows after the 30-day erase of their
    // conversation: only conversation_id is nulled, never the NOT NULL user_id.
    const pending = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_pending_changes");
    expect(pending).toMatch(
      /CONSTRAINT copilot_pending_changes_conversation_user_fkey FOREIGN KEY \(conversation_id, user_id\)\s+REFERENCES bms\.copilot_conversations \(id, user_id\) ON DELETE SET NULL \(conversation_id\),/,
    );

    // No single-column key to a conversation survives beside the composite ones.
    expect(sql).not.toMatch(/REFERENCES bms\.copilot_conversations\(id\)/);
  });

  it("limits a pending change's risk and status by named CHECKs", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_pending_changes");
    expect(create).toMatch(
      /CONSTRAINT copilot_pending_changes_risk_check CHECK \(risk IN \('create', ?'edit', ?'deactivate', ?'access'\)\)/,
    );
    expect(create).toMatch(
      /CONSTRAINT copilot_pending_changes_status_check CHECK \(status IN \('pending', ?'applying', ?'applied', ?'failed', ?'rejected'\)\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS copilot_pending_changes_user_status_idx\s+ON bms\.copilot_pending_changes \(user_id, status\)/,
    );
  });

  it.each(TABLES)(
    "enables and forces row level security on %s with a strict user_isolation policy and no tenant policy",
    (table) => {
      expect(sql).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`DROP POLICY IF EXISTS user_isolation ON bms.${table};`);
      const policy = statementFrom(sql, `CREATE POLICY user_isolation ON bms.${table}`);
      expect(policy).toContain(`USING (${USER_PREDICATE})`);
      expect(policy).toContain(`WITH CHECK (${USER_PREDICATE})`);
      expect(policy).not.toMatch(/IS NULL/i);
      expect(policy).not.toMatch(/\bTO\s+bms_/i);
      expect(sql).not.toContain(`tenant_isolation ON bms.${table}`);
      // `SET LOCAL app.current_user` does not parse: the setting is only read, never SET here.
      expect(sql).not.toMatch(/\bSET\s+(LOCAL\s+)?app\.current_user/i);
      expect(sql).toContain(`COMMENT ON TABLE bms.${table} IS`);
    },
  );

  it("mirrors the three tables in drizzle with the same columns", () => {
    const schema = read(SCHEMA_REL);
    expect(columnsOf(drizzleBlock(schema, "copilotConversations"))).toEqual([
      "id",
      "user_id",
      "organization_id",
      "title",
      "created_at",
      "last_turn_at",
    ]);
    expect(columnsOf(drizzleBlock(schema, "copilotMessages"))).toEqual([
      "id",
      "conversation_id",
      "user_id",
      "role",
      "content",
      "organization_ids",
      "created_at",
    ]);
    expect(columnsOf(drizzleBlock(schema, "copilotPendingChanges"))).toEqual([
      "id",
      "user_id",
      "conversation_id",
      "organization_id",
      "catalog_id",
      "method",
      "path",
      "body",
      "body_hash",
      "summary",
      "risk",
      "status",
      "proposed_at",
      "expires_at",
      "claimed_at",
      "finished_at",
      "result_status",
      "resource_id",
    ]);
  });
});
