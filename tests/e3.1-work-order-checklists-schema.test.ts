import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0145_work_order_checklists.sql";
const TAG = "0145_work_order_checklists";
const TEMPLATES = "work_order_checklist_templates";
const ITEMS = "work_order_checklist_template_items";
const TASKS = "work_order_tasks";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";
const TASK_RESULTS = ["pending", "done", "not_applicable"];

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migrationSql = (): string => sqlOnly(read(MIGRATION_REL));

/** The `CREATE POLICY tenant_isolation` statement of one table, split at WITH CHECK. */
const policyHalves = (migration: string, table: string): { policy: string; using: string; withCheck: string } => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  const policy = migration.slice(start, end + 1);
  const split = policy.indexOf("WITH CHECK");
  if (split < 0) throw new Error(`the policy on bms.${table} carries no WITH CHECK clause`);
  return { policy, using: policy.slice(0, split), withCheck: policy.slice(split) };
};

/** The text of the first `SET ROLE bms_owner … RESET ROLE` bracket. */
const firstBracket = (migration: string): string => {
  const start = migration.indexOf("SET ROLE bms_owner;");
  const end = migration.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("the migration has no SET ROLE bms_owner / RESET ROLE bracket");
  return migration.slice(start, end);
};

/**
 * `E3.1` / ADR 0122 decisions 4 and 9 — the static half of migration `0145` (migration C:
 * checklist templates, the checklist columns on `bms.work_order_tasks`, and that table's
 * policy re-created with the parent check, ruling P9).
 * `apps/api/src/work-orders/work-order-checklists.integration.spec.ts` asserts what
 * Postgres enforces. Assertions inline (section 4.6, top-level `tests/`).
 */
