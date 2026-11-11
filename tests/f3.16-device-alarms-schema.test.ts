import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0151_device_alarms.sql";
const MIRROR_REL = "packages/db/src/schema/alarms-schema.ts";
const TAG = "0151_device_alarms";
const PREVIOUS_TAG = "0150_device_health_utc_bucket";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));
const flat = (): string => migration().replace(/\s+/g, " ");

const ownerBracket = (sql: string): string => {
  const start = sql.indexOf("SET ROLE bms_owner;");
  const end = sql.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return sql.slice(start, end);
};

/**
 * `F3.16` / ADR 0127 decision 12 — the static half of migration `0151`: device
 * alarms in `bms.alarms` (nullable `asset_id`, `source`, `rtu_id`, the shape
 * CHECK and the per-device dedupe index).
 * `tests/f3.16-device-alarms-schema.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("F3.16 — device alarms (migration 0151)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(migration().length).toBeGreaterThan(1500);
  });

  it("is the only migration numbered 0151", () => {
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0151_"));
    expect(files).toEqual(["0151_device_alarms.sql"]);
  });

  it("registers 0151 in the journal right after 0150, above its when and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "0151 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(previous).toBeDefined();
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.idx).toBe((previous?.idx as number) + 1);
    expect(entry?.when as number).toBeGreaterThan(previous?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
    expect(journal.entries.indexOf(entry as Record<string, unknown>)).toBe(
      journal.entries.indexOf(previous as Record<string, unknown>) + 1,
    );
  });

  it("brackets the DDL in one SET ROLE bms_owner / RESET ROLE, issues no GRANT, lock_timeout first", () => {
    const sql = migration();
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    const lock = sql.indexOf("SET LOCAL lock_timeout");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.indexOf("SET ROLE bms_owner;"));
    expect(sql.indexOf("ALTER TABLE bms.alarms")).toBeGreaterThan(sql.indexOf("SET ROLE bms_owner;"));
    const proof = sql.slice(sql.indexOf("RESET ROLE;"));
    expect(proof).not.toMatch(/\b(CREATE|ALTER) (TABLE|INDEX|UNIQUE INDEX)\b/);
  });

  it("drops NOT NULL on asset_id and adds source and rtu_id idempotently", () => {
    const owner = ownerBracket(flat());
    expect(owner).toContain("ALTER TABLE bms.alarms ALTER COLUMN asset_id DROP NOT NULL;");
    expect(owner).toContain(
      "ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'rule';",
    );
    expect(owner).toContain("ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS rtu_id uuid;");
  });

  it("puts every ADD CONSTRAINT behind a pg_constraint probe", () => {
    const sql = flat();
    const adds = [...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1] as string);
    expect(adds.sort()).toEqual([
      "alarms_rtu_id_organization_id_fkey",
      "alarms_source_check",
      "alarms_source_shape_check",
    ]);
    for (const name of adds) {
      expect(sql).toContain(`WHERE conname = '${name}' AND conrelid = 'bms.alarms'::regclass`);
    }
  });

  it("keys rtu_id to bms.rtus (id, organization_id), the composite tenant key", () => {
    expect(flat()).toContain(
      "ADD CONSTRAINT alarms_rtu_id_organization_id_fkey FOREIGN KEY (rtu_id, organization_id) " +
        "REFERENCES bms.rtus (id, organization_id)",
    );
  });

  it("closes source to the three values and the shape per source, NOT VALID then VALIDATE", () => {
    const sql = flat();
    expect(sql).toContain(
      "ADD CONSTRAINT alarms_source_check CHECK (source IN ('rule', 'rtu_comms', 'ingest_host')) NOT VALID",
    );
    expect(sql).toContain(
      "ADD CONSTRAINT alarms_source_shape_check CHECK ( " +
        "(source = 'rule' AND asset_id IS NOT NULL AND rtu_id IS NULL) " +
        "OR (source = 'rtu_comms' AND rtu_id IS NOT NULL AND asset_id IS NULL AND rule_id IS NULL) " +
        "OR (source = 'ingest_host' AND asset_id IS NULL AND rtu_id IS NULL AND rule_id IS NULL) " +
        ") NOT VALID",
    );
    for (const name of ["alarms_source_check", "alarms_source_shape_check"]) {
      const add = sql.indexOf(`ADD CONSTRAINT ${name} `);
      const validate = sql.indexOf(`VALIDATE CONSTRAINT ${name};`);
      expect(validate, `${name} must be validated`).toBeGreaterThan(add);
    }
  });

  it("creates the per-device open-alarm index, partial on uncleared non-rule alarms", () => {
    expect(flat()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_per_device_uidx ON bms.alarms " +
        "(organization_id, source, COALESCE(rtu_id, organization_id)) " +
        "WHERE cleared_at IS NULL AND source <> 'rule';",
    );
  });

  it("leaves the rule dedupe index alone", () => {
    expect(migration()).not.toContain("alarms_open_per_rule_uidx");
  });

  it("creates no name an earlier migration already uses", () => {
    const dir = join(repoRoot, "packages/db/drizzle");
    const others = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f < "0151_")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const name of [
      "alarms_rtu_id_organization_id_fkey",
      "alarms_source_check",
      "alarms_source_shape_check",
      "alarms_open_per_device_uidx",
    ]) {
      expect(others.includes(name), `${name} is already used by another migration`).toBe(false);
    }
  });

  it("proves the columns, constraints and index in a DO block after RESET ROLE", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("RESET ROLE;"));
    for (const name of [
      "alarms_rtu_id_organization_id_fkey",
      "alarms_source_check",
      "alarms_source_shape_check",
      "alarms_open_per_device_uidx",
    ]) {
      expect(proof).toContain(`'${name}'`);
    }
    expect(proof).toContain("convalidated");
    expect(proof).toContain("attnotnull");
    expect(proof).toMatch(/RAISE EXCEPTION/);
  });

  it("the Drizzle mirror: asset_id nullable, source and rtu_id, the composite key", () => {
    const mirror = read(MIRROR_REL);
    const start = mirror.indexOf('bmsSchema.table("alarms", {');
    const assetId = mirror.slice(mirror.indexOf('assetId: uuid("asset_id")', start));
    expect(assetId.slice(0, assetId.indexOf(","))).not.toContain(".notNull()");
    expect(mirror).toContain('source: varchar("source", { length: 32 }).notNull().default("rule")');
    expect(mirror).toContain('rtuId: uuid("rtu_id")');
    expect(mirror).toContain('name: "alarms_rtu_id_organization_id_fkey"');
    expect(mirror).toContain("foreignColumns: [rtus.id, rtus.organizationId]");
  });
});
