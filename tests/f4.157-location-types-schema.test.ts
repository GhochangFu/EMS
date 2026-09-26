import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0085_location_types.sql";
const TAG = "0085_location_types";

/** Strip `--` comment lines before a scan — the `f3.1a-dashboard-schema.test.ts`
 * lesson: a raw scan is satisfied by a comment quoting the statement it
 * explains, so a deleted statement stays green as long as a comment still
 * spells it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * `F4.157` — the static half of `bms.location_types`'s schema guarantees
 * (migration `0085`, ADR 0077 decisions 1-4; plan U1, T1-T6). T7 lands in U7
 * and T8 in U2 — both are named in the plan but out of this unit's scope.
 * `tests/f4.157-location-types-schema.integration.test.ts` asserts what
 * Postgres enforces; this asserts the migration's text, including what a
 * behavioural probe cannot reach (the bracket ordering). Assertions inline, no
 * `.spec` sibling (§4.6).
 */
describe("F4.157 — bms.location_types schema (migration 0085)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(500);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS bms.location_types");
  });

  // T1
  it("registers migration 0085 in the journal, tagged, with a when no later than now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.idx === 85);

    expect(entry, "migration 0085 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.tag).toBe(TAG);
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  // T2
  it("the CREATE TABLE sits between SET ROLE bms_owner and the first RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const createTable = migration.indexOf("CREATE TABLE IF NOT EXISTS bms.location_types");
    const resetRole = migration.indexOf("RESET ROLE;");

    expect(setRole, "no SET ROLE bms_owner").toBeGreaterThanOrEqual(0);
    expect(createTable, "no CREATE TABLE bms.location_types").toBeGreaterThan(setRole);
    expect(resetRole, "no RESET ROLE").toBeGreaterThan(createTable);
  });

  // T3
  it("inserts the four codes with their labels, ON CONFLICT DO NOTHING with no target", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const insertStart = migration.indexOf("INSERT INTO bms.location_types");
    expect(insertStart, "no INSERT INTO bms.location_types").toBeGreaterThanOrEqual(0);
    const insertEnd = migration.indexOf(";", insertStart);
    const insert = migration.slice(insertStart, insertEnd + 1);

    for (const [code, label] of [
      ["smoc_campus", "SMOC campus"],
      ["rsmoc", "RSMOC"],
      ["csmoc", "CSMOC"],
      ["pump_station", "Pump station"],
    ] as const) {
      expect(insert, `missing ${code}`).toContain(`'${code}'`);
      expect(insert, `missing label for ${code}`).toContain(`'${label}'`);
    }
    expect(insert).toMatch(/ON CONFLICT DO NOTHING/);
    // No target: the exact string "ON CONFLICT (" would name one.
    expect(insert).not.toMatch(/ON CONFLICT\s*\(/);
  });

  // T4
  it("revokes INSERT, UPDATE, DELETE on bms.location_types from bms_tenant", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+bms\.location_types\s+FROM\s+bms_tenant/i,
    );
  });

  // T5
  it("both UPDATEs and the ADD CONSTRAINT locations_type_fk appear after the last RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const resets = [...migration.matchAll(/RESET ROLE;/g)].map((m) => m.index ?? -1);
    expect(resets.length, "expected at least one RESET ROLE").toBeGreaterThan(0);
    const lastReset = resets[resets.length - 1] as number;

    const updateLocations = migration.indexOf("UPDATE bms.locations");
    const updateMapLocations = migration.indexOf("UPDATE bms.map_locations");
    const addConstraint = migration.indexOf("ADD CONSTRAINT locations_type_fk");

    expect(updateLocations, "no UPDATE bms.locations").toBeGreaterThan(lastReset);
    expect(updateMapLocations, "no UPDATE bms.map_locations").toBeGreaterThan(lastReset);
    expect(addConstraint, "no ADD CONSTRAINT locations_type_fk").toBeGreaterThan(lastReset);
  });

  // T6
  it("bms-schema.ts declares locationTypes and references() it from locations.type", () => {
    const schema = read("packages/db/src/schema/bms-schema.ts");
    expect(schema).toContain('bmsSchema.table("location_types"');

    const start = schema.indexOf('export const locations = bmsSchema.table("locations"');
    expect(start, "no locations table declaration found").toBeGreaterThanOrEqual(0);
    const end = schema.indexOf("});", start);
    const locationsTable = schema.slice(start, end);

    const typeStart = locationsTable.indexOf('type: varchar("type"');
    expect(typeStart, "no type column found inside the locations table").toBeGreaterThanOrEqual(0);
    const typeEnd = locationsTable.indexOf(",", locationsTable.indexOf(",", typeStart) + 1);
    const typeLine = locationsTable.slice(typeStart, typeEnd);
    expect(typeLine, "the type column must reference locationTypes.code").toContain(
      "references(() => locationTypes.code)",
    );
  });
});
