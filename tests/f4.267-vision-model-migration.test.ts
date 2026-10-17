import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.267` / ADR 0090 Amendment 3 C1 — migration `0111` adds
 * `bms.organization_llm_settings.vision_model`, a nullable `varchar(200)`: the
 * model a copilot turn that carries an image uses, on the same provider and key.
 * NULL means "no vision model; image turns go to the main model". A CHECK keeps
 * it NULL on an `off` row.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.87-copilot-attachments-schema`
 * model. Postgres enforces the CHECK in the RLS integration suite; this file pins
 * the text, so a dropped `IF NOT EXISTS`, a `NOT NULL`/`DEFAULT`, a lost CHECK or
 * a policy statement slipped into the file is red without a database.
 */
const MIGRATION_TAG = "0111_organization_llm_vision_model";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0110_copilot_attachments";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion about a deleted statement. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One statement, from `start` to its `;`. */
const statementFrom = (sql: string, start: string): string => {
  const at = sql.indexOf(start);
  if (at < 0) throw new Error(`no "${start}" in the migration`);
  const end = sql.indexOf(";", at);
  return end < 0 ? sql.slice(at) : sql.slice(at, end + 1);
};

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

const ADD_COLUMN = "ALTER TABLE bms.organization_llm_settings ADD COLUMN";
const CHECK_TEXT =
  "ALTER TABLE bms.organization_llm_settings ADD CONSTRAINT organization_llm_settings_vision_model_check CHECK (provider <> 'off' OR vision_model IS NULL);";

describe("F4.267 migration 0111 — organization_llm_settings.vision_model (ADR 0090 Amendment 3 C1)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("ALTER TABLE bms.organization_llm_settings");
  });

  it("registers 0111 in the journal one idx after 0110, when above 0110's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0110 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0110's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("adds the column as a nullable varchar(200) with no default, idempotently", () => {
    const alter = statementFrom(sql, ADD_COLUMN);
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS vision_model varchar\(200\);/);
    expect(alter).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it("keeps the vision model NULL on an off row, re-runnably", () => {
    expect(sql).toContain(
      "ALTER TABLE bms.organization_llm_settings DROP CONSTRAINT IF EXISTS organization_llm_settings_vision_model_check;",
    );
    expect(sql).toContain(CHECK_TEXT);
    expect(sql.indexOf("DROP CONSTRAINT IF EXISTS organization_llm_settings_vision_model_check")).toBeLessThan(
      sql.indexOf(CHECK_TEXT),
    );
  });

  it("documents the column in the catalog", () => {
    const comment = statementFrom(sql, "COMMENT ON COLUMN bms.organization_llm_settings.vision_model");
    expect(comment).toContain("Amendment 3 C1");
  });

  it("runs as the owner and changes no policy, privilege or row", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    const alterAt = sql.indexOf(ADD_COLUMN);
    const checkAt = sql.indexOf(CHECK_TEXT);
    expect(setRole).toBeLessThan(alterAt);
    expect(alterAt).toBeLessThan(reset);
    expect(checkAt).toBeLessThan(reset);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM)\b/);
    expect(migration).not.toContain("statement-breakpoint");
  });

  it("declares the column on the drizzle table right after model", () => {
    const schema = read(SCHEMA_REL);
    const start = schema.indexOf('export const organizationLlmSettings = bmsSchema.table("organization_llm_settings"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = schema.slice(start, schema.indexOf("\n});", start));
    expect(block).toMatch(
      /model: varchar\("model", \{ length: 200 \}\),\s*visionModel: varchar\("vision_model", \{ length: 200 \}\),/,
    );
  });
});

/**
 * `F4.267` review finding — `LLM_VISION_MODEL` reaches every api container that
 * reads it. The AWS demo stack is a separate compose file; without the line
 * there, the host `.env` value never reaches the api and image turns silently
 * go to the main model. Each `api` service block is sliced on its own, so a
 * line under another service cannot satisfy the assertion.
 */
const serviceBlock = (compose: string, service: string): string => {
  const header = `\n  ${service}:\n`;
  const start = compose.indexOf(header);
  if (start < 0) throw new Error(`no "${service}" service`);
  const next = compose.slice(start + header.length).search(/\n {2}[a-z][\w-]*:\n|\n[a-z]/);
  return next < 0 ? compose.slice(start) : compose.slice(start, start + header.length + next);
};

describe("F4.267 — LLM_VISION_MODEL reaches the api containers", () => {
  const LINE = "LLM_VISION_MODEL: ${LLM_VISION_MODEL:-}";

  it("the root compose passes it to api and api-replica", () => {
    const compose = read("docker-compose.yml");
    expect(serviceBlock(compose, "api")).toContain(LINE);
    expect(serviceBlock(compose, "api-replica")).toContain(LINE);
  });

  it("the AWS demo compose passes it to api", () => {
    expect(serviceBlock(read("deploy/aws/docker-compose.yml"), "api")).toContain(LINE);
  });

  it("the AWS .env template lists it beside the other LLM variables", () => {
    expect(read("deploy/aws/setup-server.sh")).toMatch(/\nANTHROPIC_MODEL=\nLLM_VISION_MODEL=\n/);
  });
});
