import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0072_asset_images.sql";
const TABLE = "asset_images";

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
 * `F3.3` — the static half of `bms.asset_images`'s schema guarantees
 * (migration `0072`, ADR 0066 decision 5, Q-E).
 *
 * Static rather than behavioural, following `f3.1a-dashboard-schema.test.ts`'s
 * own rule (§4.4): the journal entry, the `SET ROLE`/`RESET ROLE` bracket and
 * the absence of `CREATE INDEX CONCURRENTLY` are none of them observable by a
 * query against an already-migrated database.
 *
 * Assertions inline, no `.spec` sibling — the top-level `tests/` carve-out
 * (§4.6).
 */
describe("F3.3 — bms.asset_images schema (migration 0072)", () => {
  it("registers migration 0072 in the journal", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === "0072_asset_images");

    expect(entry, "migration 0072 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(72);
    expect(entry?.tag).toBe("0072_asset_images");
    expect(entry?.when as number).toBeGreaterThan(1789217764145);
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

  it("cascades asset_id from bms.assets", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toMatch(/asset_id uuid NOT NULL REFERENCES bms\.assets\(id\) ON DELETE CASCADE/);
  });

  it("enables and forces row level security", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    // ENABLE alone exempts the table owner, and `bms_owner` IS the owner — so
    // without FORCE the policy is decorative for the one role that matters
    // (the `F4.16` defect ADR 0045 exists for).
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("the policy checks the own column and the parent asset's organization", () => {
    const migration = read(MIGRATION_REL);
    const policy = policyBlock(migration, TABLE);

    expect(policy).toContain(
      "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid",
    );
    expect(policy).toContain("EXISTS (SELECT 1 FROM bms.assets");
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
      "CONSTRAINT asset_images_object_key_key",
      "CONSTRAINT asset_images_byte_size_check",
      "CONSTRAINT asset_images_content_type_check",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }
  });

  it("creates the asset/created_at index", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS asset_images_asset_created_idx");
  });
});
