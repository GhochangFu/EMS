import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0138_rtu_expected_interval.sql";
const TAG = "0138_rtu_expected_interval";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * `F4.350` / ADR 0075 Amendment 3 — the static half of migration `0138`
 * (`bms.rtus.expected_interval_seconds`). What Postgres enforces is owed to the real-DB run
 * (the PR body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.350 — bms.rtus.expected_interval_seconds (migration 0138)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(read(MIGRATION_REL)).toContain("expected_interval_seconds");
  });

  it("registers 0138 in the journal as idx 139, newer than every earlier entry", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0138 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(139);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    const earlier = journal.entries.filter((e) => (e.idx as number) < 139).map((e) => e.when as number);
    expect(entry?.when as number).toBeGreaterThan(Math.max(...earlier));
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("adds the nullable column and the > 0 CHECK idempotently, inside SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const alter = migration.indexOf("ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS expected_interval_seconds integer;");
    const guard = migration.indexOf("IF NOT EXISTS (");
    const check = migration.indexOf("CHECK (expected_interval_seconds IS NULL OR expected_interval_seconds > 0)");
    const reset = migration.indexOf("RESET ROLE;");
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(alter).toBeGreaterThan(setRole);
    expect(guard).toBeGreaterThan(alter);
    expect(check).toBeGreaterThan(guard);
    expect(reset).toBeGreaterThan(check);
    expect(migration).toContain("rtus_expected_interval_seconds_check");
  });

  it("issues no GRANT, POLICY, INDEX, UPDATE or DROP (no backfill, forward-only)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const word of ["GRANT", "POLICY", "INDEX", "UPDATE", "DROP", "DELETE"]) {
      expect(migration, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });

  it("declares the Drizzle column inside rtus", () => {
    const source = read("packages/db/src/schema/bms-schema.ts");
    const from = source.indexOf('export const rtus = bmsSchema.table("rtus", {');
    expect(from).toBeGreaterThanOrEqual(0);
    const table = source.slice(from, source.indexOf("\n});", from));
    expect(table).toContain('expectedIntervalSeconds: integer("expected_interval_seconds")');
  });
});
