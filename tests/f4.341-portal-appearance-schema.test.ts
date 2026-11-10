import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { repoRoot } from "./support/source-scan";

/**
 * The nine colour-profile names when 0134 was written. `F4.346` (migration 0137) widened its two
 * colour-profile CHECKs to thirteen; 0134 is frozen, so it is held to the list it was written against.
 */
const NINE_PROFILES = ["nexus", "ocean", "lagoon", "indigo", "graphite", "high-contrast", "forest", "sand", "navy-pop"];

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0134_portal_appearance.sql";
const TAG = "0134_portal_appearance";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const MIGRATION = existsSync(join(repoRoot, MIGRATION_REL)) ? sqlOnly(read(MIGRATION_REL)) : "";

/** The names of the CHECK called `name`, in order. */
function checkList(name: string): string[] {
  const m = new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(MIGRATION);
  if (!m) throw new Error(`no CHECK ${name}`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/**
 * `F4.341` PR 3 (ADR 0118 decision 9, Amendment 2 D5) — the static half of migration `0134`, the
 * appearance storage at three levels. What Postgres enforces (the tables as installed, the
 * privileges with `\dp`, the seed row) is owed to the local stack (plan §10).
 */
describe("F4.341 — appearance storage (migration 0134)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(MIGRATION.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(20);
  });

  it("registers migration 0134 in the journal, right after 0133 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: Array<Record<string, unknown>> };
    const i = journal.entries.findIndex((e) => e.tag === TAG);
    expect(i, "migration 0134 must have a journal entry").toBeGreaterThan(0);
    const [prev, entry] = [journal.entries[i - 1], journal.entries[i]];
    expect(prev.tag).toBe("0133_colour_profiles_nine");
    expect(entry.idx).toBe((prev.idx as number) + 1);
    expect(entry.version).toBe("7");
    expect(entry.breakpoints).toBe(true);
    expect(entry.when as number).toBeGreaterThan(prev.when as number);
    expect(entry.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE", () => {
    expect(MIGRATION.trim().startsWith("SET ROLE bms_owner;")).toBe(true);
    expect(MIGRATION.trim().endsWith("RESET ROLE;")).toBe(true);
  });

  it("every design-system CHECK equals designSystemSchema, every colour-profile CHECK the nine names of its day", () => {
    for (const name of ["portal_settings_design_system_check", "organizations_design_system_check", "users_design_system_check"]) {
      expect(checkList(name), name).toEqual([...DESIGN_SYSTEMS]);
    }
    for (const name of ["portal_settings_colour_profile_check", "users_colour_profile_check"]) {
      expect(checkList(name), name).toEqual(NINE_PROFILES);
    }
  });

  it("every CHECK is dropped by name before it is added, so a re-run is safe", () => {
    const names = [...MIGRATION.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    expect(names).toHaveLength(6);
    for (const name of names) {
      const drop = MIGRATION.indexOf(`DROP CONSTRAINT IF EXISTS ${name};`);
      expect(drop, name).toBeGreaterThanOrEqual(0);
      expect(MIGRATION.indexOf(`ADD CONSTRAINT ${name}`), name).toBeGreaterThan(drop);
    }
  });

  it("portal_settings is one row: id smallint PRIMARY KEY, CHECK (id = 1), seeded idempotently", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS bms\.portal_settings \(\s*id smallint PRIMARY KEY,/);
    expect(MIGRATION).toContain("CHECK (id = 1)");
    expect(MIGRATION).toContain("design_system varchar(32) NOT NULL DEFAULT 'nexus-soft'");
    expect(MIGRATION).toContain("colour_profile varchar(32) NOT NULL DEFAULT 'nexus'");
    expect(MIGRATION).toContain("INSERT INTO bms.portal_settings (id) VALUES (1) ON CONFLICT DO NOTHING;");
  });

  it("portal_settings is a global table: no RLS, no GRANT, writes revoked from the pools (the location_types shape)", () => {
    expect(MIGRATION).not.toMatch(/portal_settings[^;]*ROW LEVEL SECURITY|POLICY[^;]*portal_settings/i);
    expect(MIGRATION).not.toMatch(/GRANT[^;]*ON bms\.portal_settings/i);
    expect(MIGRATION).toContain("REVOKE INSERT, UPDATE, DELETE ON bms.portal_settings FROM bms_tenant;");
    expect(MIGRATION).toContain("REVOKE INSERT, DELETE ON bms.portal_settings FROM bms_fleet;");
  });

  it("organizations.colour_profile becomes nullable with no default; existing rows are not rewritten", () => {
    expect(MIGRATION).toContain("ALTER TABLE bms.organizations ALTER COLUMN colour_profile DROP NOT NULL;");
    expect(MIGRATION).toContain("ALTER TABLE bms.organizations ALTER COLUMN colour_profile DROP DEFAULT;");
    expect(MIGRATION).not.toMatch(/UPDATE bms\.organizations/i);
    expect(MIGRATION).toContain("ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS design_system varchar(32);");
  });

  it("users gains two nullable columns", () => {
    expect(MIGRATION).toContain("ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS design_system varchar(32);");
    expect(MIGRATION).toContain("ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS colour_profile varchar(32);");
  });

  it("the only GRANTs are the bms.users column grants (it holds column-level grants only: 0039, 0046, 0098)", () => {
    const grants = [...MIGRATION.matchAll(/^GRANT[^;]*;/gm)].map((m) => m[0]);
    expect(grants).toEqual([
      "GRANT SELECT (design_system, colour_profile) ON bms.users TO bms_tenant, bms_fleet, bms_auth;",
      "GRANT UPDATE (design_system, colour_profile) ON bms.users TO bms_fleet;",
    ]);
  });

  it("declares the Drizzle columns and the table", () => {
    const schema = read("packages/db/src/schema/bms-schema.ts");
    expect(schema).toContain('export const portalSettings = bmsSchema.table("portal_settings", {');
    expect(schema).toContain('designSystem: varchar("design_system", { length: 32 }).notNull().default("nexus-soft"),');
    expect(schema.match(/designSystem: varchar\("design_system", \{ length: 32 \}\),/g)).toHaveLength(2);
    expect(schema.match(/colourProfile: varchar\("colour_profile", \{ length: 32 \}\),/g)).toHaveLength(2);
  });
});
