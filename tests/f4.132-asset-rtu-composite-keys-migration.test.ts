import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.132` / `F4.137` / ADR 0102 — the text of migration `0113`: the unique
 * `rtus (id, location_id)` and three composite foreign keys that hold an
 * asset's organization and an RTU to their location. The integration file
 * `tests/f4.132-asset-rtu-composite-keys.integration.test.ts` asserts what
 * Postgres enforces; this asserts the file and the Drizzle mirrors.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6). Every regex used as a gate has a positive control beside it.
 */
const STEM = "0113_asset_rtu_composite_keys";
const PREVIOUS_STEM = "0112_network_demo_node_keys";
const MIGRATION_REL = `packages/db/drizzle/${STEM}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";

/** Comments stripped before an assertion, so a header quoting DDL cannot hold a `toContain` green. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

const migration = (): string => sqlOnly(read(MIGRATION_REL));

/** The `ADD CONSTRAINT` index when it sits inside its `pg_constraint` probe, else -1. */
const guardedAddIndex = (sql: string, table: string, name: string, addClause: string): number => {
  const guard =
    "IF NOT EXISTS ( SELECT 1 FROM pg_constraint " +
    `WHERE conname = '${name}' ` +
    `AND conrelid = 'bms.${table}'::regclass ) THEN`;
  const guardAt = sql.indexOf(guard);
  if (guardAt === -1) return -1;
  const addAt = sql.indexOf(addClause, guardAt);
  const endIfAt = sql.indexOf("END IF;", guardAt);
  return addAt !== -1 && addAt < endIfAt ? addAt : -1;
};

const UNIQUE_ADD =
  "ALTER TABLE bms.rtus ADD CONSTRAINT rtus_id_location_key UNIQUE (id, location_id);";
const K2_ADD =
  "ALTER TABLE bms.rtus ADD CONSTRAINT rtus_location_id_organization_id_fkey " +
  "FOREIGN KEY (location_id, organization_id) REFERENCES bms.locations (id, organization_id) " +
  "ON DELETE NO ACTION ON UPDATE NO ACTION;";
const K3_ADD =
  "ALTER TABLE bms.assets ADD CONSTRAINT assets_location_id_organization_id_fkey " +
  "FOREIGN KEY (location_id, organization_id) REFERENCES bms.locations (id, organization_id) " +
  "ON DELETE NO ACTION ON UPDATE NO ACTION;";
const K4_ADD =
  "ALTER TABLE bms.assets ADD CONSTRAINT assets_rtu_id_location_id_fkey " +
  "FOREIGN KEY (rtu_id, location_id) REFERENCES bms.rtus (id, location_id) " +
  "ON DELETE NO ACTION ON UPDATE NO ACTION;";

describe("F4.132/F4.137 — migration 0113 text", () => {
  it("M1 the SQL file exists", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL))).toBe(true);
  });

  it("M2 the unique (id, location_id) sits in its probe, inside the bms_owner bracket", () => {
    const sql = migration();
    const at = guardedAddIndex(sql, "rtus", "rtus_id_location_key", UNIQUE_ADD);
    expect(at, "unique not inside its pg_constraint probe").toBeGreaterThan(-1);
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(sql.indexOf("SET ROLE bms_owner;"));
    expect(at).toBeLessThan(sql.indexOf("RESET ROLE;"));
  });

  it.each([
    ["M3 rtus_location_id_organization_id_fkey", "rtus", "rtus_location_id_organization_id_fkey", K2_ADD],
    ["M4 assets_location_id_organization_id_fkey", "assets", "assets_location_id_organization_id_fkey", K3_ADD],
    ["M5 assets_rtu_id_location_id_fkey", "assets", "assets_rtu_id_location_id_fkey", K4_ADD],
  ])("%s is added in its probe, after the last RESET ROLE", (_label, table, name, clause) => {
    const sql = migration();
    const at = guardedAddIndex(sql, table, name, clause);
    expect(at, `${name} not inside its pg_constraint probe`).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(sql.lastIndexOf("RESET ROLE;"));
  });

  it("M6 the refuse-never-repair guard counts all three relations before any foreign key", () => {
    const sql = migration();
    expect(sql).toMatch(
      /FROM bms\.rtus r JOIN bms\.locations l ON l\.id = r\.location_id WHERE l\.organization_id <> r\.organization_id/,
    );
    expect(sql).toMatch(
      /FROM bms\.assets a JOIN bms\.locations l ON l\.id = a\.location_id WHERE l\.organization_id <> a\.organization_id/,
    );
    expect(sql).toMatch(
      /FROM bms\.assets a JOIN bms\.rtus r ON r\.id = a\.rtu_id WHERE a\.location_id <> r\.location_id/,
    );
    const guardAt = sql.indexOf("RAISE EXCEPTION 'migration 0113:");
    expect(guardAt, "the guard's RAISE EXCEPTION").toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(sql.lastIndexOf("RESET ROLE;"));
    expect(guardAt).toBeLessThan(sql.indexOf("ADD CONSTRAINT rtus_location_id_organization_id_fkey"));
    expect(guardAt).toBeLessThan(sql.indexOf("ADD CONSTRAINT assets_location_id_organization_id_fkey"));
    expect(guardAt).toBeLessThan(sql.indexOf("ADD CONSTRAINT assets_rtu_id_location_id_fkey"));
  });

  it("M7 never cascades, nulls, skips validation, rewrites a row or turns constraints off", () => {
    const raw = read(MIGRATION_REL);
    // Positive controls: the file does contain words the gate sits beside.
    expect(raw).toContain("NO ACTION");
    expect(raw).toContain("RAISE EXCEPTION");
    for (const banned of [
      /CASCADE/i,
      /SET NULL/i,
      /NOT VALID/i,
      /UPDATE bms\./i,
      /session_replication_role/i,
    ]) {
      expect(raw, `${banned} must not appear`).not.toMatch(banned);
    }
  });

  it("M8 every pg_constraint probe names its table (the adr-0018 rule)", () => {
    const raw = read(MIGRATION_REL);
    const probes = (raw.match(/FROM pg_constraint/g) ?? []).length;
    const scoped = (raw.match(/conrelid = 'bms\.(rtus|assets)'::regclass/g) ?? []).length;
    expect(probes).toBeGreaterThanOrEqual(8);
    expect(scoped).toBe(probes);
  });

  it("M9 has no statement-breakpoint marker", () => {
    expect(read(MIGRATION_REL)).not.toContain("statement-breakpoint");
  });

  it("M9b the proof block checks all four constraints after the last ADD", () => {
    const sql = migration();
    const lastAdd = sql.indexOf("ADD CONSTRAINT assets_rtu_id_location_id_fkey");
    expect(lastAdd).toBeGreaterThan(-1);
    const proof = sql.slice(lastAdd);
    expect(proof).toContain("confdeltype = 'a' AND confupdtype = 'a'");
    expect(proof).toContain("RAISE EXCEPTION 'migration 0113:");
    for (const name of [
      "rtus_id_location_key",
      "rtus_location_id_organization_id_fkey",
      "assets_location_id_organization_id_fkey",
      "assets_rtu_id_location_id_fkey",
    ]) {
      expect(proof).toContain(`conname = '${name}'`);
    }
  });
});

