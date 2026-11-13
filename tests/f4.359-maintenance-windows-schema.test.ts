import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0152_maintenance_windows.sql";
const MIRROR_REL = "packages/db/src/schema/alarms-schema.ts";
const BMS_MIRROR_REL = "packages/db/src/schema/bms-schema.ts";
const TAG = "0152_maintenance_windows";
const PREVIOUS_TAG = "0151_device_alarms";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));
const flatten = (sql: string): string => sql.replace(/\s+/g, " ");
const flat = (): string => flatten(migration());

const ownerBracket = (sql: string): string => {
  const start = sql.indexOf("SET ROLE bms_owner;");
  const end = sql.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return sql.slice(start, end);
};

/** Every constraint the migration adds behind a probe, with the table it lands on. */
const PROBED: ReadonlyArray<readonly [string, string]> = [
  ["assets_id_organization_id_key", "bms.assets"],
  ["automation_rules_id_organization_id_key", "bms.automation_rules"],
  ["alarms_suppressed_by_window_id_organization_id_fkey", "bms.alarms"],
  ["alarms_suppressed_shape_check", "bms.alarms"],
];

/** The constraints written inline in the two CREATE TABLEs. */
const INLINE = [
  "maintenance_windows_id_organization_id_key",
  "maintenance_windows_reason_check",
  "maintenance_windows_period_check",
  "maintenance_windows_ended_shape_check",
  "maintenance_windows_work_order_fkey",
  "maintenance_windows_maintenance_schedule_fkey",
  "maintenance_window_targets_one_target_check",
  "maintenance_window_targets_window_fkey",
  "maintenance_window_targets_asset_fkey",
  "maintenance_window_targets_location_fkey",
  "maintenance_window_targets_rule_fkey",
] as const;

const INDEXES = [
  "maintenance_schedules_organization_id_id_key",
  "maintenance_windows_open_ends_at_idx",
  "maintenance_window_targets_asset_uidx",
  "maintenance_window_targets_location_uidx",
  "maintenance_window_targets_rule_uidx",
] as const;

const TABLES = ["maintenance_windows", "maintenance_window_targets"] as const;

/** Each probed ADD CONSTRAINT and its pg_constraint probe on the right table. */
const unprobedAdds = (sql: string): string[] => {
  const adds = [...sql.matchAll(/ALTER TABLE (bms\.\w+) ADD CONSTRAINT (\w+)/g)];
  return adds
    .filter(([, table, name]) => !sql.includes(`WHERE conname = '${name}' AND conrelid = '${table}'::regclass`))
    .map(([, , name]) => name as string);
};

/** DDL keywords before `SET ROLE bms_owner;` or after `RESET ROLE;`. */
const ddlOutsideBracket = (sql: string): string[] => {
  const before = sql.slice(0, sql.indexOf("SET ROLE bms_owner;"));
  const after = sql.slice(sql.indexOf("RESET ROLE;"));
  return [...`${before}\n${after}`.matchAll(/\b(CREATE|ALTER|DROP|COMMENT ON)\b/g)].map((m) => m[1] as string);
};

