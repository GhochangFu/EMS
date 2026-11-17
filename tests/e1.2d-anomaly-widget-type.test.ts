import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE_REL = "packages/db/drizzle";
const PREVIOUS_CHECK_REL = `${DRIZZLE_REL}/0159_forecast_widget_type.sql`;
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const JOURNAL_REL = `${DRIZZLE_REL}/meta/_journal.json`;
const CONSTRAINT = "dashboard_widgets_widget_type_check";

/** The migration by its glob `*_anomaly_widget_type.sql`, so the test survives renumbering. */
const migrationFile = (): string => {
  const found = readdirSync(join(repoRoot, DRIZZLE_REL)).filter((name) =>
    name.endsWith("_anomaly_widget_type.sql"),
  );
  if (found.length !== 1) throw new Error(`expected one *_anomaly_widget_type.sql, found ${found.length}`);
  return found[0]!;
};
const migrationRel = (): string => `${DRIZZLE_REL}/${migrationFile()}`;
const tag = (): string => migrationFile().replace(/\.sql$/, "");

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
  if (match === null) throw new Error(`could not read ${CONSTRAINT}'s IN list — fix this parser.`);
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
 * `E1.2d` — the static half of the `anomaly` widget-type migration (ADR 0135 Amendment 5 ruling
 * 4(c)): the widget-type CHECK widened by `anomaly` to fifteen, in the `0159` shape. No `ml.*`
 * object is touched, so the ML schema marker stays at 3.
 */
describe("E1.2d — the anomaly widget type migration", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, migrationRel()))).toBe(true);
    expect(sqlOnly(read(migrationRel()))).toContain("ALTER TABLE bms.dashboard_widgets");
  });

  it("widens the widget-type CHECK to fifteen values including anomaly", () => {
    const list = checkList(sqlOnly(read(migrationRel())));
    expect(list.length).toBe(15);
    expect(list).toContain("anomaly");
  });

  it("keeps every value 0159 admitted", () => {
    const previous = checkList(sqlOnly(read(PREVIOUS_CHECK_REL)));
    expect(previous.length).toBe(14);
    const now = checkList(sqlOnly(read(migrationRel())));
    for (const type of previous) expect(now, `${type} must stay accepted`).toContain(type);
  });

  // E1.9f: 0161 is frozen at fifteen; the effective CHECK is `*_ml_findings_widget_type.sql`'s.
  it("is frozen at fifteen and equals the enum less ml_findings, anomaly last of those", () => {
    const before = widgetTypes().filter((value) => value !== "ml_findings");
    expect(checkList(sqlOnly(read(migrationRel())))).toEqual(before);
    expect(before.at(-1)).toBe("anomaly");
  });

  it("drops the constraint before adding it, with no IF NOT EXISTS guard on the ADD", () => {
    const sql = sqlOnly(read(migrationRel()));
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(dropAt, "the constraint must be dropped").toBeGreaterThan(-1);
    expect(addAt, "the constraint must be added").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("bounds its lock wait, proves the constraint in a DO block, and leaves ml.* alone", () => {
    const sql = sqlOnly(read(migrationRel()));
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toMatch(/DO \$\$[\s\S]*pg_get_constraintdef[\s\S]*anomaly[\s\S]*forecast[\s\S]*\$\$;/);
    expect(sql).not.toMatch(/\bml\./);
    expect(sql).not.toMatch(/SET ROLE/i);
  });

  it("journals the migration right after the entry before it, not ahead of the clock", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((row) => row.tag === tag());
    expect(at, "the migration must have a journal entry, or drizzle silently skips the file").toBeGreaterThan(0);
    const entry = journal.entries[at]!;
    const previous = journal.entries[at - 1]!;
    expect(entry.idx).toBe(previous.idx + 1);
    expect(Number(entry.tag.slice(0, 4))).toBe(Number(previous.tag.slice(0, 4)) + 1);
    expect(entry.when > previous.when).toBe(true);
    expect(entry.when <= Date.now()).toBe(true);
  });
});
