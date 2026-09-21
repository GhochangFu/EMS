import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0077_report_files.sql";
const TABLE = "report_files";

/** Strip `--` comment lines before a NEGATIVE (or role-bracket) scan — the
 * `f3.1a-dashboard-schema.test.ts` lesson: a raw scan is satisfied by a
 * comment quoting the statement it explains, so `RESET ROLE;` inside the
 * header prose would otherwise keep a deleted statement green. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of the table's `CREATE POLICY tenant_isolation` statement,
 * terminator included — scoped so a per-table assertion cannot be satisfied
 * by prose elsewhere in the file. */
const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  return migration.slice(start, end + 1);
};

/**
 * `F3.5a` — the static half of `bms.report_files`'s schema guarantees
 * (migration `0077`, ADR 0071 decision 4).
 *
 * Static rather than behavioural, following `f3.3-asset-images-schema.test.ts`'s
 * own rule (§4.4): the journal entry, the `SET ROLE`/`RESET ROLE` bracket and
 * the absence of `CREATE INDEX CONCURRENTLY` are none of them observable by a
 * query against an already-migrated database.
 *
 * Assertions inline, no `.spec` sibling — the top-level `tests/` carve-out
 * (§4.6).
 */
describe("F3.5a — bms.report_files schema (migration 0077)", () => {
  it("registers migration 0077 in the journal", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === "0077_report_files");

    expect(entry, "migration 0077 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(77);
    expect(entry?.tag).toBe("0077_report_files");
    // 0076's `when` — the F4.94 class: a stamp ahead of the wall clock sorts
    // after a later real-clock stamp and is silently skipped wherever the
    // later one applies.
    expect(entry?.when as number).toBeGreaterThan(1789818098638);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("is not scanning an empty or misnamed file", () => {
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = read(MIGRATION_REL);
    expect(sqlOnly(migration)).toContain("SET ROLE bms_owner;");
    expect(sqlOnly(migration)).toContain("RESET ROLE;");
  });

  it("never uses CREATE INDEX CONCURRENTLY", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });

  it("gives organization_id NOT NULL", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id)");
  });

  it("enables and forces row level security", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    // ENABLE alone exempts the table owner, and `bms_owner` IS the owner — so
    // without FORCE the policy is decorative for the one role that matters
    // (the `F4.16` defect ADR 0045 exists for).
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("the policy checks the own organization_id column, in USING and in WITH CHECK", () => {
    const migration = read(MIGRATION_REL);
    const policy = policyBlock(migration, TABLE);
    // One `toContain` over the whole block is satisfied by one occurrence, so
    // a policy that dropped its WITH CHECK half would still pass. Split the
    // block and hold each half to its own leg (the F3.3 migration review).
    const split = policy.indexOf("WITH CHECK");
    expect(split, "the policy must carry a WITH CHECK clause").toBeGreaterThan(0);
    const using = policy.slice(0, split);
    const withCheck = policy.slice(split);

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must check the own organization_id`).toContain(
        "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid",
      );
    }
  });

  it("admits no NULL-org disjunct in the policy", () => {
    const migration = read(MIGRATION_REL);
    const policy = policyBlock(migration, TABLE);
    expect(policy).not.toMatch(/IS NULL/i);
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("names every constraint the schema file and psql must agree on", () => {
    const migration = read(MIGRATION_REL);
    for (const name of [
      "CONSTRAINT report_files_object_key_key",
      "CONSTRAINT report_files_format_check",
      "CONSTRAINT report_files_delivery_status_check",
      "CONSTRAINT report_files_byte_size_check",
      "CONSTRAINT report_files_period_check",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }
  });

  it("creates the organization/created_at index", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS report_files_org_created_idx");
  });

  it("carries location_ids but not schedule_id — the F3.5b seam is not built early", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toMatch(/location_ids uuid\[\] NOT NULL DEFAULT '\{\}'/);
    expect(migration).not.toMatch(/schedule_id/i);
  });
});
