import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0141_edge_gateways.sql";
const TAG = "0141_edge_gateways";
const TABLE = "edge_gateways";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/**
 * Every name the migration creates, and the table it lives on. The integration
 * twin matches Postgres's error text against the same strings, so a rename here
 * without the migration (or the reverse) reddens both files.
 */
const CONSTRAINTS = {
  edge_gateways_organization_id_fkey: "edge_gateways",
  edge_gateways_location_id_organization_id_fkey: "edge_gateways",
  edge_gateways_organization_id_code_key: "edge_gateways",
  edge_gateways_id_organization_id_key: "edge_gateways",
  edge_gateways_status_check: "edge_gateways",
  edge_gateways_clock_state_check: "edge_gateways",
  edge_gateways_token_hash_check: "edge_gateways",
  edge_gateways_backfill_window_check: "edge_gateways",
  rtus_edge_gateway_id_organization_id_fkey: "rtus",
} as const;
const INDEXES = ["edge_gateways_token_hash_key", "rtus_edge_gateway_id_idx"] as const;

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `CREATE POLICY tenant_isolation` statement for the table, split at WITH CHECK. */
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

/** The SQL between the first `SET ROLE bms_owner;` and the `RESET ROLE;` after it. */
const ownerBracket = (migration: string): string => {
  const start = migration.indexOf("SET ROLE bms_owner;");
  const end = migration.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return migration.slice(start, end);
};

/** The SQL after `RESET ROLE;` — the proof block. */
const proofBlock = (migration: string): string => {
  const end = migration.indexOf("RESET ROLE;");
  if (end < 0) throw new Error("no RESET ROLE");
  return migration.slice(end);
};

