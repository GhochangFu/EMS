import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0088_mimic_layouts.sql";
const CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const DRIZZLE_REL = "packages/db/src/schema/mimic-layouts-schema.ts";
const TAG = "0088_mimic_layouts";
const TABLES = ["mimic_layouts", "mimic_layout_nodes", "mimic_layout_pipes"] as const;
const GUC = "nullif(current_setting('app.current_organization', true), '')::uuid";
const OWN_ORG = `organization_id = ${GUC}`;

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a
 * comment quoting the statement it explains (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One table's `CREATE POLICY tenant_isolation` statement, split at `WITH CHECK`. */
const policyHalves = (
  migration: string,
  table: string,
): { policy: string; using: string; withCheck: string } => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  const policy = migration.slice(start, end + 1);
  const split = policy.indexOf("WITH CHECK");
  if (split < 0) throw new Error(`the ${table} policy carries no WITH CHECK clause`);
  return { policy, using: policy.slice(0, split), withCheck: policy.slice(split) };
};

/** The text of one named constraint, from its name to the next top-level `,\n` or `\n);`. */
const constraintText = (migration: string, name: string): string => {
  const start = migration.indexOf(`CONSTRAINT ${name} `);
  if (start < 0) throw new Error(`no constraint ${name}`);
  const ends = [migration.indexOf(",\n", start), migration.indexOf("\n);", start)].filter((i) => i >= 0);
  return migration.slice(start, Math.min(...ends));
};

/** The string members of one `z.enum([...])` export, read from the source text
 * (never `@bms/shared`, which resolves to `dist`: a source edit would not reach it). */
