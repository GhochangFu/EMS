import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CARD_PRIMARY_METRICS, ENERGY_FEATURES } from "../packages/shared/src/contracts/energy-features";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0153_organization_energy_features.sql";
const TAG = "0153_organization_energy_features";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const sliceFrom = (source: string, start: string, end: RegExp): string => {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(from + start.length);
  const stop = rest.search(end);
  return stop < 0 ? rest : rest.slice(0, stop);
};

/** The quoted values of `CHECK (<column> IN (...))`, in order. */
const checkList = (migration: string, column: string): string[] => {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(migration);
  expect(m, `a CHECK on ${column}`).not.toBeNull();
  return (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
};

/**
 * `F4.364` / ADR 0133 decision 1 — the static half of migration `0153`
 * (`bms.organizations.energy_features` and `card_primary_metric`). What Postgres enforces is
 * `tests/f4.364-organization-energy-features-schema.integration.test.ts`. Assertions inline (§4.6,
 * top-level `tests/`).
 */
describe("F4.364 — bms.organizations energy features (migration 0153)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(5);
  });

  it("registers migration 0153 in the journal, after 0152 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0152_maintenance_windows");
    expect(entry, "migration 0153 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(154);
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
    expect(migration).not.toMatch(/\bPOLICY\b/i);
  });

  it("adds both columns NOT NULL with default auto, idempotently", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      "ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS energy_features varchar(8) NOT NULL DEFAULT 'auto';",
    );
    expect(migration).toContain(
      "ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS card_primary_metric varchar(16) NOT NULL DEFAULT 'auto';",
    );
  });

  it("each CHECK lists exactly the contract's values, in order", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(checkList(migration, "energy_features")).toEqual([...ENERGY_FEATURES]);
    expect(checkList(migration, "card_primary_metric")).toEqual([...CARD_PRIMARY_METRICS]);
  });

  it("drops each named CHECK before it adds it, so a re-run is safe", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const name of ["organizations_energy_features_check", "organizations_card_primary_metric_check"]) {
      const drop = migration.indexOf(`DROP CONSTRAINT IF EXISTS ${name};`);
      const add = migration.indexOf(`ADD CONSTRAINT ${name}`);
      expect(drop, `${name} drop`).toBeGreaterThanOrEqual(0);
      expect(add, `${name} add after drop`).toBeGreaterThan(drop);
    }
  });

  it("declares the Drizzle columns", () => {
    const schema = read("packages/db/src/schema/bms-schema.ts");
    expect(schema).toContain('energyFeatures: varchar("energy_features", { length: 8 }).notNull().default("auto"),');
    expect(schema).toContain(
      'cardPrimaryMetric: varchar("card_primary_metric", { length: 16 }).notNull().default("auto"),',
    );
  });

  it("no seed writes either column, so a re-seed never reverts a setting", () => {
    const ensure = sliceFrom(
      read("packages/db/src/hierarchy-seed.ts"),
      "export async function ensureOrganizations(",
      /\n\}\n/,
    );
    const demo = sliceFrom(read("packages/db/src/demo-ion-exchange.ts"), "const ORG_INSERT_SQL = `", /`;/);
    // Positive control: the slices are the organization inserts.
    expect(ensure).toContain("timezone");
    expect(demo).toContain("timezone");
    for (const column of ["energy_features", "card_primary_metric"]) {
      expect(ensure).not.toContain(column);
      expect(demo).not.toContain(column);
    }
  });
});
