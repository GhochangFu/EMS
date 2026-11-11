import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DROP_REASONS } from "../packages/shared/src/device-health";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0149_device_health.sql";
const MIRROR_REL = "packages/db/src/schema/device-health-schema.ts";
const TAG = "0149_device_health";
const TENANT_TABLES = ["rtu_health", "rtu_drop_hours"] as const;
const PLATFORM_TABLES = ["ingest_hosts", "ingest_endpoint_drop_hours"] as const;
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";
const REASONS = [...DROP_REASONS];

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const flat = (): string => sqlOnly(read(MIGRATION_REL)).replace(/\s+/g, " ");

const ownerBracket = (migration: string): string => {
  const start = migration.indexOf("SET ROLE bms_owner;");
  const end = migration.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return migration.slice(start, end);
};

/** Column names of `CREATE TABLE IF NOT EXISTS bms.<table> ( ... );`. */
const sqlColumns = (table: string): string[] => {
  const migration = sqlOnly(read(MIGRATION_REL));
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  return migration
    .slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => /^ {2}([a-z_]+) /.exec(line)?.[1])
    .filter((name): name is string => name !== undefined && !["constraint", "primary"].includes(name));
};

/** Column names declared in the Drizzle mirror for `bmsSchema.table("<table>", {...}`. */
const mirrorColumns = (table: string): string[] => {
  const source = read(MIRROR_REL);
  const start = source.indexOf(`bmsSchema.table("${table}", {`);
  if (start < 0) throw new Error(`no Drizzle table ${table}`);
  const end = source.indexOf("\n}", start);
  return [...source.slice(start, end).matchAll(/\b(?:uuid|varchar|timestamp|integer|bigint)\("([a-z_]+)"/g)].map(
    (m) => m[1] as string,
  );
};

/**
 * `F3.16` / ADR 0127 decisions 7, 8, 16 and 17 — the static half of migration
 * `0149` (`bms.rtu_health`, `bms.rtu_drop_hours`, `bms.ingest_hosts`,
 * `bms.ingest_endpoint_drop_hours`). `tests/f3.16-device-health-schema.integration.test.ts`
 * asserts what Postgres enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("F3.16 — device health tables (migration 0149)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.length).toBeGreaterThan(3000);
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(20);
  });

  it("is the only migration numbered 0149", () => {
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0149_"));
    expect(files).toEqual(["0149_device_health.sql"]);
  });

  it("registers 0149 in the journal right after 0148, above its when and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === "0148_work_order_root_cause_snapshot_approval_cancel");
    expect(entry, "0149 must have a journal entry, or drizzle never runs it").toBeDefined();
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

  it("brackets the DDL in one SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(migration.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bCREATE ROLE\b/i);
    const proof = migration.slice(migration.indexOf("RESET ROLE;"));
    expect(proof).not.toMatch(/\b(CREATE|ALTER) (TABLE|INDEX|POLICY|UNIQUE INDEX)\b/);
  });

  it("sets lock_timeout before it touches bms.rtus", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const lock = migration.indexOf("SET LOCAL lock_timeout");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(migration.indexOf("ALTER TABLE bms.rtus"));
    expect(lock).toBeLessThan(migration.indexOf("SET ROLE bms_owner;"));
  });

  it("creates each table idempotently, and the rtus key behind a pg_constraint probe", () => {
    const owner = ownerBracket(sqlOnly(read(MIGRATION_REL)));
    for (const table of [...TENANT_TABLES, ...PLATFORM_TABLES]) {
      expect(owner).toContain(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
    }
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("WHERE conname = 'rtus_id_organization_id_key' AND conrelid = 'bms.rtus'::regclass");
    expect(flat()).toContain("ADD CONSTRAINT rtus_id_organization_id_key UNIQUE (id, organization_id)");
    expect(migration).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
  });

  it.each(TENANT_TABLES)("bms.%s: organization_id NOT NULL, ENABLE and FORCE, composite key to rtus", (table) => {
    const owner = ownerBracket(sqlOnly(read(MIGRATION_REL)));
    expect(owner).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
    expect(owner).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
    expect(sqlColumns(table)).toContain("organization_id");
    expect(flat()).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
    expect(flat()).toContain(
      `CONSTRAINT ${table}_rtu_id_organization_id_fkey FOREIGN KEY (rtu_id, organization_id) ` +
        "REFERENCES bms.rtus (id, organization_id)",
    );
  });

  it.each(TENANT_TABLES)("bms.%s: drops then creates a tenant_isolation policy with USING and WITH CHECK", (table) => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);
    const create = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
    const end = migration.indexOf(";\n", create);
    const policy = migration.slice(create, end + 1);
    const split = policy.indexOf("WITH CHECK");
    expect(split).toBeGreaterThan(0);
    expect(policy.slice(0, split)).toContain(OWN_ORG);
    expect(policy.slice(split)).toContain(OWN_ORG);
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
    expect(policy).not.toMatch(/\bOR\b/i);
  });

  it("the platform tables carry no organization_id and no policy", () => {
    for (const table of PLATFORM_TABLES) {
      expect(sqlColumns(table)).not.toContain("organization_id");
      expect(sqlOnly(read(MIGRATION_REL))).not.toContain(`ON bms.${table}\n  USING`);
    }
  });

  it("the two REVOKEs, inside the bracket: write verbs on tenant tables, everything on platform tables", () => {
    const owner = ownerBracket(sqlOnly(read(MIGRATION_REL)));
    for (const table of TENANT_TABLES) {
      expect(owner).toContain(`REVOKE INSERT, UPDATE, DELETE ON bms.${table} FROM bms_tenant;`);
    }
    for (const table of PLATFORM_TABLES) {
      expect(owner).toContain(`REVOKE ALL ON bms.${table} FROM bms_tenant;`);
    }
  });

  it("DROP_REASONS is the six reasons the CHECKs hold, in this order", () => {
    expect(DROP_REASONS).toEqual([
      "badQuality",
      "nonFinite",
      "unknownDevice",
      "unmappedSourceKey",
      "ambiguousDevice",
      "outOfRange",
    ]);
  });

  it("closes reason to the six drop reasons, bucket to a whole hour and dropped above zero", () => {
    const migration = flat();
    const list = REASONS.map((r) => `'${r}'`).join(",");
    for (const table of ["rtu_drop_hours", "ingest_endpoint_drop_hours"]) {
      expect(migration).toContain(`CONSTRAINT ${table}_reason_check CHECK ( reason IN (${list}) )`);
      expect(migration).toContain(`CONSTRAINT ${table}_bucket_check CHECK (bucket = date_trunc('hour', bucket))`);
      expect(migration).toContain(`CONSTRAINT ${table}_dropped_check CHECK (dropped > 0)`);
    }
    expect(migration).toContain("CONSTRAINT rtu_drop_hours_pkey PRIMARY KEY (rtu_id, bucket, reason)");
    expect(migration).toContain(
      "CONSTRAINT ingest_endpoint_drop_hours_pkey PRIMARY KEY (host_key, endpoint_key, bucket, reason)",
    );
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS rtu_drop_hours_bucket_idx ON bms.rtu_drop_hours (bucket);");
    // No foreign key on first_asset_id.
    expect(migration).toContain("first_asset_id uuid,");
  });

  it("creates no name an earlier migration already uses", () => {
    const dir = join(repoRoot, "packages/db/drizzle");
    const others = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f < "0149_")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const name of [
      "rtus_id_organization_id_key",
      "rtu_health_rtu_id_organization_id_fkey",
      "rtu_drop_hours_pkey",
      "rtu_drop_hours_bucket_idx",
      "ingest_endpoint_drop_hours_pkey",
      "ingest_endpoint_drop_hours_bucket_idx",
    ]) {
      expect(others.includes(name), `${name} is already used by another migration`).toBe(false);
    }
  });

  it("proves RLS, privileges, constraints and indexes in a DO block after RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const proof = migration.slice(migration.indexOf("RESET ROLE;"));
    expect(proof).toContain("relrowsecurity");
    expect(proof).toContain("relforcerowsecurity");
    expect(proof).toContain("has_table_privilege('bms_tenant'");
    expect(proof).toContain("has_table_privilege('bms_fleet'");
    expect(proof).toContain("'rtus_id_organization_id_key'");
    expect(proof).toContain("rtu_drop_hours_bucket_idx");
    expect(proof).toContain("ingest_endpoint_drop_hours_bucket_idx");
    expect(proof).toContain("tenant_isolation");
    expect(proof).toMatch(/RAISE EXCEPTION/);
  });

  it.each([...TENANT_TABLES, ...PLATFORM_TABLES])(
    "the Drizzle mirror of bms.%s has the SQL's columns",
    (table) => {
      expect([...mirrorColumns(table)].sort()).toEqual([...sqlColumns(table)].sort());
    },
  );

  it("exports the mirror from the schema index and mirrors the rtus key", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./device-health-schema";');
    expect(read("packages/db/src/schema/bms-schema.ts")).toContain('unique("rtus_id_organization_id_key")');
    const mirror = read(MIRROR_REL);
    for (const name of ["rtuHealth", "rtuDropHours", "ingestHosts", "ingestEndpointDropHours"]) {
      expect(mirror).toContain(`export const ${name} = bmsSchema.table(`);
    }
  });
});
