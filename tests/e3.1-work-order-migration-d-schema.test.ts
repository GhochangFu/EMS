import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0148_work_order_root_cause_snapshot_approval_cancel.sql";
const TAG = "0148_work_order_root_cause_snapshot_approval_cancel";
const CODES = "work_order_cause_codes";
const CAUSE_CODES = [
  "equipment_failure",
  "wear_and_tear",
  "power_quality",
  "sensor_fault",
  "configuration_error",
  "operator_error",
  "external_event",
  "no_fault_found",
  "other",
];
const STATUSES = ["open", "assigned", "in_progress", "resolved", "closed", "cancelled"];

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migrationSql = (): string => sqlOnly(read(MIGRATION_REL));

/** The text of the first `SET ROLE bms_owner … RESET ROLE` bracket. */
const firstBracket = (migration: string): string => {
  const start = migration.indexOf("SET ROLE bms_owner;");
  const end = migration.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("the migration has no SET ROLE bms_owner / RESET ROLE bracket");
  return migration.slice(start, end);
};

/**
 * `E3.1` / ADR 0122 decisions 5, 5a, 6 and 9 — the static half of migration `0148`
 * (migration D, whole: plan D15). The cause-code vocabulary, the four findings columns,
 * the four alarm-snapshot columns (`E3.4`), the five stamps of resolve, approval and
 * cancel, and the six-value status `CHECK`. The approval and cancel columns and the
 * `cancelled` status wait one PR for their first writer.
 * `apps/api/src/work-orders/work-order-findings.integration.spec.ts` asserts what
 * Postgres enforces. Assertions inline (section 4.6, top-level `tests/`).
 */
