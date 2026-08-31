import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0055_dashboard_widget_table_type.sql";
const FROZEN_MIGRATION_REL = "packages/db/drizzle/0050_configurable_dashboard_tables.sql";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONSTRAINT = "dashboard_widgets_widget_type_check";

/**
 * The widget types as the contract declares them, parsed from source rather than imported.
 *
 * The same technique `tests/f3.35-metric-catalog-schema.test.ts` uses, for the same reason:
 * files in `tests/` run in the root `repo` Vitest project, and a source scan states plainly
 * that this is a cross-file drift gate rather than a use of the value.
 *
 * Throwing rather than returning `[]` is load-bearing — an empty list would make the equality
 * below compare `[]` against `[]` the moment the declaration is renamed, and the gate would go
 * green having read nothing.
 */
const widgetTypes = (): string[] => {
  const block = /export const widgetTypeSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
    read(CONTRACT_REL),
  );
  if (block === null) {
    throw new Error(
      `could not find widgetTypeSchema's z.enum([...]) in ${CONTRACT_REL}. If it was renamed ` +
        "or reshaped, fix this parser — do not delete the assertion, because the CHECK in " +
        "migration 0055 and that enum are two declarations of one vocabulary.",
    );
  }
  const types = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (types.length === 0) throw new Error("widgetTypeSchema parsed to an empty list");
  return types;
};

/** The values inside a named CHECK's `IN (...)` list, in the given migration. */
const checkedValues = (migrationRel: string): string[] => {
  const sql = read(migrationRel);
  const match = new RegExp(
    `CONSTRAINT ${CONSTRAINT}\\s+CHECK \\(widget_type IN \\(([^)]*)\\)\\)`,
  ).exec(sql);
  if (match === null) {
    throw new Error(
      `could not read ${CONSTRAINT}'s IN list from ${migrationRel} — fix this parser rather ` +
        "than the assertion.",
    );
  }
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
};

/**
 * `F3.35` Stage B — migration `0055`, ADR 0048 decision 5.
 *
 * **This file exists because `tests/f3.1a-dashboard-schema.test.ts` could not grow into it.**
 * That suite pins `0050`'s CHECK to the original four types, and it is still right to: `0050`
 * is frozen by the pre-commit hook and froze four. But it holds its list in a local
 * `WIDGET_TYPES` const rather than importing the enum, so adding `"table"` to `widgetTypeSchema`
 * did not turn it red — and nothing else compared the *effective* vocabulary to the contract.
 * A widened CHECK and an enum could therefore have drifted with a green suite, which is the
 * `F4.43` failure the two declarations exist to prevent.
 */
describe("F3.35 Stage B — the table widget type", () => {
  it("has a migration and a journal entry ordered after 0054's hand-stamped `when`", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === "0055_dashboard_widget_table_type");
    expect(entry, "0055 must have a journal entry, or drizzle silently skips the file").toBeDefined();

    const previous = journal.entries.find((row) => row.tag === "0054_dashboard_widget_sources");
    expect(previous, "0054's entry must exist for this comparison to mean anything").toBeDefined();

    // The trap this asserts against: `0054`'s `when` was hand-stamped ahead of the wall clock,
    // so a `0055` generated from the real clock sorts BEFORE it. Drizzle orders by `when`, so
    // that would run the two out of order on a fresh database and skip `0055` entirely on every
    // database where `0054` is already applied — a silent no-op, not an error.
    expect(
      (entry?.when ?? 0) > (previous?.when ?? 0),
      `0055's journal \`when\` (${entry?.when}) must be greater than 0054's (${previous?.when})`,
    ).toBe(true);

    // And the whole journal stays monotonic, which is the general form of the same rule.
    const whens = journal.entries.map((row) => row.when);
    expect(
      whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value),
      "journal `when` values must be strictly increasing",
    ).toBe(true);
  });

  it("widens the CHECK to exactly the contract's widget vocabulary", () => {
    const listed = checkedValues(MIGRATION_REL);
    const declared = widgetTypes();

    expect(listed.length, "the parsed CHECK list must not be empty").toBeGreaterThan(0);
    expect([...listed].sort()).toEqual([...declared].sort());
    expect(listed, "`table` is the value this migration exists to admit").toContain("table");
  });

  it("drops the old constraint before adding the new one, or the widening is a silent no-op", () => {
    const sql = read(MIGRATION_REL);

    // `0053` guards its ADD with `IF NOT EXISTS` because its constraint does not exist yet.
    // Here it DOES exist, carrying 0050's four-value list, so an existence guard would find it,
    // decide there was nothing to do, and leave a database that refuses every table widget
    // while reporting success. DROP IF EXISTS + ADD is both correct and idempotent.
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(dropAt, "the migration must DROP the existing constraint").toBeGreaterThan(-1);
    expect(addAt, "the migration must ADD the widened constraint").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(
      /ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql),
      "an IF NOT EXISTS guard here would skip the widening — see the migration's own header",
    ).toBe(false);
  });

  it("leaves migration 0050 frozen at its original four types", () => {
    // Not redundant with `tests/f3.1a-dashboard-schema.test.ts`, and the direction is why: that
    // suite asserts 0050 lists the four. This asserts nobody EDITED 0050 to add the fifth,
    // which is the tempting shortcut and which the pre-commit hook blocks for a reason —
    // drizzle records a hash and never re-runs an applied migration, so the edit would reach no
    // database that has already run it, including the developer's own.
    const frozen = checkedValues(FROZEN_MIGRATION_REL);
    expect(frozen.sort()).toEqual(["chart", "radial_gauge", "tank_level", "value_tile"]);
    expect(
      frozen,
      "0050 is frozen; the fifth type belongs in 0055, which widens the constraint instead",
    ).not.toContain("table");
  });
});
