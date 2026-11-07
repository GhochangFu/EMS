import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0128_organization_ingest_enabled.sql";
const TAG = "0128_organization_ingest_enabled";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of `name` from its declaration to the next top-level declaration. */
const sliceFrom = (source: string, start: string, end: RegExp): string => {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(from + start.length);
  const stop = rest.search(end);
  return stop < 0 ? rest : rest.slice(0, stop);
};

/**
 * `F4.330` / ADR 0115 decision 1 — the static half of migration `0128`
 * (`bms.organizations.ingest_enabled`). What Postgres enforces is owed to the local stack (the PR
 * body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.330 — bms.organizations.ingest_enabled (migration 0128)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBe(3);
  });

  it("registers migration 0128 in the journal as idx 129, after 0127 and not ahead of now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0127_pump_station_roles");
    expect(entry, "migration 0128 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(prev?.when).toBe(1793969366525);
    expect(entry?.idx).toBe(129);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("adds the column NOT NULL DEFAULT true, idempotently, inside SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const alter = migration.indexOf(
      "ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS ingest_enabled boolean NOT NULL DEFAULT true;",
    );
    const reset = migration.indexOf("RESET ROLE;");
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(alter).toBeGreaterThan(setRole);
    expect(reset).toBeGreaterThan(alter);
  });

  it("issues no GRANT, no POLICY and no UPDATE (ADR 0115 decision 1: no grant change, no backfill)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bPOLICY\b/i);
    expect(migration).not.toMatch(/\bUPDATE\b/i);
  });

  it("declares the Drizzle column inside organizations", () => {
    const table = sliceFrom(
      read("packages/db/src/schema/bms-schema.ts"),
      'export const organizations = bmsSchema.table("organizations", {',
      /\n\}\);/,
    );
    expect(table).toContain('ingestEnabled: boolean("ingest_enabled").notNull().default(true)');
  });

  it("no seed writes ingest_enabled, so a re-seed never reverts the switch", () => {
    const ensure = sliceFrom(
      read("packages/db/src/hierarchy-seed.ts"),
      "export async function ensureOrganizations(",
      /\n\}\n/,
    );
    const demo = sliceFrom(read("packages/db/src/demo-ion-exchange.ts"), "const ORG_INSERT_SQL = `", /`;/);
    // Positive control: the slices are the organization inserts.
    expect(ensure).toContain("timezone");
    expect(demo).toContain("timezone");
    expect(ensure).not.toContain("ingest_enabled");
    expect(demo).not.toContain("ingest_enabled");
  });
});
