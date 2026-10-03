import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** `@bms/shared` through `createRequire`, as `tests/adr-0034-alarm-skill-vocabulary.test.ts` does (it reads `packages/shared/dist`). */
const require_ = createRequire(import.meta.url);
const { aiAssistantProviderChoiceSchema } = require_("@bms/shared/contracts") as {
  aiAssistantProviderChoiceSchema: { options: readonly string[] };
};

/**
 * `F3.21` / ADR 0090 Amendment 1 A3 — migration `0100` creates
 * `bms.organization_llm_settings`: one row per organization naming the LLM
 * provider and model of its onboarding agent, and its API key encrypted with
 * `CredentialCryptoService` (four key columns, all NULL or all set).
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory; `tests/e4.1c-organization-currency-schema.test.ts` is
 * the model (`sqlOnly`, the journal ordering read from the file).
 *
 * **What is NOT tested here.** What Postgres enforces — the tenant boundary,
 * the three CHECKs, the cascade — is
 * `apps/api/src/admin/ai-assistant/organization-llm-settings.rls.integration.spec.ts`'s
 * job. This file pins the text, so a deleted `FORCE` or `WITH CHECK` is red
 * here without a database.
 */
const MIGRATION_TAG = "0100_organization_llm_settings";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
/** 0098's journal `when` — read by tag, since 0098 sits at idx 100. */
const PREVIOUS_TAG = "0098_user_administration";

/** The strict tenant predicate (the 0050 rule: no `IS NULL` disjunct). */
const TENANT_PREDICATE =
  "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

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

/** The drizzle table literal, from its declaration to the closing `});`. */
const drizzleBlock = (schema: string): string => {
  const start = schema.indexOf("export const organizationLlmSettings = bmsSchema.table(");
  if (start < 0) throw new Error(`no organizationLlmSettings table in ${SCHEMA_REL}`);
  const end = schema.indexOf("\n});", start);
  return end < 0 ? schema.slice(start) : schema.slice(start, end + 4);
};

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.21 migration 0100 — bms.organization_llm_settings (ADR 0090 Amendment 1 A3)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.organization_llm_settings (");
  });

  it("registers 0100 in the journal as idx 101, when above 0098's 1790972165981 and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(entry?.idx).toBe(101);
    expect(previous?.when, "0098's when is the baseline this test orders against").toBe(1790972165981);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0098's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("takes and returns the owner role", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const create = sql.indexOf("CREATE TABLE IF NOT EXISTS bms.organization_llm_settings");
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(reset, "RESET ROLE not found").toBeGreaterThanOrEqual(0);
    expect(setRole).toBeLessThan(create);
    expect(create).toBeLessThan(reset);
    // Ruling 7: follow 0094 — default privileges reach the pool roles.
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/CREATE EXTENSION/i);
  });

  it("declares the three named CHECK constraints", () => {
    const table = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.organization_llm_settings");
    expect(table).toMatch(
      /CONSTRAINT organization_llm_settings_provider_check CHECK \(provider IN \('off', ?'openai', ?'openrouter', ?'anthropic'\)\)/,
    );
    expect(table).toMatch(
      /CONSTRAINT organization_llm_settings_model_check CHECK \(provider = 'off' OR model IS NOT NULL\)/,
    );
    const keyCheck = table.slice(table.indexOf("CONSTRAINT organization_llm_settings_key_check"));
    expect(keyCheck).toContain("CONSTRAINT organization_llm_settings_key_check CHECK (");
    for (const column of ["key_iv", "key_version", "key_last4"]) {
      expect(keyCheck, `the key CHECK ties ${column} to key_ciphertext`).toContain(
        `(key_ciphertext IS NULL) = (${column} IS NULL)`,
      );
    }
  });

  it("enables and forces row level security with a strict tenant_isolation policy carrying both USING and WITH CHECK and no IS NULL disjunct", () => {
    expect(sql).toContain("ALTER TABLE bms.organization_llm_settings ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE bms.organization_llm_settings FORCE ROW LEVEL SECURITY;");
    const policy = statementFrom(sql, "CREATE POLICY tenant_isolation ON bms.organization_llm_settings");
    expect(policy).toContain(`USING (${TENANT_PREDICATE})`);
    expect(policy).toContain(`WITH CHECK (${TENANT_PREDICATE})`);
    // Bounded to the policy: the key CHECK legitimately says IS NULL eight times.
    expect(policy).not.toMatch(/IS NULL/i);
    expect(policy).not.toMatch(/\bTO\s+bms_/i);
  });

  it("the drizzle block declares the same nine columns", () => {
    const block = drizzleBlock(read(SCHEMA_REL));
    const columns = [...block.matchAll(/^\s+(\w+): (\w+)\("(\w+)"/gm)].map((m) => m[3]);
    expect(columns).toEqual([
      "organization_id",
      "provider",
      "model",
      "key_ciphertext",
      "key_iv",
      "key_version",
      "key_last4",
      "updated_by",
      "updated_at",
    ]);
    expect(block).toMatch(
      /organizationId: uuid\("organization_id"\)\s*\.primaryKey\(\)\s*\.references\(\(\) => organizations\.id, \{ onDelete: "cascade" \}\)/,
    );
    expect(block).toMatch(/provider: varchar\("provider", \{ length: 16 \}\)\.notNull\(\)/);
    expect(block).toMatch(/model: varchar\("model", \{ length: 200 \}\),/);
    expect(block).toContain('keyCiphertext: bytea("key_ciphertext"),');
    expect(block).toContain('keyIv: bytea("key_iv"),');
    expect(block).toContain('keyVersion: integer("key_version"),');
    expect(block).toContain('keyLast4: varchar("key_last4", { length: 4 }),');
    expect(block).toMatch(/updatedBy: uuid\("updated_by"\)\.references\(\(\) => users\.id\)/);
    expect(block).toMatch(
      /updatedAt: timestamp\("updated_at", \{ withTimezone: true \}\)\s*\.notNull\(\)\s*\.defaultNow\(\)/,
    );
  });

  // Migration review L1 (ADR 0047 decision 2's parity precedent): the CHECK and
  // the API's enum must list the same providers, or a PUT for a provider only
  // one of them knows answers 500 (23514) in every environment.
  it("lists exactly the shared enum's providers in the provider CHECK", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const match = /organization_llm_settings_provider_check CHECK \(provider IN \(([^)]*)\)\)/.exec(sql);
    expect(match, "the provider CHECK is present").not.toBeNull();
    const inList = (match?.[1] ?? "").split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
    expect([...inList].sort()).toEqual([...aiAssistantProviderChoiceSchema.options].sort());
  });
});
