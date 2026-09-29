import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const exists = (rel: string): boolean => existsSync(join(repoRoot, rel));

const MIGRATION_0086 = "packages/db/drizzle/0086_dashboard_widget_mimic_type.sql";
const MIGRATION_0087 = "packages/db/drizzle/0087_asset_roles_water_train.sql";
const MIGRATION_0055 = "packages/db/drizzle/0055_dashboard_widget_table_type.sql";
const MIGRATION_0050 = "packages/db/drizzle/0050_configurable_dashboard_tables.sql";
const MIGRATION_0051 = "packages/db/drizzle/0051_asset_role_vocabulary.sql";
const MIGRATION_0060 = "packages/db/drizzle/0060_asset_role_estate_shapes.sql";
const MIGRATION_0089 = "packages/db/drizzle/0089_mimic_domain_symbols_and_roles.sql";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONSTRAINT = "dashboard_widgets_widget_type_check";
const MIMIC_NODES_SERVICE_REL = "apps/api/src/dashboard-builder/mimic-nodes.service.ts";
const CONTROLLER_REL = "apps/api/src/dashboard-builder/dashboard-builder.controller.ts";
const SEED_REL = "packages/db/src/seed.ts";

/**
 * The widget types as the contract declares them, parsed from source rather
 * than imported — the `tests/f3.35-table-widget-schema.test.ts` technique,
 * for the same reason: this file runs in the root `repo` Vitest project, and
 * a source scan states plainly this is a cross-file drift gate.
 */
const widgetTypes = (): string[] => {
  const block = /export const widgetTypeSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
    read(CONTRACT_REL),
  );
  if (block === null) {
    throw new Error(
      `could not find widgetTypeSchema's z.enum([...]) in ${CONTRACT_REL}. If it was renamed ` +
        "or reshaped, fix this parser — do not delete the assertion.",
    );
  }
  const types = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (types.length === 0) throw new Error("widgetTypeSchema parsed to an empty list");
  return types;
};

/** The values inside a named CHECK's `IN (...)` list, in the given migration. */
const checkedValues = (migrationRel: string): string[] => {
  const sql = read(migrationRel);
  const match = new RegExp(
    `CONSTRAINT ${CONSTRAINT}\\s+CHECK \\(widget_type IN \\(([^)]*)\\)\\)`,
  ).exec(sql);
  if (match === null) {
    throw new Error(
      `could not read ${CONSTRAINT}'s IN list from ${migrationRel} — fix this parser rather ` +
        "than the assertion.",
    );
  }
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
};

/**
 * Codes named inside `INSERT INTO bms.asset_roles ... ON CONFLICT DO NOTHING` blocks, by
 * `('code',`. Bounded to those blocks: `0089` also holds a CHECK list `IN ('tank', ...`, and an
 * unbounded scan would count `tank` as a seeded role code.
 */
