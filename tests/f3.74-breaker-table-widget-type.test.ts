import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0099_breaker_table_widget_type.sql";
const TAG = "0099_breaker_table_widget_type";
const PREVIOUS_TAG = "0097_point_key_states_breaker_roles_asset_rating_and_layout_flags";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONSTRAINT = "dashboard_widgets_widget_type_check";

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `IN (...)` list of the widget-type CHECK in comment-free SQL, unquoted, in file order. */
const checkList = (sql: string): string[] => {
  const match = new RegExp(`ADD CONSTRAINT ${CONSTRAINT}\\s+CHECK \\(widget_type IN \\(([^)]*)\\)\\)`).exec(
    sql,
  );
  if (match === null) {
    throw new Error(`could not read ${CONSTRAINT}'s IN list from 0099 — fix this parser.`);
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
 * `F3.74` — the static half of migration `0099` (plan Task 4.1, ADR 0088 decision 10): the
 * widget-type CHECK widened by one value, `breaker_table`, to twelve. The effective CHECK is also
 * compared to the contract in `tests/f3.32-mimic-widget.test.ts` and
 * `tests/f3.73-site-widget-types.test.ts`; this file states the new value by name and the
 * migration's shape (one constraint, DROP then ADD).
 */
describe("F3.74 — migration 0099: the breaker_table widget type", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("ALTER TABLE bms.dashboard_widgets");
  });

  it("widens the widget-type CHECK to twelve values", () => {
    expect(checkList(sqlOnly(read(MIGRATION_REL))).length).toBe(12);
  });

  it("admits breaker_table", () => {
    expect(checkList(sqlOnly(read(MIGRATION_REL)))).toContain("breaker_table");
  });

  it("keeps every value 0096 admitted", () => {
    const previous = checkList(
      sqlOnly(read("packages/db/drizzle/0096_site_widget_types_and_assets_catalog.sql")),
    );
    expect(previous.length).toBe(11);
    const now = checkList(sqlOnly(read(MIGRATION_REL)));
    for (const type of previous) expect(now, `${type} must stay accepted`).toContain(type);
  });

  it("lists exactly the contract's widgetTypeSchema", () => {
    expect([...checkList(sqlOnly(read(MIGRATION_REL)))].sort()).toEqual([...widgetTypes()].sort());
  });

  it("contract declares breaker_table", () => {
    expect(widgetTypes()).toContain("breaker_table");
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

  it("alters only dashboard_widgets (no other table, no other constraint)", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const alters = [...sql.matchAll(/ALTER TABLE\s+(\S+)/g)].map((m) => m[1]);
    expect(alters, "two statements, both on bms.dashboard_widgets").toEqual([
      "bms.dashboard_widgets",
      "bms.dashboard_widgets",
    ]);
    expect([...sql.matchAll(/CONSTRAINT\s+(?:IF EXISTS\s+)?(\w+)/g)].map((m) => m[1])).toEqual([
      CONSTRAINT,
      CONSTRAINT,
    ]);
  });

  // F3.78 holds 0098 on its own branch, so this branch journals no idx 98: the gap is expected.
  it("journals 0099 as idx 99 after 0097, not ahead of the clock, with increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find((row) => row.tag === PREVIOUS_TAG);
    expect(entry, "0099 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous, "0097's entry must exist for this comparison to mean anything").toBeDefined();
    expect(entry?.idx).toBe(99);
    expect(previous?.idx).toBe(97);
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });
});

const BREAKER_ROWS_REL = "apps/api/src/dashboard-builder/breaker-rows.ts";

/**
 * `F3.74` (plan D8) — the breaker read's two bounds, by their names. The window is F3.68's literal
 * (`tests/f3.32-mimic-widget.test.ts` holds the same for `mimic-nodes.service.ts`): a bound
 * `now() - $n` plans every chunk of the hypertable. Here the constant is wrapped in `sql.raw(...)`,
 * so the count requires that wrapper — an unwrapped interpolation is a bound parameter.
 */
describe("F3.74 — the breaker-rows read", () => {
  it("interpolates GENERATED_LATEST_WINDOW_SQL exactly once, through sql.raw", () => {
    const src = read(BREAKER_ROWS_REL);
    expect(
      (src.match(/\$\{sql\.raw\([\w.]*GENERATED_LATEST_WINDOW_SQL\)\}/g) ?? []).length,
      "must interpolate sql.raw(GENERATED_LATEST_WINDOW_SQL) exactly once (F3.68's literal window, never a bound now() - $n)",
    ).toBe(1);
  });

  it("caps the member statement with LIMIT ${MAX_SITE_BREAKER_ROWS} after its ORDER BY", () => {
    expect(
      /ORDER BY m\.sort_order ASC, m\.asset_code ASC\s+LIMIT \$\{[\w.]*MAX_SITE_BREAKER_ROWS\}/.test(read(BREAKER_ROWS_REL)),
      "the member statement must end ORDER BY … LIMIT ${MAX_SITE_BREAKER_ROWS}, the contract's .max() on breakers",
    ).toBe(true);
  });
});