describe("E3.1 — work-order checklists (migration 0145)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = migrationSql();
    expect(migration.length).toBeGreaterThan(3000);
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(20);
  });

  it("registers migration 0145 in the journal, after 0144 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0145 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(146);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0144's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1794353417907);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets its DDL in SET ROLE bms_owner / RESET ROLE and issues no GRANT and no CONCURRENTLY", () => {
    const migration = migrationSql();
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it("creates both template tables inside the bracket", () => {
    const bracket = firstBracket(migrationSql());
    expect(bracket).toContain(`CREATE TABLE IF NOT EXISTS bms.${TEMPLATES} (`);
    expect(bracket).toContain(`CREATE TABLE IF NOT EXISTS bms.${ITEMS} (`);
  });

  it("a template is per organization, optionally per asset domain, and its name is unique in the organization", () => {
    const migration = migrationSql();
    const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${TEMPLATES} (`);
    const table = migration.slice(start, migration.indexOf(");\n", start));
    expect(table).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
    expect(table).toContain("name varchar(255) NOT NULL,");
    // Nullable on purpose: NULL means "fits every domain".
    expect(table).toContain("domain varchar(64) REFERENCES bms.asset_domains(code),");
    expect(table).toContain("active boolean NOT NULL DEFAULT true,");
    expect(migration).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_templates_organization_name_key\n  ON bms.${TEMPLATES}(organization_id, lower(name));`,
    );
  });

  it("an item carries its own organization and is tied to its template's by a composite foreign key", () => {
    const migration = migrationSql();
    const pair = migration.indexOf(
      `CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_templates_organization_id_id_key\n  ON bms.${TEMPLATES}(organization_id, id);`,
    );
    expect(pair, "the referenced pair needs a unique index").toBeGreaterThan(0);
    const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${ITEMS} (`);
    expect(pair).toBeLessThan(start);
    const table = migration.slice(start, migration.indexOf(");\n", start));
    expect(table).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
    expect(table).toContain(`template_id uuid NOT NULL REFERENCES bms.${TEMPLATES}(id),`);
    expect(table).toContain("title varchar(255) NOT NULL,");
    expect(table).toContain("mandatory boolean NOT NULL DEFAULT false,");
    expect(table).toContain("sort_order integer NOT NULL DEFAULT 0,");
    expect(table).toContain(
      `FOREIGN KEY (organization_id, template_id) REFERENCES bms.${TEMPLATES}(organization_id, id)`,
    );
  });

  it.each([TEMPLATES, ITEMS])("enables and forces row level security on bms.%s", (table) => {
    const migration = migrationSql();
    expect(migration).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
  });

  it("the templates policy checks the own organization in USING and WITH CHECK", () => {
    const { policy, using, withCheck } = policyHalves(migrationSql(), TEMPLATES);
    expect(using).toContain(OWN_ORG);
    expect(withCheck).toContain(OWN_ORG);
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("the items policy checks the own organization and the parent template, in USING and WITH CHECK", () => {
    const { policy, using, withCheck } = policyHalves(migrationSql(), ITEMS);
    for (const [half, text] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(text, `${half} must check the own organization_id`).toContain(OWN_ORG);
      expect(text, `${half} must read the parent template`).toContain(`EXISTS (SELECT 1 FROM bms.${TEMPLATES} t`);
      expect(text, `${half} must join the parent on the item's template_id`).toContain(
        `WHERE t.id = ${ITEMS}.template_id`,
      );
      expect(text, `${half} must check the parent's organization (0050 shape)`).toContain(`t.${OWN_ORG}`);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("gives work_order_tasks its five checklist columns", () => {
    const bracket = firstBracket(migrationSql());
    for (const column of [
      "ADD COLUMN IF NOT EXISTS mandatory boolean NOT NULL DEFAULT false",
      "ADD COLUMN IF NOT EXISTS result varchar(16) NOT NULL DEFAULT 'pending'",
      "ADD COLUMN IF NOT EXISTS note text",
      "ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES bms.users(id)",
      "ADD COLUMN IF NOT EXISTS template_item_id uuid;",
    ]) {
      expect(bracket, column).toContain(column);
    }
  });

  it("ties a task's template item to the task's organization, and clears only the pointer when the item goes", () => {
    // A template edit replaces its items (plan D7): the copied task must survive, with
    // its organization_id untouched.
    const migration = migrationSql();
    const pair = migration.indexOf(
      `CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_template_items_organization_id_id_key\n  ON bms.${ITEMS}(organization_id, id);`,
    );
    expect(pair, "the referenced pair needs a unique index").toBeGreaterThan(0);
    const key = `FOREIGN KEY (organization_id, template_item_id) REFERENCES bms.${ITEMS}(organization_id, id)\n  ON DELETE SET NULL (template_item_id);`;
    expect(migration).toContain(key);
    expect(pair).toBeLessThan(migration.indexOf(key));
    expect(migration, "never a whole-row SET NULL: organization_id is NOT NULL").not.toMatch(/ON DELETE SET NULL(?! \(template_item_id\))/);
    expect(migration).toContain("k.confdeltype = 'n' AND array_length(k.confdelsetcols, 1) = 1");
  });

  it("closes the task result vocabulary over the three ADR values, the same as the shared contract", () => {
    const migration = migrationSql();
    expect(migration).toContain(`ALTER TABLE bms.${TASKS} DROP CONSTRAINT IF EXISTS work_order_tasks_result_check;`);
    expect(migration).toContain(
      `ADD CONSTRAINT work_order_tasks_result_check CHECK (result IN (${TASK_RESULTS.map((v) => `'${v}'`).join(",")}));`,
    );
    const contract = read("packages/shared/src/contracts/work-orders.ts");
    const from = contract.indexOf("export const WORK_ORDER_TASK_RESULTS = [");
    expect(from, "the shared vocabulary must exist").toBeGreaterThan(0);
    const list = contract.slice(from, contract.indexOf("] as const;", from));
    expect([...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1])).toEqual(TASK_RESULTS);
  });

  it("re-creates the work_order_tasks policy with the parent work order checked on both sides (ruling P9)", () => {
    const migration = migrationSql();
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TASKS};`);
    expect(drop, "the 0047 policy must be dropped first").toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TASKS}\n`)).toBeGreaterThan(drop);
    const { policy, using, withCheck } = policyHalves(migration, TASKS);
    for (const [half, text] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(text, `${half} must check the own organization_id`).toContain(OWN_ORG);
      expect(text, `${half} must read the parent work order`).toContain("EXISTS (SELECT 1 FROM bms.work_orders w");
      expect(text, `${half} must join the parent on the task's work_order_id`).toContain(
        `WHERE w.id = ${TASKS}.work_order_id`,
      );
      expect(text, `${half} must check the parent's organization`).toContain(`w.${OWN_ORG}`);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("ties a task to its work order's organization with a composite foreign key, for every role", () => {
    // The policy does not bind bms_fleet (BYPASSRLS); the key does. The pair's unique
    // index is 0144's.
    expect(migrationSql()).toContain(
      "FOREIGN KEY (organization_id, work_order_id) REFERENCES bms.work_orders(organization_id, id);",
    );
  });

  it("lets a maintenance schedule name a checklist template of its own organization", () => {
    const migration = migrationSql();
    expect(migration).toContain(
      "ALTER TABLE bms.maintenance_task_templates\n  ADD COLUMN IF NOT EXISTS checklist_template_id uuid;",
    );
    expect(migration).toContain(
      `FOREIGN KEY (organization_id, checklist_template_id) REFERENCES bms.${TEMPLATES}(organization_id, id);`,
    );
    expect(migration, "the column stays nullable").not.toMatch(/checklist_template_id[^;]*NOT NULL/);
  });

  it("backfills result = 'done' AFTER the first RESET ROLE, as a role that bypasses row security", () => {
    // Under SET ROLE bms_owner, FORCE row security makes an UPDATE of a tenant table
    // match zero rows and raise nothing (AGENTS.md 4.4, plan D2).
    const migration = migrationSql();
    const reset = migration.indexOf("RESET ROLE;");
    const backfill = migration.indexOf(`UPDATE bms.${TASKS}`);
    expect(backfill, "the backfill must exist").toBeGreaterThan(0);
    expect(backfill, "the backfill must sit after the first RESET ROLE").toBeGreaterThan(reset);
    expect(migration.slice(reset, backfill), "no second bracket may open before the backfill").not.toContain("SET ROLE bms_owner;");
    expect(migration.slice(backfill, migration.indexOf(";", backfill))).toContain("SET result = 'done'");
    expect(firstBracket(migration)).not.toMatch(/UPDATE\s+bms\./i);
    expect(migration).toContain("r.rolsuper OR r.rolbypassrls");
    expect(migration.indexOf("r.rolsuper OR r.rolbypassrls")).toBeLessThan(backfill);
  });

  it("proves its own effect in a DO block: forced RLS, the three policies, each privilege on its own", () => {
    const migration = migrationSql();
    expect(migration).toContain("c.relforcerowsecurity");
    // The tasks policy is read back from pg_policies, both halves (ruling P9).
    expect(migration).toContain(
      "p.tablename = 'work_order_tasks' AND p.policyname = 'tenant_isolation'\n       AND p.qual LIKE '%work_orders%' AND p.with_check LIKE '%work_orders%'",
    );
    expect(migration).toContain(
      `p.tablename = '${ITEMS}' AND p.policyname = 'tenant_isolation'\n       AND p.qual LIKE '%${TEMPLATES}%' AND p.with_check LIKE '%${TEMPLATES}%'`,
    );
    expect(migration).toContain("FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP");
    expect(migration).not.toMatch(/has_table_privilege\([^)]*'[A-Z]+,\s*[A-Z]+/i);
    // Ownership is read from pg_class: 0039 grants the pool roles the same four on a
    // table bms_app creates, so the privileges alone do not prove the bracket.
    expect(migration).toContain("AND c.relowner = 'bms_owner'::regrole");
  });

  it("declares the Drizzle tables and columns", () => {
    const maintenance = read("packages/db/src/schema/maintenance-schema.ts");
    expect(maintenance).toMatch(/bmsSchema\.table\(\s*"work_order_checklist_templates"/);
    expect(maintenance).toMatch(/bmsSchema\.table\(\s*"work_order_checklist_template_items"/);
    for (const column of [
      'mandatory: boolean("mandatory").notNull().default(false)',
      'result: varchar("result", { length: 16 }).notNull().default("pending")',
      'note: text("note")',
      'completedBy: uuid("completed_by")',
      'templateItemId: uuid("template_item_id")',
      'checklistTemplateId: uuid("checklist_template_id")',
    ]) {
      expect(maintenance, column).toContain(column);
    }
  });
});
