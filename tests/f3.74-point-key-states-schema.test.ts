import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0097_point_key_states_breaker_roles_asset_rating_and_layout_flags.sql";
const TAG = "0097_point_key_states_breaker_roles_asset_rating_and_layout_flags";
const CONTRACT_REL = "packages/shared/src/contracts/point-key-states.ts";
const DRIZZLE_DIR = join(repoRoot, "packages/db/drizzle");

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a comment
 * that quotes the statement it explains (the `f3.1a-dashboard-schema.test.ts` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `(code, label, sort_order)` tuples of every `INSERT INTO bms.asset_roles` in a file. */
const roleRows = (sql: string): Array<{ code: string; sort: number }> => {
  const rows: Array<{ code: string; sort: number }> = [];
  for (const stmt of sql.matchAll(/INSERT INTO bms\.asset_roles[^;]*;/g)) {
    for (const m of stmt[0].matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'[^']*'\s*,\s*(\d+)\s*\)/g)) {
      rows.push({ code: m[1] as string, sort: Number(m[2]) });
    }
  }
  return rows;
};

/**
 * `F3.74` — the static half of migration `0097` (plan Task 1.2): the state
 * table, the five breaker role codes, the two asset columns and the two layout
 * flags. `tests/f3.74-point-key-states-schema.integration.test.ts` asserts what
 * Postgres enforces. Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.74 — migration 0097: point key states, breaker roles, asset fields, layout flags", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(sqlOnly(migration)).toContain("CREATE TABLE IF NOT EXISTS bms.point_key_states");
  });

  it("registers migration 0097 in the journal, after 0096 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0097 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(97);
    expect(entry?.breakpoints).toBe(true);
    // 0096's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1790791804063);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("gives the state table no organization_id (global master data)", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const create = /CREATE TABLE IF NOT EXISTS bms\.point_key_states \(([\s\S]*?)\n\);/.exec(sql);
    expect(create, "0097 must create bms.point_key_states").not.toBeNull();
    expect(create?.[1]).not.toMatch(/organization_id/);
    expect(sql).not.toMatch(/point_key_states[^;]*ENABLE ROW LEVEL SECURITY/);
  });

  it("restates the tone CHECK equal to pointKeyStateToneSchema's options", () => {
    const check = /CHECK \(tone IN \(([^)]*)\)\)/.exec(sqlOnly(read(MIGRATION_REL)));
    expect(check, "0097 must carry the tone CHECK").not.toBeNull();
    const sqlValues = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // Anti-vacuity: the list is the three ruled tones whatever the contract says.
    expect(sqlValues).toEqual(["closed", "open", "tripped"]);

    // The contract file lands with Task 1.4; once it exists the two must agree.
    if (existsSync(join(repoRoot, CONTRACT_REL))) {
      const decl = /pointKeyStateToneSchema\s*=\s*z\.enum\(\[([^\]]*)\]/.exec(read(CONTRACT_REL));
      expect(decl, `${CONTRACT_REL} must declare pointKeyStateToneSchema = z.enum([...])`).not.toBeNull();
      const enumValues = [...(decl?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      expect(sqlValues).toEqual(enumValues);
    }
  });

  it("declares the UNIQUE on (point_key_code, value) and the FK to point_keys(code)", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(/UNIQUE \(point_key_code, value\)/);
    expect(sql).toMatch(/point_key_code varchar\(128\) NOT NULL REFERENCES bms\.point_keys\(code\) ON DELETE CASCADE/);
  });

  it("revokes all three write verbs from bms_tenant, inside the bms_owner bracket", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON bms\.point_key_states FROM bms_tenant;/);
    expect(sql).toMatch(/has_table_privilege\('bms_tenant', 'bms\.point_key_states', 'INSERT'\)/);
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("REVOKE INSERT")).toBeGreaterThan(sql.indexOf("SET ROLE bms_owner;"));
    expect(sql.indexOf("REVOKE INSERT")).toBeLessThan(sql.indexOf("RESET ROLE;"));
  });

  it("inserts the five breaker role codes at 151-155 with no sort-order collision", () => {
    const mine = roleRows(sqlOnly(read(MIGRATION_REL)));
    expect(mine).toEqual([
      { code: "main-breaker", sort: 151 },
      { code: "ups-input-breaker", sort: 152 },
      { code: "ups-output-breaker", sort: 153 },
      { code: "load-feeder-breaker", sort: 154 },
      { code: "mains-feeder-breaker", sort: 155 },
    ]);

    const others = ["0051", "0060", "0087", "0089", "0095"].map((n) => {
      const file = readdirSync(DRIZZLE_DIR).find((f) => f.startsWith(`${n}_`));
      expect(file, `migration ${n} must exist`).toBeDefined();
      return roleRows(sqlOnly(readFileSync(join(DRIZZLE_DIR, file as string), "utf8")));
    });
    // Anti-vacuity: the earlier files were actually parsed.
    expect(others.every((rows) => rows.length > 0)).toBe(true);
    const taken = new Set(others.flat().map((r) => r.sort));
    const takenCodes = new Set(others.flat().map((r) => r.code));
    for (const row of mine) {
      expect(taken.has(row.sort), `sort order ${row.sort} is already used`).toBe(false);
      expect(takenCodes.has(row.code), `code ${row.code} is already used`).toBe(false);
    }
  });

  it("adds rating and trip_cause as nullable columns on bms.assets", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS rating varchar(32)");
    expect(sql).toContain("ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS trip_cause varchar(128)");
    expect(sql).not.toMatch(/(rating|trip_cause) varchar\(\d+\) NOT NULL/);
  });

  it("adds fan_out and is_source as NOT NULL DEFAULT false", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(/ALTER TABLE bms\.mimic_layout_nodes\s+ADD COLUMN IF NOT EXISTS fan_out boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_source boolean NOT NULL DEFAULT false/);
  });

  it("adds the named units-only flags CHECK in a DO block", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("mimic_layout_nodes_flags_units_check");
    expect(sql).toMatch(/CHECK \(kind = 'unit' OR \(fan_out = false AND is_source = false\)\)/);
    const at = sql.indexOf("mimic_layout_nodes_flags_units_check");
    expect(sql.lastIndexOf("DO $$", at), "the CHECK sits in a DO block").toBeGreaterThan(-1);
  });

  it("creates, drops and alters no policy on mimic_layout_nodes, and grants nothing", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/);
    expect(sql).not.toMatch(/\bGRANT\b/);
  });
});
