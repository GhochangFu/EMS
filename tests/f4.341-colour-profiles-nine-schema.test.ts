import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { repoRoot } from "./support/source-scan";

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0133_colour_profiles_nine.sql";
const TAG = "0133_colour_profiles_nine";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * `F4.341` PR 2 (ADR 0118 decision 13, Amendment 2 D5) — the static half of migration `0133`, which
 * widens `organizations_colour_profile_check` to the nine names. What Postgres enforces (the
 * constraint as installed, a `forest` write accepted) is owed to the local stack (plan §10).
 */
describe("F4.341 — the nine-name colour-profile CHECK (migration 0133)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBe(4);
  });

  it("registers migration 0133 in the journal, right after 0132 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: Array<Record<string, unknown>> };
    const i = journal.entries.findIndex((e) => e.tag === TAG);
    expect(i, "migration 0133 must have a journal entry, or drizzle never runs it").toBeGreaterThan(0);
    const entry = journal.entries[i];
    const prev = journal.entries[i - 1];
    expect(prev.tag).toBe("0132_onboarding_session_lock");
    expect(entry.idx).toBe((prev.idx as number) + 1);
    expect(entry.version).toBe("7");
    expect(entry.breakpoints).toBe(true);
    expect(entry.when as number).toBeGreaterThan(prev.when as number);
    expect(entry.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.trim().startsWith("SET ROLE bms_owner;")).toBe(true);
    expect(migration.trim().endsWith("RESET ROLE;")).toBe(true);
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });

  it("the CHECK lists exactly the names of colourProfileSchema, in order", () => {
    const m = /CHECK \(colour_profile IN \(([^)]*)\)\)/.exec(sqlOnly(read(MIGRATION_REL)));
    expect(m, "a CHECK on colour_profile").not.toBeNull();
    const names = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(names).toEqual([...COLOUR_PROFILES]);
    expect(names).toHaveLength(9);
  });

  it("drops the named CHECK before it adds it, so a re-run is safe, and touches no column", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf("ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_colour_profile_check;");
    const add = migration.indexOf("ADD CONSTRAINT organizations_colour_profile_check");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
    expect(migration).not.toMatch(/\b(?:ADD|DROP|ALTER) COLUMN\b/i);
  });
});
