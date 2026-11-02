import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0121_location_floor_area.sql";
const TAG = "0121_location_floor_area";
const PREVIOUS_TAG = "0120_widget_tab_key_trends";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
const CONSTRAINT = "locations_floor_area_m2_check";

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** Strip `//` line comments and block comments from TypeScript before a text scan. */
const tsOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

/**
 * `F4.304` — the static half of migration `0121` (ADR 0108 Amendment 5 item 1): one nullable
 * `bms.locations.floor_area_m2 numeric(12,2)` with a CHECK that refuses zero, negatives and NaN.
 */
describe("F4.304 — migration 0121: bms.locations.floor_area_m2", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("bms.locations");
  });

  it("adds the column as numeric(12,2), idempotently", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("ADD COLUMN IF NOT EXISTS floor_area_m2 numeric(12,2)");
  });

  it("drops the constraint before adding it, and the CHECK holds both the positive and the NaN leg", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(addAt, "the constraint must be added").toBeGreaterThan(-1);
    expect(dropAt, "the constraint must be dropped").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    const check = sql.slice(addAt);
    expect(check).toContain("floor_area_m2 > 0");
    expect(check).toContain("<> 'NaN'::numeric");
  });

  it("has no SET ROLE, no DEFAULT, no NOT NULL, and no IF NOT EXISTS on the ADD CONSTRAINT", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(/SET ROLE/i.test(sql)).toBe(false);
    expect(/\bDEFAULT\b/i.test(sql)).toBe(false);
    expect(/NOT NULL/i.test(sql)).toBe(false);
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("journals 0121 as idx 122 after 0120, not ahead of the clock, with increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find((row) => row.tag === PREVIOUS_TAG);
    expect(entry, "0121 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous?.idx).toBe(121);
    expect(entry?.idx).toBe(122);
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });

  it("mirrors the column in the drizzle locations table, inside the column object", () => {
    const source = tsOnly(read(SCHEMA_REL));
    const start = source.indexOf('bmsSchema.table("locations"');
    expect(start, "the locations table must be found").toBeGreaterThan(-1);
    const end = source.indexOf("}, (t) =>", start);
    expect(end, "the column object must end before the (t) => callback").toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('numeric("floor_area_m2", { precision: 12, scale: 2 })');
  });

  it("imports numeric from drizzle-orm/pg-core", () => {
    const source = tsOnly(read(SCHEMA_REL));
    const match = /import\s*\{([^}]*)\}\s*from\s*"drizzle-orm\/pg-core"/.exec(source);
    expect(match, "the pg-core import must be found").not.toBeNull();
    const names = (match?.[1] ?? "").split(",").map((name) => name.trim());
    expect(names).toContain("numeric");
  });
});