/**
 * `E7.2` / ADR 0123 decisions 5 and 6, plan builder call C8 — the static half of
 * migration `0141` (`bms.edge_gateways`, `bms.rtus.edge_gateway_id`).
 * `tests/e7.2-edge-gateways-schema.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("E7.2 — bms.edge_gateways (migration 0141)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.length).toBeGreaterThan(1500);
    // Anti-vacuity: the table, two FK guards, two indexes, RLS, policy, proof.
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(10);
  });

  it("is the only migration numbered 0141", () => {
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0141_"));
    expect(files).toEqual(["0141_edge_gateways.sql"]);
  });

  it("registers migration 0141 in the journal at idx 142, after 0140 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === "0140_work_order_reference_sla");

    expect(entry, "migration 0141 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(previous, "0140's journal entry is the bound").toBeDefined();
    expect(entry?.idx).toBe(142);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // The F4.94 class: strictly after 0140, never ahead of the clock.
    expect(entry?.when as number).toBeGreaterThan(previous?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
    // Found by position relative to 0140, not by `entries.at(-1)`: 0142 follows it.
    expect(journal.entries.indexOf(entry as Record<string, unknown>)).toBe(
      journal.entries.indexOf(previous as Record<string, unknown>) + 1,
    );
  });

  it("brackets the DDL in exactly one SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(migration.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    expect(migration.indexOf("SET ROLE bms_owner;")).toBeLessThan(migration.indexOf("RESET ROLE;"));
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bCREATE ROLE\b/i);
    // Every DDL statement is inside the bracket: created as bms_app the table
    // would reach no pool role (0041's default privileges are FOR ROLE bms_owner).
    expect(proofBlock(migration)).not.toMatch(/\b(CREATE|ALTER) (TABLE|INDEX|POLICY|UNIQUE INDEX)\b/);
  });

  it("creates the table idempotently and enables and forces row level security", () => {
    const owner = ownerBracket(sqlOnly(read(MIGRATION_REL)));
    expect(owner).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE} (`);
    expect(owner).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(owner).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
    expect(owner).toContain("ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS edge_gateway_id uuid;");
  });

  it("drops then creates the tenant_isolation policy", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TABLE};`);
    const create = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("the policy checks the own organization_id in USING and WITH CHECK, with no NULL disjunct", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    expect(using, "USING must check the own organization_id").toContain(OWN_ORG);
    expect(withCheck, "WITH CHECK must check the own organization_id").toContain(OWN_ORG);
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
    expect(policy).not.toMatch(/\bOR\b/i);
  });

  it("organization_id is NOT NULL and references bms.organizations", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
  });

  it("holds the location and the RTU to the gateway's organization with composite keys (C8)", () => {
    const migration = sqlOnly(read(MIGRATION_REL)).replace(/\s+/g, " ");
    expect(migration).toContain(
      "CONSTRAINT edge_gateways_location_id_organization_id_fkey FOREIGN KEY (location_id, organization_id) " +
        "REFERENCES bms.locations (id, organization_id)",
    );
    expect(migration).toContain("CONSTRAINT edge_gateways_id_organization_id_key UNIQUE (id, organization_id)");
    expect(migration).toContain("CONSTRAINT edge_gateways_organization_id_code_key UNIQUE (organization_id, code)");
    expect(migration).toContain(
      "ADD CONSTRAINT rtus_edge_gateway_id_organization_id_fkey FOREIGN KEY (edge_gateway_id, organization_id) " +
        "REFERENCES bms.edge_gateways (id, organization_id)",
    );
    // The composite replaces the sketch's single-column keys: a bare
    // `REFERENCES bms.edge_gateways (id)` would let an RTU sit on another
    // organization's gateway, because the referential check runs with RLS off.
    expect(migration).not.toMatch(/edge_gateway_id uuid REFERENCES/);
    expect(migration).not.toMatch(/location_id uuid REFERENCES/);
  });

  it("closes the status and clock vocabularies, the hash length and the dirty window with CHECKs", () => {
    const migration = sqlOnly(read(MIGRATION_REL)).replace(/\s+/g, " ");
    expect(migration).toContain("CONSTRAINT edge_gateways_status_check CHECK (status IN ('active','revoked'))");
    expect(migration).toContain(
      "CONSTRAINT edge_gateways_clock_state_check CHECK (clock_state IS NULL OR clock_state IN ('synced','unsynced'))",
    );
    expect(migration).toContain(
      "CONSTRAINT edge_gateways_token_hash_check CHECK (token_hash IS NULL OR octet_length(token_hash) = 32)",
    );
    expect(migration).toContain(
      "CONSTRAINT edge_gateways_backfill_window_check CHECK ( (backfill_dirty_from IS NULL) = (backfill_dirty_to IS NULL) " +
        "AND (backfill_dirty_from IS NULL OR backfill_dirty_from <= backfill_dirty_to) )",
    );
  });

  it("indexes the token hash (unique, partial) and rtus.edge_gateway_id", () => {
    const migration = sqlOnly(read(MIGRATION_REL)).replace(/\s+/g, " ");
    expect(migration).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS edge_gateways_token_hash_key ON bms.${TABLE} (token_hash) WHERE token_hash IS NOT NULL;`,
    );
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS rtus_edge_gateway_id_idx ON bms.rtus (edge_gateway_id);");
  });

  it("guards each ADD CONSTRAINT behind a pg_constraint probe (re-runnable)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const adds = migration.match(/ADD CONSTRAINT (\w+)/g) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    for (const add of adds) {
      const name = add.replace("ADD CONSTRAINT ", "");
      expect(migration, `${name} must be guarded`).toContain(`WHERE conname = '${name}'`);
    }
  });

  it("creates no name an earlier migration already uses", () => {
    const dir = join(repoRoot, "packages/db/drizzle");
    // Earlier files only: a later one (0142's proof) may name 0141's constraints.
    const others = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f < "0141_")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const name of [...Object.keys(CONSTRAINTS), ...INDEXES]) {
      expect(others.includes(name), `${name} is already used by another migration`).toBe(false);
    }
  });

  it("proves RLS, the pool privileges, bms_rollup membership and every name in a DO block after RESET ROLE", () => {
    const proof = proofBlock(sqlOnly(read(MIGRATION_REL)));
    expect(proof).toContain("DO $$");
    expect(proof).toContain("c.relrowsecurity");
    expect(proof).toContain("c.relforcerowsecurity");
    // T2.0's two measurements, asserted where CI runs them: the "no GRANT, no
    // role" claim of ADR 0123 rests on both.
    expect(proof).toContain(`has_table_privilege('bms_fleet', 'bms.${TABLE}', 'UPDATE')`);
    expect(proof).toContain(`has_table_privilege('bms_fleet', 'bms.${TABLE}', 'SELECT')`);
    expect(proof).toContain(`has_table_privilege('bms_tenant', 'bms.${TABLE}', 'SELECT')`);
    expect(proof).toContain("pg_has_role('bms_fleet', 'bms_rollup', 'SET')");
    for (const [name, table] of Object.entries(CONSTRAINTS)) {
      expect(proof, `the proof must name ${name}`).toContain(`'${name}'`);
      expect(proof).toContain(`'bms.${table}'::regclass`);
    }
    for (const name of INDEXES) {
      expect(proof, `the proof must name ${name}`).toContain(`'${name}'`);
    }
    expect(proof).toContain("i.indisunique");
    expect(proof).toContain("i.indpred IS NOT NULL");
  });
  it("declares the Drizzle table, exports it, and adds edgeGatewayId to rtus without .references() (C9)", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./edge-gateways-schema";');
    const schema = read("packages/db/src/schema/edge-gateways-schema.ts");
    expect(schema).toContain(`bmsSchema.table("${TABLE}"`);
    for (const column of [
      "organization_id",
      "location_id",
      "code",
      "name",
      "status",
      "token_hash",
      "token_last4",
      "token_rotated_at",
      "last_seen_at",
      "reported_backlog",
      "clock_state",
      "backfill_dirty_from",
      "backfill_dirty_to",
      "created_at",
      "updated_at",
    ]) {
      expect(schema, `the Drizzle table must declare ${column}`).toContain(`("${column}"`);
    }
    const bms = read("packages/db/src/schema/bms-schema.ts");
    const rtus = bms.slice(bms.indexOf('bmsSchema.table("rtus"'));
    // The whole declaration ends at `),` on its own line, so no chained
    // `.references()` can follow it (SQL-only FK, or a circular import).
    expect(rtus.slice(0, rtus.indexOf("});"))).toMatch(/^\s*edgeGatewayId: uuid\("edge_gateway_id"\),$/m);
  });
});

const MIGRATION_0142_REL = "packages/db/drizzle/0142_edge_gateways_tenant_read_only.sql";
const TAG_0142 = "0142_edge_gateways_tenant_read_only";

/**
 * `E7.2` / ADR 0123 decision 12, PR 2 security review L1 — migration `0142`
 * narrows 0041's default on `bms.edge_gateways` so the tenant pool reads and
 * never writes (0141 is committed, so the fix is forward-only). The
 * integration twin proves Postgres refuses the writes with 42501.
 */
