import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0118_trend_strip_widget_type.sql";
const TAG = "0118_trend_strip_widget_type";
const PREVIOUS_TAG = "0117_trend_points";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const SCHEMA_REL = "packages/db/src/schema/dashboard-schema.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONSTRAINT = "dashboard_widgets_widget_type_check";

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const checkList = (sql: string): string[] => {
  const match = new RegExp(`ADD CONSTRAINT ${CONSTRAINT}\\s+CHECK \\(widget_type IN \\(([^)]*)\\)\\)`).exec(
    sql,
  );
  if (match === null) {
    throw new Error(`could not read ${CONSTRAINT}'s IN list from 0118 — fix this parser.`);
  }
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
};

/** `widgetTypeSchema`'s values from the contract source; throws rather than return `[]`. */
const widgetTypes = (): string[] => {
  const block = /export const widgetTypeSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(read(CONTRACT_REL));
  if (block === null) throw new Error(`could not find widgetTypeSchema in ${CONTRACT_REL}`);
  const values = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (values.length === 0) throw new Error("widgetTypeSchema parsed to an empty list");
  return values;
};

/**
 * `F4.305` — the static half of migration `0118` (ADR 0108 Amendment 3): the widget-type CHECK
 * widened by `trend_strip` to thirteen, and `bms.dashboards.stock_version integer` (the once-per-copy
 * stamp of the stock v5 upgrade, owner answer 2026-11-01).
 */
describe("F4.305 — migration 0118: the trend_strip widget type and the stock_version stamp", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("ALTER TABLE bms.dashboard_widgets");
  });

  it("widens the widget-type CHECK to thirteen values including trend_strip", () => {
    const list = checkList(sqlOnly(read(MIGRATION_REL)));
    expect(list.length).toBe(13);
    expect(list).toContain("trend_strip");
  });

  it("keeps every value 0099 admitted", () => {
    const previous = checkList(sqlOnly(read("packages/db/drizzle/0099_breaker_table_widget_type.sql")));
    expect(previous.length).toBe(12);
    const now = checkList(sqlOnly(read(MIGRATION_REL)));
    for (const type of previous) expect(now, `${type} must stay accepted`).toContain(type);
  });

  it("lists exactly the contract's widgetTypeSchema, trend_strip last", () => {
    expect(checkList(sqlOnly(read(MIGRATION_REL)))).toEqual(widgetTypes());
    expect(widgetTypes().at(-1)).toBe("trend_strip");
  });

  it("drops the constraint before adding it, with no IF NOT EXISTS guard on the ADD", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(dropAt, "the constraint must be dropped").toBeGreaterThan(-1);
    expect(addAt, "the constraint must be added").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("adds stock_version as a nullable integer on bms.dashboards, no NOT NULL and no DEFAULT", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const match = /ALTER TABLE bms\.dashboards\s+ADD COLUMN stock_version integer\s*;/.exec(sql);
    expect(match, "ADD COLUMN stock_version integer; (nullable, no default)").not.toBeNull();
    const statement = /ALTER TABLE bms\.dashboards[^;]*;/.exec(sql)?.[0] ?? "";
    expect(statement).not.toMatch(/NOT NULL/i);
    expect(statement).not.toMatch(/DEFAULT/i);
  });

  it("declares the column in the dashboards block of the drizzle schema", () => {
    const schema = read(SCHEMA_REL);
    const start = schema.indexOf("export const dashboards = bmsSchema.table(");
    expect(start).toBeGreaterThan(-1);
    const next = schema.indexOf("\nexport const ", start + 10);
    const block = schema.slice(start, next === -1 ? undefined : next);
    expect(block).toContain('stockVersion: integer("stock_version")');
    expect(block).not.toMatch(/stock_version"\)\.notNull/);
  });

  it("journals 0118 as idx 119 after 0117, not ahead of the clock, with increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find((row) => row.tag === PREVIOUS_TAG);
    expect(entry, "0118 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous?.idx).toBe(118);
    expect(entry?.idx).toBe(119);
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });
});