/** The body of `CREATE TABLE bms.<table> (` up to its closing `);`. */
const tableBody = (sql: string, table: string): string => {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE bms.${table}`);
  return sql.slice(start, sql.indexOf(");", start));
};

/** A single-column REFERENCES on a target column: it would skip the organization. */
const singleColumnTargetKeys = (body: string): string[] =>
  [...body.matchAll(/\b(asset_id|location_id|rule_id|window_id) uuid[^,]*REFERENCES/g)].map((m) => m[1] as string);

/** The FORCE + ENABLE pair for each new table. */
const unforcedTables = (sql: string): string[] =>
  TABLES.filter(
    (t) =>
      !sql.includes(`ALTER TABLE bms.${t} ENABLE ROW LEVEL SECURITY;`) ||
      !sql.includes(`ALTER TABLE bms.${t} FORCE ROW LEVEL SECURITY;`),
  );

/** A CHECK added NOT VALID whose VALIDATE never follows. */
const unvalidatedChecks = (sql: string): string[] =>
  [...sql.matchAll(/ADD CONSTRAINT (\w+) CHECK [\s\S]*? NOT VALID/g)]
    .map((m) => m[1] as string)
    .filter((name) => !sql.includes(`VALIDATE CONSTRAINT ${name};`));

/**
 * `F4.359` / ADR 0131 decision 17 (+ plan ruling Q2) — the static half of
 * migration `0152`: `bms.maintenance_windows`, `bms.maintenance_window_targets`,
 * and three suppression columns on `bms.alarms`.
 * `tests/f4.359-maintenance-windows-schema.integration.test.ts` asserts what
 * Postgres enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.359 — maintenance windows (migration 0152)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(migration().length).toBeGreaterThan(4000);
  });

  it("is the only migration numbered 0152", () => {
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0152_"));
    expect(files).toEqual(["0152_maintenance_windows.sql"]);
  });

  it("registers 0152 in the journal right after 0151, above its when and not ahead of the clock", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "0152 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(previous).toBeDefined();
    expect(entry?.idx).toBe(153);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.idx).toBe((previous?.idx as number) + 1);
    expect(Number.isFinite(entry?.when)).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(previous?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
    expect(journal.entries.indexOf(entry as Record<string, unknown>)).toBe(
      journal.entries.indexOf(previous as Record<string, unknown>) + 1,
    );
  });

  it("brackets every DDL statement in one SET ROLE bms_owner / RESET ROLE, lock_timeout first, no GRANT", () => {
    const sql = migration();
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    const lock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.indexOf("SET ROLE bms_owner;"));
    expect(ddlOutsideBracket(sql)).toEqual([]);
    // The scan itself: DDL moved after RESET ROLE is caught.
    expect(ddlOutsideBracket(`${sql}\nALTER TABLE bms.alarms ADD COLUMN x int;`)).toEqual(["ALTER"]);
  });

  it("has no statement-breakpoint marker (the 0038 reason)", () => {
    expect(read(MIGRATION_REL)).not.toContain("--> statement-breakpoint");
  });

  it("adds the three parent keys: two UNIQUE constraints and the 0144-idiom unique index", () => {
    const sql = flat();
    expect(sql).toContain(
      "ALTER TABLE bms.assets ADD CONSTRAINT assets_id_organization_id_key UNIQUE (id, organization_id);",
    );
    expect(sql).toContain(
      "ALTER TABLE bms.automation_rules ADD CONSTRAINT automation_rules_id_organization_id_key UNIQUE (id, organization_id);",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS maintenance_schedules_organization_id_id_key ON bms.maintenance_schedules (organization_id, id);",
    );
  });

  it("puts every ADD CONSTRAINT behind a pg_constraint probe on its own table", () => {
    const sql = flat();
    const adds = [...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1] as string);
    expect(adds.sort()).toEqual(PROBED.map(([name]) => name).sort());
    expect(unprobedAdds(sql)).toEqual([]);
    // The scan itself: a probe naming the wrong table is caught.
    const mutated = sql.replace(
      "WHERE conname = 'assets_id_organization_id_key' AND conrelid = 'bms.assets'::regclass",
      "WHERE conname = 'assets_id_organization_id_key' AND conrelid = 'bms.locations'::regclass",
    );
    expect(unprobedAdds(mutated)).toEqual(["assets_id_organization_id_key"]);
  });

  it("creates bms.maintenance_windows with the reason, period, ended shape and the two composite link keys", () => {
    const sql = flat();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.maintenance_windows (");
    expect(sql).toContain("reason text NOT NULL,");
    expect(sql).toContain("created_by uuid NOT NULL REFERENCES bms.users(id),");
    expect(sql).toContain("ended_by uuid REFERENCES bms.users(id),");
    expect(sql).toContain("CONSTRAINT maintenance_windows_id_organization_id_key UNIQUE (id, organization_id)");
    expect(sql).toContain(
      "CONSTRAINT maintenance_windows_reason_check CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000)",
    );
    expect(sql).toContain("CONSTRAINT maintenance_windows_period_check CHECK (ends_at > starts_at)");
    expect(sql).toContain(
      "CONSTRAINT maintenance_windows_ended_shape_check CHECK ((ended_at IS NULL) = (ended_by IS NULL))",
    );
    expect(sql).toContain(
      "CONSTRAINT maintenance_windows_work_order_fkey FOREIGN KEY (organization_id, work_order_id) " +
        "REFERENCES bms.work_orders (organization_id, id)",
    );
    expect(sql).toContain(
      "CONSTRAINT maintenance_windows_maintenance_schedule_fkey FOREIGN KEY (organization_id, maintenance_schedule_id) " +
        "REFERENCES bms.maintenance_schedules (organization_id, id)",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS maintenance_windows_open_ends_at_idx ON bms.maintenance_windows " +
        "(organization_id, ends_at) WHERE ended_at IS NULL;",
    );
  });

  it("creates bms.maintenance_window_targets: exactly one target, every key composite on organization_id", () => {
    const sql = flat();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.maintenance_window_targets (");
    expect(sql).toContain(
      "CONSTRAINT maintenance_window_targets_one_target_check CHECK (num_nonnulls(asset_id, location_id, rule_id) = 1)",
    );
    expect(sql).toContain(
      "CONSTRAINT maintenance_window_targets_window_fkey FOREIGN KEY (window_id, organization_id) " +
        "REFERENCES bms.maintenance_windows (id, organization_id) ON DELETE CASCADE",
    );
    for (const [column, table] of [
      ["asset_id", "assets"],
      ["location_id", "locations"],
      ["rule_id", "automation_rules"],
    ] as const) {
      const name = `maintenance_window_targets_${column.replace("_id", "")}_fkey`;
      expect(sql).toContain(
        `CONSTRAINT ${name} FOREIGN KEY (${column}, organization_id) REFERENCES bms.${table} (id, organization_id)`,
      );
      expect(sql).toContain(
        `CREATE UNIQUE INDEX IF NOT EXISTS maintenance_window_targets_${column.replace("_id", "")}_uidx ` +
          `ON bms.maintenance_window_targets (window_id, ${column}) WHERE ${column} IS NOT NULL;`,
      );
    }
    // No single-column target key: the referential check runs with row security
    // off, so one would let a target name another organization's row.
    const body = tableBody(sql, "maintenance_window_targets");
    expect(singleColumnTargetKeys(body)).toEqual([]);
    expect(singleColumnTargetKeys(body.replace("asset_id uuid,", "asset_id uuid REFERENCES bms.assets(id),"))).toEqual([
      "asset_id",
    ]);
  });

  it("adds the three nullable suppression columns and the composite window key on bms.alarms", () => {
    const owner = ownerBracket(flat());
    for (const column of ["suppressed_at timestamptz", "suppressed_by_window_id uuid", "unsuppressed_at timestamptz"]) {
      expect(owner).toContain(`ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS ${column};`);
    }
    expect(owner).toContain(
      "ADD CONSTRAINT alarms_suppressed_by_window_id_organization_id_fkey " +
        "FOREIGN KEY (suppressed_by_window_id, organization_id) REFERENCES bms.maintenance_windows (id, organization_id)",
    );
  });

  it("adds the suppressed shape CHECK NOT VALID, then validates it", () => {
    const sql = flat();
    expect(sql).toContain(
      "ADD CONSTRAINT alarms_suppressed_shape_check CHECK ( " +
        "(suppressed_at IS NULL OR suppressed_by_window_id IS NOT NULL) " +
        "AND (source <> 'ingest_host' OR suppressed_at IS NULL) " +
        ") NOT VALID",
    );
    expect(unvalidatedChecks(sql)).toEqual([]);
    expect(sql.indexOf("VALIDATE CONSTRAINT alarms_suppressed_shape_check;")).toBeGreaterThan(
      sql.indexOf("ADD CONSTRAINT alarms_suppressed_shape_check "),
    );
    // The scan itself: a dropped VALIDATE is caught.
    expect(unvalidatedChecks(sql.replace("VALIDATE CONSTRAINT alarms_suppressed_shape_check;", ""))).toEqual([
      "alarms_suppressed_shape_check",
    ]);
  });

  it("ENABLEs and FORCEs row level security on both tables, with a strict tenant_isolation policy", () => {
    const sql = flat();
    expect(unforcedTables(sql)).toEqual([]);
    for (const table of TABLES) {
      expect(sql).toContain(
        `DROP POLICY IF EXISTS tenant_isolation ON bms.${table}; CREATE POLICY tenant_isolation ON bms.${table} ` +
          "USING ( organization_id = nullif(current_setting('app.current_organization', true), '')::uuid ) " +
          "WITH CHECK ( organization_id = nullif(current_setting('app.current_organization', true), '')::uuid );",
      );
    }
    expect(sql).not.toMatch(/organization_id IS NULL/);
    // The scan itself: a dropped FORCE is caught.
    expect(
      unforcedTables(sql.replace("ALTER TABLE bms.maintenance_windows FORCE ROW LEVEL SECURITY;", "")),
    ).toEqual(["maintenance_windows"]);
  });

  it("creates no name an earlier migration already uses", () => {
    const dir = join(repoRoot, "packages/db/drizzle");
    const others = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f < "0152_")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const name of [...PROBED.map(([n]) => n), ...INLINE, ...INDEXES, ...TABLES]) {
      expect(others.includes(name), `${name} is already used by another migration`).toBe(false);
    }
  });

  it("proves the tables, RLS, policies, every constraint and the alarm columns in a DO block after RESET ROLE", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("RESET ROLE;"));
    for (const name of [...PROBED.map(([n]) => n), ...INLINE, "maintenance_schedules_organization_id_id_key"]) {
      expect(proof, name).toContain(`'${name}'`);
    }
    for (const column of ["suppressed_at", "suppressed_by_window_id", "unsuppressed_at"]) {
      expect(proof).toContain(`'${column}'`);
    }
    expect(proof).toContain("relforcerowsecurity");
    expect(proof).toContain("polqual");
    expect(proof).toContain("polwithcheck");
    expect(proof).toContain("convalidated");
    expect(proof).toMatch(/RAISE EXCEPTION/);
  });

  it("the Drizzle mirror names every constraint it mirrors, and says the SQL-only ones are SQL-only", () => {
    const mirror = read(MIRROR_REL);
    expect(mirror).toContain('export const maintenanceWindows = bmsSchema.table("maintenance_windows"');
    expect(mirror).toContain('export const maintenanceWindowTargets = bmsSchema.table("maintenance_window_targets"');
    for (const name of [
      "maintenance_windows_id_organization_id_key",
      "maintenance_window_targets_window_fkey",
      "maintenance_window_targets_asset_fkey",
      "maintenance_window_targets_location_fkey",
      "maintenance_window_targets_rule_fkey",
      "alarms_suppressed_by_window_id_organization_id_fkey",
      "automation_rules_id_organization_id_key",
    ]) {
      expect(mirror, name).toContain(`"${name}"`);
    }
    // The two link keys point into maintenance-schema.ts, which imports this
    // file: they stay SQL-only and the mirror says so by name.
    for (const name of ["maintenance_windows_work_order_fkey", "maintenance_windows_maintenance_schedule_fkey"]) {
      expect(mirror, name).toContain(name);
    }
    expect(read("packages/db/src/schema/maintenance-schema.ts")).toContain('from "./alarms-schema"');
    expect(mirror).not.toMatch(/from "\.\/maintenance-schema"/);
    expect(mirror).toContain('suppressedAt: timestamp("suppressed_at", { withTimezone: true })');
    expect(mirror).toContain('suppressedByWindowId: uuid("suppressed_by_window_id")');
    expect(mirror).toContain('unsuppressedAt: timestamp("unsuppressed_at", { withTimezone: true })');
    expect(read(BMS_MIRROR_REL)).toContain('unique("assets_id_organization_id_key").on(t.id, t.organizationId)');
  });
});