describe("E7.2 — bms.edge_gateways is read-only on the tenant pool (migration 0142)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_0142_REL)), `${MIGRATION_0142_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_0142_REL)).length).toBeGreaterThan(800);
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0142_"));
    expect(files).toEqual(["0142_edge_gateways_tenant_read_only.sql"]);
  });

  it("registers migration 0142 in the journal at idx 143, right after 0141 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG_0142);
    const previous = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0142 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(143);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(previous?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
    expect(journal.entries.indexOf(entry as Record<string, unknown>)).toBe(
      journal.entries.indexOf(previous as Record<string, unknown>) + 1,
    );
  });

  it("brackets the REVOKE in exactly one SET ROLE bms_owner / RESET ROLE; neither file issues a GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_0142_REL));
    expect(migration.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(migration.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    // Inside the bracket: only the grantor of 0041's default can revoke it (0059).
    expect(ownerBracket(migration).trim()).toBe(
      "SET ROLE bms_owner;\n\nREVOKE INSERT, UPDATE, DELETE ON bms.edge_gateways FROM bms_tenant;",
    );
    expect(migration.match(/^\s*REVOKE\b/gm) ?? []).toHaveLength(1);
    expect(migration).not.toMatch(/REVOKE[^;]*SELECT/);
    for (const rel of [MIGRATION_REL, MIGRATION_0142_REL]) {
      expect(sqlOnly(read(rel)), `${rel} must issue no GRANT`).not.toMatch(/\bGRANT\b/i);
    }
  });

  it("proves the tenant pool lost INSERT, UPDATE and DELETE and kept SELECT, and bms_fleet kept SELECT and UPDATE", () => {
    const proof = proofBlock(sqlOnly(read(MIGRATION_0142_REL))).replace(/\s+/g, " ");
    expect(proof).toContain("DO $$");
    for (const verb of ["INSERT", "UPDATE", "DELETE"]) {
      const check = `has_table_privilege('bms_tenant', 'bms.${TABLE}', '${verb}')`;
      expect(proof, `the proof must test bms_tenant ${verb}`).toContain(check);
      // Raised when HELD: `IF NOT has_table_privilege` would assert the opposite.
      expect(proof, `${verb} must be asserted absent`).not.toContain(`NOT ${check}`);
    }
    expect(proof).toContain(`IF NOT has_table_privilege('bms_tenant', 'bms.${TABLE}', 'SELECT')`);
    expect(proof).toContain(`IF NOT has_table_privilege('bms_fleet', 'bms.${TABLE}', 'SELECT')`);
    expect(proof).toContain(`OR NOT has_table_privilege('bms_fleet', 'bms.${TABLE}', 'UPDATE')`);
  });

  it("proves the tenant_isolation policy has both halves and both composite FKs are NO ACTION both ways (0113 idiom)", () => {
    const proof = proofBlock(sqlOnly(read(MIGRATION_0142_REL))).replace(/\s+/g, " ");
    expect(proof).toContain(
      `FROM pg_policies WHERE schemaname = 'bms' AND tablename = '${TABLE}' AND policyname = 'tenant_isolation' ` +
        "AND qual IS NOT NULL AND with_check IS NOT NULL",
    );
    expect(proof).toContain(
      "ARRAY['edge_gateways_location_id_organization_id_fkey', 'bms.edge_gateways'], " +
        "ARRAY['rtus_edge_gateway_id_organization_id_fkey', 'bms.rtus'] ] LOOP",
    );
    expect(proof).toContain("AND contype = 'f' AND confdeltype = 'a' AND confupdtype = 'a'");
  });
});
