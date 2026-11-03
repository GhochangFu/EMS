import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0122_report_schedule_params.sql";
const TAG = "0122_report_schedule_params";
const PREVIOUS_TAG = "0121_location_floor_area";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/report-schedules-schema.ts";
const CONSTRAINT = "report_schedules_params_object_check";

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * `F4.303` — the static half of migration `0122` (ADR 0108 Amendment 6 item 7): one nullable
 * `params jsonb` column on `bms.report_schedules`, with an object-or-NULL CHECK.
 */
describe("F4.303 — migration 0122: bms.report_schedules.params", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("bms.report_schedules");
  });

  it("adds the column idempotently as jsonb", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("ADD COLUMN IF NOT EXISTS params jsonb");
  });

  it("drops the constraint before adding it, with no IF NOT EXISTS guard on the ADD", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(dropAt, "the DROP must exist").toBeGreaterThan(-1);
    expect(addAt, "the ADD must exist").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("states the CHECK as exactly: NULL or a jsonb object", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("CHECK (params IS NULL OR jsonb_typeof(params) = 'object')");
  });

  it("brackets the ALTERs with SET ROLE bms_owner and RESET ROLE", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const setAt = sql.indexOf("SET ROLE bms_owner;");
    const firstAlter = sql.indexOf("ALTER");
    const lastAlter = sql.lastIndexOf("ALTER");
    const resetAt = sql.indexOf("RESET ROLE;");
    expect(setAt, "SET ROLE bms_owner; must exist").toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(firstAlter);
    expect(resetAt, "RESET ROLE; must exist").toBeGreaterThan(lastAlter);
  });

  it("adds no DEFAULT, NOT NULL, template_id CHECK, GRANT or POLICY", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/\bDEFAULT\b/);
    expect(sql).not.toMatch(/\bNOT NULL\b/);
    expect(sql).not.toMatch(/template_id/);
    expect(sql).not.toMatch(/\bGRANT\b/);
    expect(sql).not.toMatch(/\bPOLICY\b/);
  });

  it("journals 0122 as idx 123 after 0121 at idx 122, not ahead of the clock, with increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find((row) => row.tag === PREVIOUS_TAG);
    expect(entry, "0122 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous?.idx).toBe(122);
    expect(entry?.idx).toBe(123);
    expect(entry?.when).toBe(1793640000000);
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });

  it("mirrors the column in the drizzle schema, with jsonb imported from pg-core", () => {
    const source = read(SCHEMA_REL);
    expect(source).toContain('params: jsonb("params")');
    const importLine = source.split("\n").find((line) => line.includes('from "drizzle-orm/pg-core"')) ?? "";
    expect(importLine).toMatch(/\bjsonb\b/);
  });
});
