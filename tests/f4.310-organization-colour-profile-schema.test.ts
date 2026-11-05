import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0125_organization_colour_profile.sql";
const TAG = "0125_organization_colour_profile";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * `F4.310` / ADR 0110 decision 6 — the static half of migration `0125`
 * (`bms.organizations.colour_profile`). What Postgres enforces is owed to the local stack (the PR
 * body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.310 — bms.organizations.colour_profile (migration 0125)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(3);
  });

  it("registers migration 0125 in the journal, after 0124 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0124_mimic_layout_node_points");
    expect(entry, "migration 0125 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(126);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });

  it("adds the column NOT NULL with default nexus, idempotently", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      "ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS colour_profile varchar(32) NOT NULL DEFAULT 'nexus';",
    );
  });

  it("the CHECK lists exactly the six names of colourProfileSchema, in order", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const m = /CHECK \(colour_profile IN \(([^)]*)\)\)/.exec(migration);
    expect(m, "a CHECK on colour_profile").not.toBeNull();
    const names = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(names).toEqual([...COLOUR_PROFILES]);
  });

  it("drops the named CHECK before it adds it, so a re-run is safe", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf("DROP CONSTRAINT IF EXISTS organizations_colour_profile_check;");
    const add = migration.indexOf("ADD CONSTRAINT organizations_colour_profile_check");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
  });

  it("declares the Drizzle column", () => {
    expect(read("packages/db/src/schema/bms-schema.ts")).toContain(
      'colourProfile: varchar("colour_profile", { length: 32 }).notNull().default("nexus")',
    );
  });
});
