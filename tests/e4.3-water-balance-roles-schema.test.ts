import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E4.3` (ADR 0073 decision 1) — `bms.water_balance_roles` and the nullable
 * `bms.assets.water_balance_role` column, migration `0080`.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants; `tests/f3.37-asset-role-
 * vocabulary.test.ts` is the model this file is copied from — same shape,
 * global vocabulary, one column on an existing table.
 *
 * **What is NOT tested here, and why: the vocabulary's contents.** The four
 * codes are seeded rows, so a list asserted here would be a copy of the
 * migration — the duplication `tests/adr-0034-alarm-skill-vocabulary.test.ts`
 * already rules against. The row count belongs to the §4.6 database check.
 */
const MIGRATION_REL = "packages/db/drizzle/0080_water_balance_roles.sql";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/**
 * Comments stripped. `f3.1a` learned this the hard way: `RESET ROLE;` in a
 * header *comment* kept a `toContain` green after the statement itself was
 * deleted. Every assertion about a statement reads this, never the raw text.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One table's `CREATE TABLE …( … );` body, so a per-table assertion cannot be
 * satisfied by a neighbour's column. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for bms.${table}`);
  return migration.slice(start, end + 3);
};

describe("E4.3 water balance role vocabulary (ADR 0073 decision 1)", () => {
  const migration = read(MIGRATION_REL);
  const sql = sqlOnly(migration);

  it("is a substantial migration, not a stub", () => {
    expect(migration.length).toBeGreaterThan(1500);
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE, and grants nothing explicitly", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "0080 lost its SET ROLE bms_owner. 0041's ALTER DEFAULT PRIVILEGES fires only " +
        "for objects that role creates; without the bracket bms_tenant/bms_fleet could " +
        "never read bms.water_balance_roles.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "0080 lost its RESET ROLE — a leaked SET ROLE reaches the drizzle journal write " +
        "and every later migration in the same run.",
    ).toBe(true);
    expect(
      /^\s*GRANT/im.test(sql),
      "0080 writes an explicit GRANT. The 0051 precedent: the default privileges from " +
        "0041 already do it, and a hand-written GRANT would hide a broken SET ROLE bracket.",
    ).toBe(false);
  });

  it("creates bms.water_balance_roles as a GLOBAL table — no organization_id, no RLS, no policy", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.water_balance_roles (");

    const block = tableBlock(sql, "water_balance_roles");
    expect(
      block.includes("organization_id"),
      "bms.water_balance_roles gained an organization_id. It must mean the same thing " +
        "in every organization, the reason bms.asset_roles (0051) is global too.",
    ).toBe(false);

    expect(/ENABLE ROW LEVEL SECURITY/i.test(sql)).toBe(false);
    expect(/CREATE POLICY[\s\S]{0,200}water_balance_roles/i.test(sql)).toBe(false);
  });

  it("closes bms.assets.water_balance_role with a foreign key, never a CHECK, and no DEFAULT", () => {
    expect(sql).toContain("REFERENCES bms.water_balance_roles(code)");
    expect(/CHECK\s*\(\s*water_balance_role\s+IN/i.test(sql)).toBe(false);

    const alterStart = sql.indexOf("ALTER TABLE bms.assets");
    expect(alterStart, "no ALTER TABLE bms.assets in 0080").toBeGreaterThanOrEqual(0);
    const alterStatement = sql.slice(alterStart, sql.indexOf(";", alterStart) + 1);
    expect(alterStatement).toContain("ADD COLUMN IF NOT EXISTS water_balance_role");
    expect(
      /DEFAULT/i.test(alterStatement),
      "0080's ALTER TABLE carries a DEFAULT on water_balance_role. NULL must mean " +
        "'not in the balance' — a default is a claim, the reason 0029 dropped " +
        "assets.domain's.",
    ).toBe(false);
  });

  it("seeds the four balance roles exactly once each, with a bare ON CONFLICT DO NOTHING", () => {
    const codes = ["intake", "discharge", "reuse", "internal"];
    for (const code of codes) {
      const re = new RegExp(`'${code}'`, "g");
      const matches = sql.match(re) ?? [];
      expect(matches.length, `expected exactly one INSERT row for '${code}'`).toBe(1);
    }
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    // Anti-vacuity: a named arbiter must NOT satisfy the same claim.
    expect(/ON CONFLICT\s*\([^)]*\)\s*DO NOTHING/i.test(sql)).toBe(false);
  });

  it("journals migration 0080 with idx 80 and a when after 0079's and not ahead of now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((e) => e.idx === 80);
    expect(entry, "no journal entry with idx 80").toBeDefined();
    expect(entry?.tag).toBe("0080_water_balance_roles");

    const prior = journal.entries.find((e) => e.idx === 79);
    expect(prior, "no journal entry with idx 79 to compare against").toBeDefined();
    expect(entry?.when as number).toBeGreaterThan(prior?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("mirrors the table and the FK in the drizzle schema", () => {
    const schema = read(SCHEMA_REL);
    expect(schema).toContain('bmsSchema.table("water_balance_roles"');
    expect(schema).toContain("references(() => waterBalanceRoles.code)");
  });

  /**
   * `E4.3` U3 — the `F4.43` guard in its source form, as `tests/f3.37-asset-role-vocabulary.test.ts`
   * holds it for the role picker. A `<select>` whose value matches no option renders its FIRST
   * option, so a hardcoded list falling behind `bms.water_balance_roles` does not look broken —
   * it looks like a different role. `assets-page.spec.tsx` asserts the rendered options come from
   * a stub; this asserts the source never grew a literal.
   */
  it("builds the asset form's water balance select from the vocabulary, not from literal options", () => {
    const page = read("apps/web/src/pages/admin/assets-page.tsx");

    // Anti-vacuity: the select exists and is fed by the vocabulary fetch, so deleting it cannot
    // turn the absence check below green.
    expect(page).toContain("Water balance role");
    expect(page).toContain("vocabQ.data?.waterBalanceRoles");

    // The only literal <option> values permitted anywhere on the page are empty ones ("Not in
    // the balance", "Select location", "No gateway"); every code arrives through a `{…}`.
    const literalOptions = [...page.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(
      literalOptions.filter((value) => value !== ""),
      "assets-page.tsx spells a code into an <option>. The balance roles live in " +
        "bms.water_balance_roles and arrive through GET /api/v1/vocabularies; a hardcoded list " +
        "that falls behind renders the FIRST option for an unknown value. That is F4.43.",
    ).toEqual([]);
  });
});