const insertedRoleCodes = (migrationRel: string): string[] => {
  const sql = read(migrationRel);
  const blocks = [...sql.matchAll(/INSERT INTO bms\.asset_roles[\s\S]*?ON CONFLICT DO NOTHING/g)].map((m) => m[0]);
  return blocks.flatMap((block) => [...block.matchAll(/\(\s*'([a-z0-9_-]+)'\s*,/g)].map((m) => m[1]!));
};

describe("F3.32 v1 — migration 0086 widens the widget-type CHECK", () => {
  it("has a migration and a journal entry ordered strictly after 0085's `when`", () => {
    expect(exists(MIGRATION_0086), `${MIGRATION_0086} must exist`).toBe(true);
    expect(exists(MIGRATION_0087), `${MIGRATION_0087} must exist`).toBe(true);

    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const e86 = journal.entries.find((row) => row.tag === "0086_dashboard_widget_mimic_type");
    const e87 = journal.entries.find((row) => row.tag === "0087_asset_roles_water_train");
    const e85 = journal.entries.find((row) => row.tag === "0085_location_types");
    expect(e86, "0086 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(e87, "0087 must have a journal entry, or drizzle silently skips the file").toBeDefined();
    expect(e85, "0085's entry must exist for this comparison to mean anything").toBeDefined();

    expect((e86?.when ?? 0) > (e85?.when ?? 0), "0086's `when` must be greater than 0085's").toBe(
      true,
    );
    expect((e87?.when ?? 0) > (e86?.when ?? 0), "0087's `when` must be greater than 0086's").toBe(
      true,
    );
    expect((e86?.when ?? 0) <= Date.now(), "0086's `when` must not be ahead of the clock").toBe(
      true,
    );
    expect((e87?.when ?? 0) <= Date.now(), "0087's `when` must not be ahead of the clock").toBe(
      true,
    );

    const whens = journal.entries.map((row) => row.when);
    expect(
      whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value),
      "journal `when` values must be strictly increasing",
    ).toBe(true);
  });

  it("widens the CHECK to exactly the contract's widget vocabulary", () => {
    // This file's job is only to state that the migration's CHECK and the shared contract's
    // `widgetTypeSchema` must agree — a drift gate, not a use of either value.
    const listed = checkedValues(MIGRATION_0086);
    const declared = widgetTypes();

    expect(listed.length, "the parsed CHECK list must not be empty").toBeGreaterThan(0);
    expect([...listed].sort()).toEqual([...declared].sort());
    expect(listed, "`mimic` is the value this migration exists to admit").toContain("mimic");
  });

  it("drops the old constraint before adding the new one, or the widening is a silent no-op", () => {
    const sql = read(MIGRATION_0086);
    const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    const addAt = sql.indexOf(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(dropAt, "the migration must DROP the existing constraint").toBeGreaterThan(-1);
    expect(addAt, "the migration must ADD the widened constraint").toBeGreaterThan(-1);
    expect(dropAt, "the DROP must come before the ADD").toBeLessThan(addAt);
    expect(
      /ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql),
      "an IF NOT EXISTS guard here would skip the widening",
    ).toBe(false);
  });

  it("leaves migrations 0055 (five types) and 0050 (four types) frozen", () => {
    const frozen55 = checkedValues(MIGRATION_0055);
    expect(frozen55.sort()).toEqual(["chart", "radial_gauge", "table", "tank_level", "value_tile"]);
    expect(frozen55, "0055 is frozen; `mimic` belongs in 0086").not.toContain("mimic");

    const frozen50 = checkedValues(MIGRATION_0050);
    expect(frozen50.sort()).toEqual(["chart", "radial_gauge", "tank_level", "value_tile"]);
    expect(frozen50, "0050 is frozen; `mimic` belongs in 0086").not.toContain("mimic");
  });
});

describe("F3.32 v1 — migration 0087 seeds the seven `water_train` role codes", () => {
  const EXPECTED_CODES = ["water_intake", "wtp", "ro", "softener", "water_storage", "stp", "etp"];

  it("inserts exactly the seven codes inside a SET ROLE bms_owner / RESET ROLE bracket", () => {
    const sql = read(MIGRATION_0087);
    const setAt = sql.indexOf("SET ROLE bms_owner;");
    const insertAt = sql.indexOf("INSERT INTO bms.asset_roles");
    const resetAt = sql.lastIndexOf("RESET ROLE;");
    expect(setAt, "must SET ROLE bms_owner").toBeGreaterThan(-1);
    expect(insertAt, "must INSERT into bms.asset_roles").toBeGreaterThan(-1);
    expect(resetAt, "must RESET ROLE").toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(resetAt);

    const codes = insertedRoleCodes(MIGRATION_0087);
    expect([...codes].sort()).toEqual([...EXPECTED_CODES].sort());
    expect(codes.length, "exactly seven codes, no eighth for cooling tower (reuses `utilities`)").toBe(7);
  });

  it("has a DO $$ self-check per code, so a silent ON CONFLICT DO NOTHING cannot pass as success", () => {
    const sql = read(MIGRATION_0087);
    expect(/DO \$\$/.test(sql), "must self-check like 0059/0060").toBe(true);
    for (const code of EXPECTED_CODES) {
      expect(
        sql.includes(`code = '${code}' AND active = true`),
        `must self-check code '${code}'`,
      ).toBe(true);
    }
  });

  it("every preset roleCode used by water_train is in 0087's insert or 0051/0060's seed (mutation: `wtp2`)", () => {
    // `MIMIC_PRESETS` is U0's export (`packages/shared/src/mimic-presets.ts`).
    // This is read as text rather than imported for the same reason the
    // widget-type parser above is: a cross-package source scan states plainly
    // this is a drift gate against a sibling unit's file, not a use of the
    // value, and it must fail loudly rather than silently pass an empty list
    // if the export is renamed.
    const presetsRel = "packages/shared/src/mimic-presets.ts";
    if (!exists(presetsRel)) {
      throw new Error(`${presetsRel} does not exist — this repository's own layout changed.`);
    }
    const presetSrc = read(presetsRel);
    const roleCodeMatches = [...presetSrc.matchAll(/roleCode:\s*"([a-z0-9_-]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(roleCodeMatches.length, "must find at least one roleCode in the preset source").toBeGreaterThan(0);

    const seededHere = insertedRoleCodes(MIGRATION_0087);
    const seeded0051 = insertedRoleCodes(MIGRATION_0051);
    const seeded0060 = insertedRoleCodes(MIGRATION_0060);
    // ADR 0082 decision 4: 0089 inserts the eighteen role codes the six new presets name.
    const seeded0089 = insertedRoleCodes(MIGRATION_0089);
    const known = new Set([...seededHere, ...seeded0051, ...seeded0060, ...seeded0089]);

    for (const roleCode of roleCodeMatches) {
      expect(known.has(roleCode), `preset roleCode '${roleCode}' must be seeded somewhere`).toBe(
        true,
      );
    }
  });
});

describe("F3.32 v1 — seed.ts calls seedWaterMimicDemo after seedWaterPlantDemo", () => {
  it("calls seedWaterMimicDemo( after seedWaterPlantDemo( in seed.ts", () => {
    const src = read(SEED_REL);
    const waterPlantAt = src.indexOf("seedWaterPlantDemo(");
    const mimicAt = src.indexOf("seedWaterMimicDemo(");
    expect(waterPlantAt, "seed.ts must still call seedWaterPlantDemo(").toBeGreaterThan(-1);
    expect(
      mimicAt,
      "seed.ts must call seedWaterMimicDemo( — packages/db/src/water-mimic-demo-seed.ts",
    ).toBeGreaterThan(-1);
    expect(waterPlantAt, "seedWaterMimicDemo must be called after seedWaterPlantDemo").toBeLessThan(
      mimicAt,
    );
  });
});

describe("F3.32 v1 — the mimic-nodes read (U2)", () => {
  it("the mimic-nodes service interpolates GENERATED_LATEST_WINDOW_SQL once and MIMIC_HEADLINE_POINTS in its LIMIT", () => {
    if (!exists(MIMIC_NODES_SERVICE_REL)) {
      throw new Error(`${MIMIC_NODES_SERVICE_REL} does not exist — this repository's own layout changed.`);
    }
    const src = read(MIMIC_NODES_SERVICE_REL);
    // Interpolation sites only, never import lines: an import names the constant too, so a
    // bare-name count or `includes` passes with the constant imported and unused (the U2
    // report measured both gates passing on a literal `LIMIT 3` and a named import).
    expect(
      (src.match(/\$\{[\w.]*GENERATED_LATEST_WINDOW_SQL\}/g) ?? []).length,
      "must interpolate GENERATED_LATEST_WINDOW_SQL exactly once (F3.68's literal window, never a bound now() - $n)",
    ).toBe(1);
    expect(
      /LIMIT\s+\$\{[\w.]*MIMIC_HEADLINE_POINTS\}/.test(src),
      "must bound its top-N read with LIMIT ${MIMIC_HEADLINE_POINTS}, not a literal 3",
    ).toBe(true);
  });

  // `F3.32c` / ADR 0081 decision 6 — the layout statements run on `FLEET_POOL`, which bypasses
  // RLS, so the organization predicate on each layout table IS the isolation (ADR 0043
  // Amendment 3). Every alias the service gives a `bms.mimic_layout*` table must be filtered by
  // `<alias>.organization_id = $n`.
  it("the mimic-nodes service filters every bms.mimic_layout* table it reads by organization_id", () => {
    const src = read(MIMIC_NODES_SERVICE_REL);
    const reads = [...src.matchAll(/bms\.(mimic_layout\w*)\s+(?:AS\s+)?([a-z]\w*)/g)].map((match) => ({
      table: match[1] as string,
      alias: match[2] as string,
    }));
    expect(
      [...new Set(reads.map((entry) => entry.table))].sort(),
      "the resolver must read the layout, its nodes and its pipes (plan D9, statements 1b and 1c)",
    ).toEqual(["mimic_layout_nodes", "mimic_layout_pipes", "mimic_layouts"]);
    const unfiltered = reads.filter(
      (entry) => !new RegExp(`\\b${entry.alias}\\.organization_id\\s*=\\s*\\$\\d`).test(src),
    );
    expect(unfiltered, "each alias must carry an organization_id = $n predicate").toEqual([]);
  });

  it("the controller declares :id/mimic-nodes before :slug", () => {
    if (!exists(CONTROLLER_REL)) {
      throw new Error(`${CONTROLLER_REL} does not exist — this repository's own layout changed`);
    }
    const src = read(CONTROLLER_REL);
    // Decorators at the start of a line only. A bare `indexOf("mimic-nodes")` finds the import
    // path above every route, and a bare `indexOf('@Get(":slug")')` finds the docblocks that
    // name the ordering rule — either passes whatever the real order is.
    const decoratorAt = (route: string): number =>
      src.search(new RegExp(`^[ \\t]*@Get\\("${route}"\\)`, "m"));
    const mimicAt = decoratorAt(":id/mimic-nodes");
    if (mimicAt === -1) {
      throw new Error("no 'mimic-nodes' route found in dashboard-builder.controller.ts");
    }
    const slugAt = decoratorAt(":slug");
    expect(slugAt, "the controller must still declare @Get(\":slug\")").toBeGreaterThan(-1);
    expect(
      mimicAt,
      "the mimic-nodes route must be declared before :slug, or NestJS's route-order matching " +
        "swallows it into the :slug param",
    ).toBeLessThan(slugAt);
  });
});
