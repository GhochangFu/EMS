import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0109_network_mimics_switching_units.sql";
const MIGRATION_FILE = "0109_network_mimics_switching_units.sql";
const TAG = "0109_network_mimics_switching_units";
const CONTRACT_REL = "packages/shared/src/contracts/point-key-states.ts";
const DRIZZLE_DIR = join(repoRoot, "packages/db/drizzle");

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a comment
 * that quotes the statement it explains (the `f3.1a-dashboard-schema.test.ts` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `(code, label, sort_order)` tuples of every `INSERT INTO bms.asset_roles` in a file.
 * The code class includes `_` (the F3.74 copy omits it) so `water_intake` is seen. */
const roleRows = (sql: string): Array<{ code: string; sort: number }> => {
  const rows: Array<{ code: string; sort: number }> = [];
  for (const stmt of sql.matchAll(/INSERT INTO bms\.asset_roles[^;]*;/g)) {
    for (const m of stmt[0].matchAll(/\(\s*'([a-z0-9_-]+)'\s*,\s*'[^']*'\s*,\s*(\d+)\s*\)/g)) {
      rows.push({ code: m[1] as string, sort: Number(m[2]) });
    }
  }
  return rows;
};

/**
 * `F3.80` — the static half of migration `0109` (plan Task 1.1): the
 * `is_switching` flag, eight position roles and the five-tone CHECK. The point
 * keys and state rows are seed-owned (OQ2 (b)). Assertions inline (§4.6).
 */
describe("F3.80 — migration 0109: is_switching, position roles, five-tone CHECK", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(800);
    expect(sqlOnly(migration)).toContain("ADD COLUMN IF NOT EXISTS is_switching");
  });

  it("registers 0109 at idx 110 after 0108, not ahead of the clock", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0109 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(110);
    expect(entry?.breakpoints).toBe(true);
    // 0108's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1791943646633);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("adds is_switching NOT NULL DEFAULT false", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toMatch(
      /ADD COLUMN IF NOT EXISTS is_switching boolean NOT NULL DEFAULT false/,
    );
  });

  it("adds the switching units CHECK by name in a DO block and leaves 0097's flags CHECK alone", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(
      /DO \$\$[\s\S]*?ADD CONSTRAINT mimic_layout_nodes_switching_units_check CHECK \(kind = 'unit' OR is_switching = false\)[\s\S]*?END \$\$;/,
    );
    expect(sql).not.toContain("mimic_layout_nodes_flags_units_check");
  });

  it("inserts the eight position roles with the ADR codes and these sort orders", () => {
    expect(roleRows(sqlOnly(read(MIGRATION_REL)))).toEqual([
      { code: "ht-incomer-breaker", sort: 161 },
      { code: "ht-outgoing-breaker", sort: 162 },
      { code: "bus-coupler", sort: 163 },
      { code: "isolator", sort: 164 },
      { code: "dg-breaker", sort: 165 },
      { code: "isolation-valve", sort: 265 },
      { code: "control-valve", sort: 266 },
      { code: "damper", sort: 570 },
    ]);
  });

  it("collides with no earlier sort_order or code", () => {
    const others = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql") && f !== MIGRATION_FILE)
      .flatMap((f) => roleRows(sqlOnly(readFileSync(join(DRIZZLE_DIR, f), "utf8"))));
    // Anti-vacuity: the scan sees a real corpus, and an underscore code.
    expect(others.length).toBeGreaterThan(50);
    expect(others).toContainEqual({ code: "water_intake", sort: 260 });

    const mine = roleRows(sqlOnly(read(MIGRATION_REL)));
    expect(mine).toHaveLength(8);
    for (const row of mine) {
      expect(others.filter((o) => o.sort === row.sort), `sort_order ${row.sort} is taken`).toEqual([]);
      expect(others.filter((o) => o.code === row.code), `code ${row.code} is taken`).toEqual([]);
    }
  });

  it("restates the tone CHECK as the five tones", () => {
    const check = /CHECK \(tone IN \(([^)]*)\)\)/.exec(sqlOnly(read(MIGRATION_REL)));
    expect(check, "0109 must carry the tone CHECK").not.toBeNull();
    const values = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(["closed", "open", "tripped", "flowing", "shut"]);
  });

  it("0109's tone CHECK equals pointKeyStateToneSchema's options", () => {
    const check = /CHECK \(tone IN \(([^)]*)\)\)/.exec(sqlOnly(read(MIGRATION_REL)));
    expect(check, "0109 must carry the tone CHECK").not.toBeNull();
    const sqlValues = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // The declaration stays on one line (the contract's docblock says so), or this regex misses it.
    const decl = /pointKeyStateToneSchema\s*=\s*z\.enum\(\[([^\]]*)\]/.exec(read(CONTRACT_REL));
    expect(decl, `${CONTRACT_REL} must declare pointKeyStateToneSchema = z.enum([...])`).not.toBeNull();
    const enumValues = [...(decl?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    // Anti-vacuity: an empty match on both sides would be equal.
    expect(enumValues.length).toBe(5);
    expect(sqlValues).toEqual(enumValues);
  });

  it("drops the old tone CHECK before adding it", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const drop = sql.indexOf("DROP CONSTRAINT IF EXISTS point_key_states_tone_check");
    const add = sql.indexOf("ADD CONSTRAINT point_key_states_tone_check");
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
  });

  it("creates, drops and alters no policy, and grants nothing, and does alter point_key_states", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/\b(CREATE|DROP|ALTER)\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).toMatch(/ALTER TABLE bms\.point_key_states/);
  });

  it("stays inside the bms_owner bracket", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const set = sql.indexOf("SET ROLE bms_owner;");
    const reset = sql.indexOf("RESET ROLE;");
    expect(set).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(set);
    for (const needle of [
      "ADD COLUMN IF NOT EXISTS is_switching",
      "INSERT INTO bms.asset_roles",
      "ADD CONSTRAINT point_key_states_tone_check",
    ]) {
      const at = sql.indexOf(needle);
      expect(at, needle).toBeGreaterThan(set);
      expect(at, needle).toBeLessThan(reset);
    }
    expect(sql).not.toContain("--> statement-breakpoint");
  });
});
