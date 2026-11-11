import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0144_work_order_events.sql";
const TAG = "0144_work_order_events";
const TABLE = "work_order_events";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";
const EVENT_TYPES = [
  "created",
  "assigned",
  "status_changed",
  "task_updated",
  "root_cause_set",
  "resolved",
  "approved",
  "rejected",
  "cancelled",
  "sla_changed",
];

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migrationSql = (): string => sqlOnly(read(MIGRATION_REL));

/** The `CREATE POLICY tenant_isolation` statement, split at WITH CHECK. */
const policyHalves = (migration: string): { policy: string; using: string; withCheck: string } => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${TABLE}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${TABLE}`);
  const policy = migration.slice(start, end + 1);
  const split = policy.indexOf("WITH CHECK");
  if (split < 0) throw new Error("the policy carries no WITH CHECK clause");
  return { policy, using: policy.slice(0, split), withCheck: policy.slice(split) };
};

/**
 * `E3.1` / ADR 0122 decisions 7 and 9 — the static half of migration `0144`
 * (`bms.work_order_events`, the append-only timeline of a work order).
 * `apps/api/src/work-orders/work-order-events.integration.spec.ts` asserts what Postgres
 * enforces. Assertions inline (section 4.6, top-level `tests/`).
 */
describe("E3.1 — bms.work_order_events (migration 0144)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = migrationSql();
    expect(migration.length).toBeGreaterThan(1500);
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(8);
  });

  it("registers migration 0144 in the journal, after 0143 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0144 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(145);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0143's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1794341765073);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = migrationSql();
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });

  it("saves the actor's name and has no email or subject column", () => {
    const migration = migrationSql();
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
    expect(migration).toContain("actor_name varchar(255),");
    expect(migration).toContain("actor_id uuid REFERENCES bms.users(id),");
    expect(migration).not.toMatch(/actor_email|oidc_subject|\bsubject\b|\bemail\b/i);
  });

  it("references its work order with no ON DELETE clause", () => {
    const migration = migrationSql();
    expect(migration).toContain("work_order_id uuid NOT NULL REFERENCES bms.work_orders(id),");
    expect(migration).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
    expect(migration).not.toMatch(/ON DELETE/i);
  });

  it("ties an event to its work order's organization with a composite foreign key, for every role", () => {
    // The policy does not bind bms_fleet (BYPASSRLS); the key does.
    const migration = migrationSql();
    const index = migration.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_id_id_key\n  ON bms.work_orders(organization_id, id);",
    );
    expect(index, "the referenced pair needs a unique index").toBeGreaterThan(0);
    expect(index).toBeLessThan(migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`));
    expect(migration).toContain(
      "FOREIGN KEY (organization_id, work_order_id) REFERENCES bms.work_orders(organization_id, id),",
    );
    expect(migration).toContain("k.conname = 'work_order_events_work_order_organization_fkey'");
  });

  it("closes the event_type vocabulary over the ten ADR values", () => {
    const migration = migrationSql();
    expect(migration).toContain(`CHECK (event_type IN (${EVENT_TYPES.map((value) => `'${value}'`).join(",")}))`);
    // The same list as the shared contract, so the two cannot drift.
    const contract = read("packages/shared/src/contracts/work-orders.ts");
    const list = contract.slice(contract.indexOf("export const WORK_ORDER_EVENT_TYPES = ["), contract.indexOf("] as const;", contract.indexOf("export const WORK_ORDER_EVENT_TYPES = [")));
    expect([...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1])).toEqual(EVENT_TYPES);
  });

  it("enables and forces row level security", () => {
    const migration = migrationSql();
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("the policy checks the own organization and the parent work order, in USING and WITH CHECK", () => {
    const migration = migrationSql();
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TABLE};`);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`)).toBeGreaterThan(drop);
    const { policy, using, withCheck } = policyHalves(migration);
    for (const [half, text] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(text, `${half} must check the own organization_id`).toContain(OWN_ORG);
      expect(text, `${half} must read the parent work order`).toContain("EXISTS (SELECT 1 FROM bms.work_orders w");
      expect(text, `${half} must join the parent on the event's work_order_id`).toContain(
        `WHERE w.id = ${TABLE}.work_order_id`,
      );
      expect(text, `${half} must check the parent's organization (0050 shape)`).toContain(`w.${OWN_ORG}`);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("is append-only by privilege: UPDATE and DELETE are revoked from both pool roles, inside the bracket", () => {
    const migration = migrationSql();
    const revoke = migration.indexOf(`REVOKE UPDATE, DELETE ON bms.${TABLE} FROM bms_tenant, bms_fleet;`);
    expect(revoke, "the REVOKE must exist").toBeGreaterThan(0);
    expect(revoke).toBeGreaterThan(migration.indexOf("SET ROLE bms_owner;"));
    expect(revoke).toBeLessThan(migration.indexOf("RESET ROLE;"));
  });

  it("proves each privilege on its own for both pool roles in a DO block", () => {
    const migration = migrationSql();
    expect(migration).toContain("DO $$");
    expect(migration).toContain("c.relforcerowsecurity");
    expect(migration).toContain("FOREACH pool_role IN ARRAY ARRAY['bms_tenant', 'bms_fleet'] LOOP");
    for (const allowed of ["SELECT", "INSERT"]) {
      expect(migration).toContain(`IF NOT has_table_privilege(pool_role, 'bms.${TABLE}', '${allowed}') THEN`);
    }
    for (const denied of ["UPDATE", "DELETE"]) {
      expect(migration).toContain(`IF has_table_privilege(pool_role, 'bms.${TABLE}', '${denied}') THEN`);
    }
    expect(migration).not.toMatch(/has_table_privilege\([^)]*'[A-Z]+,\s*[A-Z]+/);
  });

  it("stamps each event with the wall clock, so two events of one transaction keep their order", () => {
    const migration = migrationSql();
    expect(migration).toContain("created_at timestamptz NOT NULL DEFAULT clock_timestamp(),");
    expect(migration).not.toContain("created_at timestamptz NOT NULL DEFAULT now()");
    expect(read("packages/db/src/schema/maintenance-schema.ts")).toContain("default(sql`clock_timestamp()`)");
  });

  it("indexes the timeline read", () => {
    expect(migrationSql()).toContain(
      `CREATE INDEX IF NOT EXISTS work_order_events_work_order_created_idx\n  ON bms.${TABLE}(work_order_id, created_at);`,
    );
  });

  it("invents no history: no event is inserted for an existing ticket (ruling P10)", () => {
    expect(migrationSql()).not.toMatch(/INSERT\s+INTO\s+bms\.work_order_events/i);
  });

  it("declares the Drizzle table", () => {
    const maintenance = read("packages/db/src/schema/maintenance-schema.ts");
    expect(maintenance).toMatch(/bmsSchema\.table\(\s*"work_order_events"/);
    expect(maintenance).toContain('actorName: varchar("actor_name", { length: 255 })');
  });
});
