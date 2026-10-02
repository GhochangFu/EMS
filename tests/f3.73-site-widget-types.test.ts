import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0096_site_widget_types_and_assets_catalog.sql";
// `F3.74`: the effective widget-type CHECK is 0099's (twelve); 0096's is frozen at eleven.
const MIGRATION_0099_REL = "packages/db/drizzle/0099_breaker_table_widget_type.sql";
const TAG = "0096_site_widget_types_and_assets_catalog";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

const NEW_WIDGET_TYPES = [
  "active_alarms_rail",
  "asset_class_strip",
  "critical_systems_list",
  "module_summary_card",
  "state_legend",
];
const NEW_CATALOG_KEYS = ["assets.list", "assets.offline.count"];

/** Strip `--` comment lines: a raw scan is satisfied by a comment quoting the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `IN (...)` list of a named CHECK in comment-free SQL, unquoted and sorted. */
const checkList = (sql: string, constraint: string, column: string): string[] => {
  const match = new RegExp(
    `ADD CONSTRAINT ${constraint}\\s+CHECK \\(${column} IN \\(([^)]*)\\)\\)`,
  ).exec(sql);
  if (match === null) {
    throw new Error(`could not read ${constraint}'s IN list from 0096 — fix this parser.`);
  }
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
};

/** A `z.enum([...])` body parsed from the contract source; throws rather than return `[]`. */
const enumValues = (name: string): string[] => {
  const block = new RegExp(`export const ${name} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\)`).exec(
    read(CONTRACT_REL),
  );
  if (block === null) throw new Error(`could not find ${name}'s z.enum([...]) in ${CONTRACT_REL}`);
  const values = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (values.length === 0) throw new Error(`${name} parsed to an empty list`);
  return values.sort();
};

/**
 * `F3.73` — the static half of migration `0096` (plan Task 3.1): the widget-type
 * CHECK widened to eleven and the catalog-key CHECK widened to ten. The effective
 * CHECK against the contract's enum is also compared in
 * `tests/f3.32-mimic-widget.test.ts` and `tests/f3.35-metric-catalog-schema.test.ts`;
 * this file states the new values by name so a dropped one fails here.
 * `tests/f3.73-site-widget-types.integration.test.ts` asserts what Postgres enforces.
 */
describe("F3.73 — migration 0096: site widget types and assets catalog keys", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL))).toContain("ALTER TABLE bms.dashboard_widgets");
  });

  it("widens the widget-type CHECK to eleven, with the five new types", () => {
    const listed = checkList(
      sqlOnly(read(MIGRATION_REL)),
      "dashboard_widgets_widget_type_check",
      "widget_type",
    );
    expect(listed.length).toBe(11);
    for (const type of NEW_WIDGET_TYPES) expect(listed, `${type} must be accepted`).toContain(type);
  });

  it("the effective widget-type CHECK (0099) is exactly the contract's enum and keeps the five", () => {
    const listed = checkList(
      sqlOnly(read(MIGRATION_0099_REL)),
      "dashboard_widgets_widget_type_check",
      "widget_type",
    );
    for (const type of NEW_WIDGET_TYPES) expect(listed, `${type} must stay accepted`).toContain(type);
    expect(listed).toEqual(enumValues("widgetTypeSchema"));
  });

  it("widens the catalog-key CHECK to exactly the contract's enum, with the two new keys", () => {
    const listed = checkList(
      sqlOnly(read(MIGRATION_REL)),
      "dashboard_widget_sources_catalog_key_check",
      "catalog_key",
    );
    expect(listed.length).toBe(10);
    for (const key of NEW_CATALOG_KEYS) expect(listed, `${key} must be accepted`).toContain(key);
    expect(listed).toEqual(enumValues("metricCatalogKeySchema"));
  });

  it("drops each constraint before adding it, with no IF NOT EXISTS guard on the ADD", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    for (const constraint of [
      "dashboard_widgets_widget_type_check",
      "dashboard_widget_sources_catalog_key_check",
    ]) {
      const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${constraint}`);
      const addAt = sql.indexOf(`ADD CONSTRAINT ${constraint}`);
      expect(dropAt, `${constraint} must be dropped`).toBeGreaterThan(-1);
      expect(addAt, `${constraint} must be added`).toBeGreaterThan(-1);
      expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    }
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("journals 0096 after 0095, not ahead of the clock, with strictly increasing `when`", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === TAG);
    const previous = journal.entries.find(
      (row) => row.tag === "0095_site_template_target_and_group_domain",
    );
    expect(entry, "0096 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(previous, "0095's entry must exist for this comparison to mean anything").toBeDefined();
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
    expect((entry?.when ?? 0) <= Date.now()).toBe(true);
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });
});