describe("F4.132/F4.137 — migration 0113 is journalled", () => {
  type JournalEntry = { idx: number; when: number; tag: string };
  const entries = (): ReadonlyArray<JournalEntry> =>
    (JSON.parse(read(JOURNAL_REL)) as { entries: ReadonlyArray<JournalEntry> }).entries;

  it("M10 has an entry with the stem as tag, idx 114, a when after 0112's and not ahead of the clock", () => {
    const entry = entries().find((e) => e.tag === STEM);
    const previous = entries().find((e) => e.tag === PREVIOUS_STEM);
    expect(entry, `no journal entry "${STEM}"`).toBeDefined();
    expect(previous, `no journal entry "${PREVIOUS_STEM}"`).toBeDefined();
    expect(entry!.idx).toBe(114);
    expect(entry!.when).toBeGreaterThan(previous!.when);
    expect(entry!.when).toBeLessThanOrEqual(Date.now());
  });
});

describe("F4.132/F4.137 — the Drizzle schema mirrors migration 0113", () => {
  const slice = (startMarker: string, endMarker: string): string => {
    const source = read(SCHEMA_REL);
    const start = source.indexOf(startMarker);
    expect(start, `"${startMarker}" not found`).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start);
    expect(end, `"${endMarker}" must follow`).toBeGreaterThan(start);
    return source.slice(start, end);
  };
  const rtusSlice = (): string =>
    slice('export const rtus = bmsSchema.table("rtus", {', "\n});");
  const assetsSlice = (): string =>
    slice("export const assets = ", "export const assetGroups = ");

  const foreignKeys = (text: string): ReadonlyArray<string> =>
    [...text.matchAll(/foreignKey\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]!.replace(/\s+/g, " "));

  const hasFk = (
    blocks: ReadonlyArray<string>,
    name: string,
    columns: string,
    foreign: string,
  ): boolean =>
    blocks.some(
      (b) =>
        b.includes(`name: "${name}"`) &&
        b.includes(`columns: [${columns}]`) &&
        b.includes(`foreignColumns: [${foreign}]`),
    );

  it("M11a rtus carries the unique and the organization foreign key", () => {
    const text = rtusSlice();
    expect(text).toContain('unique("rtus_id_location_key").on(t.id, t.locationId)');
    const blocks = foreignKeys(text);
    expect(blocks).toHaveLength(1);
    expect(
      hasFk(
        blocks,
        "rtus_location_id_organization_id_fkey",
        "t.locationId, t.organizationId",
        "locations.id, locations.organizationId",
      ),
    ).toBe(true);
  });

  it("M11b assets carries the organization key and the RTU-location key", () => {
    const blocks = foreignKeys(assetsSlice());
    expect(blocks).toHaveLength(2);
    expect(
      hasFk(
        blocks,
        "assets_location_id_organization_id_fkey",
        "t.locationId, t.organizationId",
        "locations.id, locations.organizationId",
      ),
    ).toBe(true);
    expect(
      hasFk(blocks, "assets_rtu_id_location_id_fkey", "t.rtuId, t.locationId", "rtus.id, rtus.locationId"),
    ).toBe(true);
  });

  it("M11c the helper rejects a mismatched column pair (negative control)", () => {
    const blocks = foreignKeys(assetsSlice());
    expect(
      hasFk(blocks, "assets_rtu_id_location_id_fkey", "t.rtuId, t.organizationId", "rtus.id, rtus.locationId"),
    ).toBe(false);
  });

  it("M12 the assets column chains are unchanged", () => {
    const text = assetsSlice();
    expect(text).toContain('rtuId: uuid("rtu_id").references(() => rtus.id),');
    expect(text).toContain(
      'locationId: uuid("location_id")\n    .notNull()\n    .references(() => locations.id),',
    );
  });
});