describe("E3.1 — root cause, alarm snapshot, approval and cancel columns (migration 0148)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = migrationSql();
    expect(migration.length).toBeGreaterThan(2500);
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(12);
  });

  it("registers the migration in the journal AFTER 0147_service_account_token_guard, and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "the migration must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(149);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0147's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1794358690830);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets its DDL in SET ROLE bms_owner / RESET ROLE and issues no GRANT and no CONCURRENTLY", () => {
    const migration = migrationSql();
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it("creates the cause-code vocabulary in the ADR 0031 shape, inside the bracket", () => {
    const bracket = firstBracket(migrationSql());
    const start = bracket.indexOf(`CREATE TABLE IF NOT EXISTS bms.${CODES} (`);
    expect(start, "the table must be created as bms_owner").toBeGreaterThanOrEqual(0);
    const table = bracket.slice(start, bracket.indexOf(");\n", start));
    expect(table).toContain("code varchar(64) PRIMARY KEY,");
    expect(table).toContain("label varchar(128) NOT NULL,");
    expect(table).toContain("sort_order integer NOT NULL DEFAULT 100,");
    expect(table).toContain("active boolean NOT NULL DEFAULT true,");
    // Platform vocabulary: no tenant column.
    expect(table).not.toContain("organization_id");
  });

  it("seeds exactly the nine codes of ruling P5, in order, and never overwrites one", () => {
    const bracket = firstBracket(migrationSql());
    const start = bracket.indexOf(`INSERT INTO bms.${CODES} (code, label, sort_order) VALUES`);
    expect(start, "the seed must sit inside the bracket").toBeGreaterThan(0);
    const insert = bracket.slice(start, bracket.indexOf(";", start));
    expect([...insert.matchAll(/\(\s*'([a-z_]+)',/g)].map((match) => match[1])).toEqual(CAUSE_CODES);
    expect(insert).toContain("ON CONFLICT (code) DO NOTHING");
  });

  it("is a global catalog: no row security, and bms_tenant may only read it", () => {
    const migration = migrationSql();
    expect(migration).not.toMatch(new RegExp(`ALTER TABLE bms\\.${CODES} (ENABLE|FORCE) ROW LEVEL SECURITY`));
    expect(migration).not.toMatch(new RegExp(`CREATE POLICY \\w+ ON bms\\.${CODES}`));
    const revoke = migration.indexOf(`REVOKE INSERT, UPDATE, DELETE ON bms.${CODES} FROM bms_tenant;`);
    expect(revoke, "the REVOKE must exist").toBeGreaterThan(0);
    expect(revoke, "inside the bracket: after SET ROLE").toBeGreaterThan(migration.indexOf("SET ROLE bms_owner;"));
    expect(revoke, "inside the bracket: before RESET ROLE").toBeLessThan(migration.indexOf("RESET ROLE;"));
    for (const denied of ["INSERT", "UPDATE", "DELETE"]) {
      expect(migration, denied).toContain(`'${denied}'`);
    }
    expect(migration).toContain(`IF has_table_privilege('bms_tenant', 'bms.${CODES}', priv) THEN`);
    expect(migration).toContain(`IF NOT has_table_privilege('bms_tenant', 'bms.${CODES}', 'SELECT') THEN`);
    expect(migration).not.toMatch(/has_table_privilege\([^)]*'[A-Z]+,\s*[A-Z]+/i);
  });

  it("adds the thirteen nullable columns to work_orders", () => {
    const bracket = firstBracket(migrationSql());
    const columns = [
      "ADD COLUMN IF NOT EXISTS root_cause text",
      "ADD COLUMN IF NOT EXISTS corrective_action text",
      "ADD COLUMN IF NOT EXISTS preventive_action text",
      `ADD COLUMN IF NOT EXISTS cause_code varchar(64) REFERENCES bms.${CODES}(code)`,
      "ADD COLUMN IF NOT EXISTS alarm_root_cause text",
      "ADD COLUMN IF NOT EXISTS alarm_corrective_actions text",
      "ADD COLUMN IF NOT EXISTS alarm_skill_code varchar(64) REFERENCES bms.alarm_skills(code)",
      "ADD COLUMN IF NOT EXISTS alarm_etr_at timestamptz",
      "ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES bms.users(id)",
      "ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES bms.users(id)",
      "ADD COLUMN IF NOT EXISTS approved_at timestamptz",
      "ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES bms.users(id)",
      "ADD COLUMN IF NOT EXISTS cancelled_at timestamptz",
    ];
    for (const column of columns) {
      expect(bracket, column).toContain(column);
    }
    expect((bracket.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, "thirteen, no more").toBe(13);
    const alter = bracket.slice(bracket.indexOf("ALTER TABLE bms.work_orders"));
    expect(alter.slice(0, alter.indexOf(";")), "every new column is nullable").not.toContain("NOT NULL");
  });

  it("closes the status vocabulary over six values, cancelled among them", () => {
    const migration = migrationSql();
    expect(migration).toContain("ALTER TABLE bms.work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;");
    expect(migration).toContain(
      `ADD CONSTRAINT work_orders_status_check CHECK (status IN (${STATUSES.map((v) => `'${v}'`).join(",")}));`,
    );
  });

  it("names an off-vocabulary status before the CHECK is added, as a role that can see every row", () => {
    // Under SET ROLE bms_owner, FORCE row security hides every work order, so the
    // pre-check would pass on a table it cannot see. It runs outside a bracket.
    const migration = migrationSql();
    const check = migration.indexOf("ADD CONSTRAINT work_orders_status_check");
    const guard = migration.indexOf("NOT IN ('open','assigned','in_progress','resolved','closed','cancelled')");
    expect(guard, "the pre-check must exist").toBeGreaterThan(0);
    expect(guard, "and sit before the CHECK").toBeLessThan(check);
    const reset = migration.lastIndexOf("RESET ROLE;", guard);
    const set = migration.lastIndexOf("SET ROLE bms_owner;", guard);
    expect(reset, "the pre-check must sit after a RESET ROLE").toBeGreaterThan(set);
    expect(migration).toContain("r.rolsuper OR r.rolbypassrls");
    expect(migration.indexOf("r.rolsuper OR r.rolbypassrls")).toBeLessThan(guard);
    expect(migration).toContain("holds a status outside the vocabulary");
  });

  it("backfills nothing: no UPDATE of work_orders (decisions 5a.4 and 6.7)", () => {
    expect(migrationSql()).not.toMatch(/UPDATE\s+bms\./i);
  });

  it("proves its own effect in a DO block", () => {
    const migration = migrationSql();
    expect(migration).toContain("c.relowner = 'bms_owner'::regrole");
    expect(migration).toContain("k.conname = 'work_orders_status_check' AND k.contype = 'c'");
    // Each of the six values is read back from the constraint, not only `cancelled`.
    expect(migration).toContain("FROM unnest(ARRAY['open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled']) AS v)");
    // The nine codes by name, not any nine rows.
    const proof = migration.slice(migration.lastIndexOf("DO $$"));
    for (const code of CAUSE_CODES) {
      expect(proof, code).toContain(`'${code}'`);
    }
    expect(proof).toContain("<> 9 THEN");
    // The thirteen nullable columns, the two vocabulary foreign keys, and the two roles that get nothing.
    expect(proof).toContain("AND NOT a.attisdropped AND NOT a.attnotnull");
    expect(proof).toContain("<> 13 THEN");
    expect(proof).toContain("(('cause_code', 'work_order_cause_codes'), ('alarm_skill_code', 'alarm_skills'))");
    expect(proof).toContain("has_table_privilege('bms_auth', 'bms.work_order_cause_codes', 'SELECT')");
    expect(proof).toContain("has_table_privilege('bms_rollup', 'bms.work_order_cause_codes', 'SELECT')");
  });

  it("declares the Drizzle table and columns", () => {
    const maintenance = read("packages/db/src/schema/maintenance-schema.ts");
    expect(maintenance).toMatch(/bmsSchema\.table\(\s*"work_order_cause_codes"/);
    for (const column of [
      'rootCause: text("root_cause")',
      'correctiveAction: text("corrective_action")',
      'preventiveAction: text("preventive_action")',
      'causeCode: varchar("cause_code", { length: 64 })',
      'alarmRootCause: text("alarm_root_cause")',
      'alarmCorrectiveActions: text("alarm_corrective_actions")',
      'alarmSkillCode: varchar("alarm_skill_code", { length: 64 })',
      'alarmEtrAt: timestamp("alarm_etr_at", { withTimezone: true })',
      'resolvedBy: uuid("resolved_by")',
      'approvedBy: uuid("approved_by")',
      'approvedAt: timestamp("approved_at", { withTimezone: true })',
      'cancelledBy: uuid("cancelled_by")',
      'cancelledAt: timestamp("cancelled_at", { withTimezone: true })',
    ]) {
      expect(maintenance, column).toContain(column);
    }
    // The links Drizzle's relational reads follow.
    expect(maintenance).toContain('causeCode: varchar("cause_code", { length: 64 }).references(() => workOrderCauseCodes.code)');
    expect(maintenance).toContain('alarmSkillCode: varchar("alarm_skill_code", { length: 64 }).references(() => alarmSkills.code)');
    for (const stamp of ["resolved_by", "approved_by", "cancelled_by"]) {
      expect(maintenance, stamp).toContain(`uuid("${stamp}").references(() => users.id)`);
    }
  });
});