const enumMembersFromSource = (source: string, exportName: string): string[] => {
  const start = source.indexOf(`export const ${exportName} = z.enum([`);
  if (start < 0) throw new Error(`no z.enum export ${exportName}`);
  const end = source.indexOf("]);", start);
  return [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
};

/** One numeric literal of `MIMIC_LAYOUT_BOUNDS`, read from the source text. */
const boundFromSource = (source: string, path: "canvasW" | "canvasH" | "z", end: "min" | "max"): number => {
  const block = source.slice(source.indexOf("export const MIMIC_LAYOUT_BOUNDS = {"));
  const m = new RegExp(`${path}:\\s*\\{\\s*min:\\s*(\\d+),\\s*max:\\s*(\\d+)\\s*\\}`).exec(block);
  if (!m) throw new Error(`MIMIC_LAYOUT_BOUNDS.${path} not found`);
  return Number(end === "min" ? m[1] : m[2]);
};

/**
 * `F3.32c` — the static half of the mimic layout library's schema guarantees
 * (migration `0088`, ADR 0081 decision 1, plan U1). The live half is
 * `tests/f3.32c-mimic-layouts-schema.integration.test.ts`. Assertions inline,
 * no `.spec` sibling (§4.6).
 */
describe("F3.32c — bms.mimic_layouts, _nodes, _pipes schema (migration 0088)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(3000);
    for (const table of TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
    }
  });

  it("registers migration 0088 in the journal, after 0087 and not ahead of the clock", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0088 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(88);
    expect(entry?.breakpoints).toBe(true);
    // 0087's `when` — the F4.94 class: a stamp not above the last applied one is skipped.
    expect(entry?.when as number).toBeGreaterThan(1790579321837);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("brackets the migration in exactly one SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/SET ROLE bms_owner;/g)).toHaveLength(1);
    expect(migration.match(/RESET ROLE;/g)).toHaveLength(1);
    expect(migration.indexOf("SET ROLE bms_owner;")).toBeLessThan(
      migration.indexOf("CREATE TABLE IF NOT EXISTS bms.mimic_layouts ("),
    );
    expect(migration.lastIndexOf("RESET ROLE;")).toBeGreaterThan(
      migration.lastIndexOf("CREATE POLICY"),
    );
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  for (const table of TABLES) {
    it(`bms.${table} enables and forces row level security`, () => {
      const migration = sqlOnly(read(MIGRATION_REL));
      expect(migration).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
    });

    it(`bms.${table}'s policy checks its own organization_id in USING and WITH CHECK, with no NULL escape`, () => {
      const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)), table);
      for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
        // The legs spell the same comparison on an alias; remove those first so
        // only the row's own column can satisfy this.
        const ownOnly = half
          .replaceAll(`l.${OWN_ORG}`, "")
          .replaceAll(`fn.${OWN_ORG}`, "")
          .replaceAll(`tn.${OWN_ORG}`, "");
        expect(ownOnly, `${table} ${name} must check the own organization_id`).toContain(OWN_ORG);
      }
      expect(policy).not.toMatch(/IS\s+NULL/i);
    });
  }

  it("the nodes policy carries the layouts leg, correlated, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)), "mimic_layout_nodes");
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the layouts leg`).toContain("FROM bms.mimic_layouts l");
      expect(half, `${name} layouts leg must correlate`).toContain("l.id = mimic_layout_nodes.layout_id");
      expect(half, `${name} layouts leg must pin the organization`).toContain(`l.${OWN_ORG}`);
    }
  });

  it("the pipes policy carries the layouts leg, correlated, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)), "mimic_layout_pipes");
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the layouts leg`).toContain("FROM bms.mimic_layouts l");
      expect(half, `${name} layouts leg must correlate`).toContain("l.id = mimic_layout_pipes.layout_id");
      expect(half, `${name} layouts leg must pin the organization`).toContain(`l.${OWN_ORG}`);
    }
  });

  it("the pipes policy carries the from-node leg, correlated, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)), "mimic_layout_pipes");
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the from-node leg`).toContain("FROM bms.mimic_layout_nodes fn");
      expect(half, `${name} from-node leg must correlate`).toContain("fn.id = mimic_layout_pipes.from_node_id");
      expect(half, `${name} from-node leg must pin the organization`).toContain(`fn.${OWN_ORG}`);
    }
  });

  it("the pipes policy carries the to-node leg, correlated, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)), "mimic_layout_pipes");
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the to-node leg`).toContain("FROM bms.mimic_layout_nodes tn");
      expect(half, `${name} to-node leg must correlate`).toContain("tn.id = mimic_layout_pipes.to_node_id");
      expect(half, `${name} to-node leg must pin the organization`).toContain(`tn.${OWN_ORG}`);
    }
  });

  it("names every constraint the services and the integration suite refer to", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const name of [
      "mimic_layouts_organization_slug_key",
      "mimic_layouts_canvas_check",
      "mimic_layouts_version_check",
      "mimic_layout_nodes_layout_key_key",
      "mimic_layout_nodes_layout_id_kind_key",
      "mimic_layout_nodes_kind_check",
      "mimic_layout_nodes_symbol_check",
      "mimic_layout_nodes_tone_check",
      "mimic_layout_nodes_kind_fields_check",
      "mimic_layout_nodes_box_check",
      "mimic_layout_pipes_from_fkey",
      "mimic_layout_pipes_to_fkey",
      "mimic_layout_pipes_ends_are_units_check",
      "mimic_layout_pipes_not_self_check",
      "mimic_layout_pipes_layout_ends_key",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(`CONSTRAINT ${name} `);
    }
  });

  it("the pipe foreign keys are three-column, include the kind, and cascade", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const end of ["from", "to"] as const) {
      const fk = constraintText(migration, `mimic_layout_pipes_${end}_fkey`);
      expect(fk).toContain(`FOREIGN KEY (layout_id, ${end}_node_id, ${end}_kind)`);
      expect(fk).toContain("REFERENCES bms.mimic_layout_nodes (layout_id, id, kind)");
      expect(fk).toContain("ON DELETE CASCADE");
    }
    expect(constraintText(migration, "mimic_layout_pipes_ends_are_units_check")).toContain(
      "from_kind = 'unit' AND to_kind = 'unit'",
    );
  });

  it("_symbol_check lists the first twelve of mimicSymbolSchema's members, in order, from the shared source", () => {
    // 0088 is frozen at the twelve symbols of plan D12. ADR 0082 appends to the
    // enum and 0089 restates all of it (`tests/f3.32d-mimic-domain-symbols-and-roles.test.ts`),
    // so 0088's list is the enum's literal prefix, never the whole enum.
    const prefix = enumMembersFromSource(read(CONTRACT_REL), "mimicSymbolSchema").slice(0, 12);
    // Positive control: the source parse found at least the twelve symbols of plan D12.
    expect(prefix).toHaveLength(12);
    const check = constraintText(sqlOnly(read(MIGRATION_REL)), "mimic_layout_nodes_symbol_check");
    const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(prefix);
  });

  it("_tone_check and _kind_check list the shared enums' members, in order", () => {
    const contract = read(CONTRACT_REL);
    const migration = sqlOnly(read(MIGRATION_REL));
    const tones = [...constraintText(migration, "mimic_layout_nodes_tone_check").matchAll(/'([a-z_]+)'/g)];
    expect(tones.map((m) => m[1])).toEqual(enumMembersFromSource(contract, "mimicPanelToneSchema"));
    const kinds = [...constraintText(migration, "mimic_layout_nodes_kind_check").matchAll(/'([a-z_]+)'/g)];
    expect(kinds.map((m) => m[1])).toEqual(enumMembersFromSource(contract, "mimicLayoutNodeKindSchema"));
  });

  it("_canvas_check restates MIMIC_LAYOUT_BOUNDS.canvasW and .canvasH from the shared source", () => {
    const contract = read(CONTRACT_REL);
    const check = constraintText(sqlOnly(read(MIGRATION_REL)), "mimic_layouts_canvas_check");
    expect(check).toContain(
      `canvas_w BETWEEN ${boundFromSource(contract, "canvasW", "min")} AND ${boundFromSource(contract, "canvasW", "max")}`,
    );
    expect(check).toContain(
      `canvas_h BETWEEN ${boundFromSource(contract, "canvasH", "min")} AND ${boundFromSource(contract, "canvasH", "max")}`,
    );
  });

  it("_box_check restates the canvas maxima and MIMIC_LAYOUT_BOUNDS.z from the shared source", () => {
    const contract = read(CONTRACT_REL);
    const check = constraintText(sqlOnly(read(MIGRATION_REL)), "mimic_layout_nodes_box_check");
    expect(check).toContain(`x + w <= ${boundFromSource(contract, "canvasW", "max")}`);
    expect(check).toContain(`y + h <= ${boundFromSource(contract, "canvasH", "max")}`);
    expect(check).toContain(
      `z BETWEEN ${boundFromSource(contract, "z", "min")} AND ${boundFromSource(contract, "z", "max")}`,
    );
    expect(check).toContain("x >= 0 AND y >= 0 AND w >= 1 AND h >= 1");
  });

  it("declares the three Drizzle tables and exports them from the schema index", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./mimic-layouts-schema";');
    const schema = read(DRIZZLE_REL);
    for (const table of TABLES) {
      expect(schema).toContain(`bmsSchema.table(\n  "${table}"`);
    }
  });
});
