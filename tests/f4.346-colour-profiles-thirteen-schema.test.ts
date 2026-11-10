import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { repoRoot } from "./support/source-scan";

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0137_colour_profiles_thirteen.sql";
const TAG = "0137_colour_profiles_thirteen";
const CHECKS = [
  ["bms.organizations", "organizations_colour_profile_check"],
  ["bms.portal_settings", "portal_settings_colour_profile_check"],
  ["bms.users", "users_colour_profile_check"],
] as const;

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const MIGRATION = existsSync(join(repoRoot, MIGRATION_REL)) ? sqlOnly(read(MIGRATION_REL)) : "";

function checkList(name: string): string[] {
  const m = new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(colour_profile IN \\(([^)]*)\\)\\)`).exec(MIGRATION);
  if (!m) throw new Error(`no CHECK ${name}`);
  return m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 5, plan P4) — the static half of migration `0137`, which
 * widens the three `colour_profile` CHECKs to the thirteen names. What Postgres enforces (a
 * `night-shift` write accepted at each level, an unknown name refused) is the API integration case
 * A10 in `appearance.integration.spec.ts`.
 */
describe("F4.346 — the thirteen-name colour-profile CHECKs (migration 0137)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(MIGRATION.split(";").filter((s) => s.trim().length > 0).length).toBe(8);
  });

  it("registers migration 0137 in the journal, right after 0136 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: Array<Record<string, unknown>> };
    const i = journal.entries.findIndex((e) => e.tag === TAG);
    expect(i, "migration 0137 must have a journal entry, or drizzle never runs it").toBeGreaterThan(0);
    const [prev, entry] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect(prev.tag).toBe("0136_mimic_iso_symbol_library");
    expect(entry.idx).toBe((prev.idx as number) + 1);
    expect(entry.version).toBe("7");
    expect(entry.breakpoints).toBe(true);
    expect(entry.when as number).toBeGreaterThan(prev.when as number);
    expect(entry.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    expect(MIGRATION.trim().startsWith("SET ROLE bms_owner;")).toBe(true);
    expect(MIGRATION.trim().endsWith("RESET ROLE;")).toBe(true);
    expect(MIGRATION).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  it("P4 each of the three CHECKs lists exactly the thirteen names of colourProfileSchema, in order", () => {
    expect(COLOUR_PROFILES).toHaveLength(13);
    for (const [, name] of CHECKS) expect(checkList(name), name).toEqual([...COLOUR_PROFILES]);
  });

  it("drops each CHECK by name on its own table before it adds it, and touches no column or row", () => {
    for (const [table, name] of CHECKS) {
      const drop = MIGRATION.indexOf(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};`);
      expect(drop, name).toBeGreaterThanOrEqual(0);
      expect(MIGRATION.indexOf(`ADD CONSTRAINT ${name}`), name).toBeGreaterThan(drop);
    }
    expect([...MIGRATION.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1])).toEqual(CHECKS.map(([, n]) => n));
    expect(MIGRATION).not.toMatch(/\b(?:ADD|DROP|ALTER) COLUMN\b|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  });
});
