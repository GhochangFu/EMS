import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const requireFromHere = createRequire(import.meta.url);

const MIGRATION_REL = "packages/db/drizzle/0119_dashboard_tab_key_trends.sql";
const TAG = "0119_dashboard_tab_key_trends";
const PREVIOUS_TAG = "0118_trend_strip_widget_type";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONSTRAINT = "dashboard_tabs_tab_key_check";

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The reserved array of the ADD, read from the SQL: `tab_key <> ALL (ARRAY['assets','trends'])`. */
const reservedInSql = (sql: string): string[] => {
  const match = /tab_key <> ALL \(ARRAY\[([^\]]*)\]\)/.exec(sql);
  if (match === null) throw new Error("could not read the reserved-key ARRAY from 0119 — fix this parser.");
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
};

/**
 * `F4.302` — the static half of migration `0119` (ADR 0108 Amendment 4 item 1): `trends` joins
 * `assets` as a reserved dashboard tab key. A tab already named `trends` is renamed first, so the
 * widened CHECK cannot fail validation.
 */
describe("F4.302 — migration 0119: the reserved dashboard tab key `trends`", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("bms.dashboard_tabs");
  });

  it("renames an existing `trends` tab before it touches the constraint", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const updateAt = sql.search(/UPDATE bms\.dashboard_tabs\s+SET tab_key = 'trends-' \|\| left\(id::text, 8\)\s+WHERE tab_key = 'trends'/);
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    expect(updateAt, "the UPDATE ... WHERE tab_key = 'trends' must exist").toBeGreaterThan(-1);
    expect(dropAt, "the constraint must be dropped").toBeGreaterThan(-1);
    expect(updateAt, "the UPDATE must come before the DROP").toBeLessThan(dropAt);
  });

  it("drops the constraint before adding it, with no IF NOT EXISTS guard on the ADD", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(addAt, "the constraint must be added").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("keeps the key charset in the ADD", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("tab_key ~ '^[a-z0-9-]{1,64}$'");
  });

  it("reserves exactly RESERVED_DASHBOARD_TAB_KEYS, read from packages/shared/dist", () => {
    const shared = requireFromHere(join(repoRoot, "packages/shared/dist/index.js")) as {
      RESERVED_DASHBOARD_TAB_KEYS: readonly string[];
    };
    expect(shared.RESERVED_DASHBOARD_TAB_KEYS.length).toBe(2);
    expect(reservedInSql(sqlOnly(read(MIGRATION_REL)))).toEqual([...shared.RESERVED_DASHBOARD_TAB_KEYS]);
  });

  it("journals 0119 as idx 120 after 0118, not ahead of the clock, with increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find((row) => row.tag === PREVIOUS_TAG);
    expect(entry, "0119 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous?.idx).toBe(119);
    expect(entry?.idx).toBe(120);
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });
});
