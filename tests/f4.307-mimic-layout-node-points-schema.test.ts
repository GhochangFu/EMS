import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0124_mimic_layout_node_points.sql";
const DRIZZLE_REL = "packages/db/src/schema/mimic-layouts-schema.ts";
const MIMIC_CONTRACT_REL = "packages/shared/src/contracts/mimic.ts";
const TAG = "0124_mimic_layout_node_points";
const TABLE = "mimic_layout_node_points";
const GUC = "nullif(current_setting('app.current_organization', true), '')::uuid";
const OWN_ORG = `organization_id = ${GUC}`;

/** Strip `--` comment lines before a scan (the f3.1a lesson): a raw scan is
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

/** The text of one named constraint, from its name to the next top-level `,\n` or `\n);`. */
const constraintText = (migration: string, name: string): string => {
  const start = migration.indexOf(`CONSTRAINT ${name} `);
  if (start < 0) throw new Error(`no constraint ${name}`);
  const ends = [migration.indexOf(",\n", start), migration.indexOf("\n);", start)].filter((i) => i >= 0);
  return migration.slice(start, Math.min(...ends));
};

/** `MIMIC_HEADLINE_POINTS`, read from the source text (never `@bms/shared`,
 * which resolves to `dist`: a source edit would not reach it). */
const headlinePointsFromSource = (): number => {
  const m = /export const MIMIC_HEADLINE_POINTS = (\d+);/.exec(read(MIMIC_CONTRACT_REL));
  if (!m) throw new Error("MIMIC_HEADLINE_POINTS not found");
  return Number(m[1]);
};

/**
 * `F4.307` / ADR 0081 Amendment 1 — the static half of migration `0124`
 * (`bms.mimic_layout_node_points`, plan §3 and C10). The live half is
 * `tests/f4.307-mimic-layout-node-points-schema.integration.test.ts`.
 * Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.307 — bms.mimic_layout_node_points (migration 0124)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.length).toBeGreaterThan(1500);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE} (`);
  });

  it("registers migration 0124 in the journal, after 0123 and not ahead of the clock", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0124 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(125);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0123's `when` — the F4.94 class: a stamp not above the last applied one is skipped.
    expect(entry?.when as number).toBeGreaterThan(1793660000000);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("brackets the DDL in exactly one SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/SET ROLE bms_owner;/g)).toHaveLength(1);
    expect(migration.match(/RESET ROLE;/g)).toHaveLength(1);
    expect(migration.indexOf("SET ROLE bms_owner;")).toBeLessThan(
      migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${TABLE} (`),
    );
    expect(migration.indexOf("RESET ROLE;")).toBeGreaterThan(migration.lastIndexOf("CREATE POLICY"));
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("drops then creates the tenant_isolation policy", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TABLE};`);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThan(migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`));
  });

  it("the policy checks its own organization_id in USING and WITH CHECK, with no NULL escape", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      const ownOnly = half.replaceAll(`n.${OWN_ORG}`, "");
      expect(ownOnly, `${name} must check the own organization_id`).toContain(OWN_ORG);
    }
    expect(policy).not.toMatch(/IS\s+NULL/i);
  });

  it("the policy carries the nodes leg, correlated, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the nodes leg`).toContain("EXISTS (SELECT 1 FROM bms.mimic_layout_nodes n");
      expect(half, `${name} nodes leg must correlate`).toContain(`n.id = ${TABLE}.node_id`);
      expect(half, `${name} nodes leg must pin the organization`).toContain(`n.${OWN_ORG}`);
    }
  });

  it("adds UNIQUE (id, kind) on the nodes, guarded, before the table that references it", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const add = migration.indexOf(
      "ADD CONSTRAINT mimic_layout_nodes_id_kind_key UNIQUE (id, kind)",
    );
    expect(add).toBeGreaterThanOrEqual(0);
    expect(migration).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE conname = 'mimic_layout_nodes_id_kind_key'/);
    expect(add).toBeLessThan(migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${TABLE} (`));
  });

  it("names every constraint the service and the integration suite refer to", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const name of [
      "mimic_layout_node_points_node_fkey",
      "mimic_layout_node_points_unit_check",
      "mimic_layout_node_points_ord_check",
      "mimic_layout_node_points_node_ord_key",
      "mimic_layout_node_points_node_key_key",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(`CONSTRAINT ${name} `);
    }
  });

  it("holds units only the pipes way: a composite (node_id, node_kind) FK that cascades, and a kind CHECK", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const fk = constraintText(migration, "mimic_layout_node_points_node_fkey");
    expect(fk).toContain("FOREIGN KEY (node_id, node_kind)");
    expect(fk).toContain("REFERENCES bms.mimic_layout_nodes (id, kind)");
    expect(fk).toContain("ON DELETE CASCADE");
    expect(constraintText(migration, "mimic_layout_node_points_unit_check")).toContain("CHECK (node_kind = 'unit')");
    expect(migration).toContain("node_kind varchar(16) NOT NULL DEFAULT 'unit'");
  });

  it("references bms.point_keys(code) with no ON DELETE (keys are deactivated, never deleted)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const line = migration.split("\n").find((l) => l.trim().startsWith("point_key "));
    expect(line, "the point_key column must be declared").toBeDefined();
    expect(line).toContain("varchar(128) NOT NULL REFERENCES bms.point_keys(code)");
    expect(line).not.toMatch(/ON DELETE/i);
  });

  it("the unique keys are (node_id, ord) and (node_id, point_key)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(constraintText(migration, "mimic_layout_node_points_node_ord_key")).toContain("UNIQUE (node_id, ord)");
    expect(constraintText(migration, "mimic_layout_node_points_node_key_key")).toContain("UNIQUE (node_id, point_key)");
  });

  it("_ord_check bounds ord at MIMIC_HEADLINE_POINTS - 1, from the shared source", () => {
    const bound = headlinePointsFromSource();
    // Positive control: the source parse found the ADR's bound.
    expect(bound).toBe(3);
    expect(constraintText(sqlOnly(read(MIGRATION_REL)), "mimic_layout_node_points_ord_check")).toContain(
      `CHECK (ord BETWEEN 0 AND ${bound - 1})`,
    );
  });

  it("proves its own effect after RESET ROLE: RLS forced, the pool privileges, the FKs and the ord CHECK", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const proof = migration.slice(migration.indexOf("RESET ROLE;"));
    expect(proof).toContain("DO $$");
    expect(proof).toContain("relforcerowsecurity");
    expect(proof).toContain(`has_table_privilege('bms_tenant', 'bms.${TABLE}', 'INSERT')`);
    expect(proof).toContain(`has_table_privilege('bms_fleet', 'bms.${TABLE}', 'SELECT')`);
    for (const name of [
      "mimic_layout_node_points_node_fkey",
      "mimic_layout_node_points_point_key_fkey",
      "mimic_layout_node_points_ord_check",
    ]) {
      expect(proof, `the proof must name ${name}`).toContain(`'${name}'`);
    }
    expect(proof.match(/RAISE EXCEPTION/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("declares the Drizzle table with the composite node FK", () => {
    const schema = read(DRIZZLE_REL);
    expect(schema).toContain(`export const mimicLayoutNodePoints = bmsSchema.table(\n  "${TABLE}"`);
    expect(schema).toContain(`name: "mimic_layout_node_points_node_fkey"`);
    expect(schema).toContain(`unique("mimic_layout_nodes_id_kind_key").on(t.id, t.kind)`);
  });
});
