import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0117_trend_points.sql";
const TAG = "0117_trend_points";
const TABLE = "org_trend_points";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;
const tsOnly = (source: string): string => source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

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

/** One column declaration, from its marker to the next comma. */
const columnLine = (migration: string, marker: string): string => {
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error(`no column declaration starting ${marker}`);
  const end = migration.indexOf(",", start);
  if (end < 0) throw new Error(`unterminated column declaration ${marker}`);
  return migration.slice(start, end);
};

/**
 * `F4.300` / ADR 0108 decision 3 — the static half of migration `0117`
 * (`point_keys.trend_default`, `bms.org_trend_points`, the tenant trigger).
 * `tests/f4.300-trend-points-schema.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 *
 * The seed-side pins (`TREND_DEFAULT_SEED` codes exist in the shared arrays;
 * `seed.ts` calls `seedPointKeyTrendDefaults(` after the headline ranks) live in
 * `tests/f4.300-point-key-trend-defaults-seed.integration.test.ts` (U4), which
 * owns the module and the seed call they scan.
 */
describe("F4.300 — bms.org_trend_points and point_keys.trend_default (migration 0117)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.length).toBeGreaterThan(1000);
    // Anti-vacuity: more than 8 statements.
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(8);
  });

  it("registers migration 0117 in the journal, after 0116 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0117 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(118);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0116's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1792876548423);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("adds trend_default as a nullable boolean (C2: tri-state, no NOT NULL)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const line = migration.split("\n").find((l) => l.includes("ADD COLUMN IF NOT EXISTS trend_default boolean"));
    expect(line, "ADD COLUMN IF NOT EXISTS trend_default boolean must exist").toBeDefined();
    expect(line).not.toMatch(/NOT\s+NULL/i);
    expect(line).not.toMatch(/\bDEFAULT\b/i);
  });

  it("creates the table and enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
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
  });

  it("the primary key is (organization_id, domain, point_key)", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("PRIMARY KEY (organization_id, domain, point_key)");
  });

  it("domain and point_key are foreign keys with no ON DELETE clause (C9)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const [marker, target] of [
      ["domain varchar(64) NOT NULL", "bms.asset_domains(code)"],
      ["point_key varchar(128) NOT NULL", "bms.point_keys(code)"],
    ] as const) {
      const line = columnLine(migration, marker);
      expect(line).toContain("REFERENCES");
      expect(line).toContain(target);
      expect(line).not.toContain("ON DELETE");
    }
  });

  it("creates no index beyond the primary key", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it("the trigger function is SECURITY INVOKER and refuses a tenant's non-NULL trend_default with 42501", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const start = migration.indexOf("FUNCTION bms.point_keys_refuse_tenant_trend_default()");
    expect(start, "the trigger function must exist").toBeGreaterThanOrEqual(0);
    const end = migration.indexOf("$$;", migration.indexOf("$$", start) + 2);
    const fn = migration.slice(start, end);
    expect(fn).toContain("SECURITY INVOKER");
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("current_user = 'bms_tenant'");
    expect(fn).toContain("NEW.trend_default IS NOT NULL");
    expect(fn).toContain("ERRCODE = '42501'");
    expect(migration).toContain("BEFORE INSERT ON bms.point_keys");
  });

  it("declares the Drizzle table, exports it, and mirrors the nullable column", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./trend-points-schema";');
    expect(read("packages/db/src/schema/trend-points-schema.ts")).toContain(`bmsSchema.table("${TABLE}"`);
    const bms = tsOnly(read("packages/db/src/schema/bms-schema.ts"));
    const line = bms.split("\n").find((l) => l.includes('trendDefault: boolean("trend_default")'));
    expect(line, "pointKeys must hold trendDefault").toBeDefined();
    expect(line).not.toContain(".notNull()");
  });

  it("lists org_trend_points in the FORCED_TABLES of the owner-RLS spec", () => {
    expect(read("apps/api/src/database/bms-owner-rls.integration.spec.ts")).toContain('"org_trend_points"');
  });

  it("C1 pin: every keysForDomain domain is a seeded asset_domains code", () => {
    const seeded = new Set<string>();
    const m29 = read("packages/db/drizzle/0029_rule_category_concern_asset_domain.sql");
    const block = m29.slice(m29.indexOf("INSERT INTO bms.asset_domains"));
    for (const row of block.slice(0, block.indexOf(";")).matchAll(/\('([a-z_]+)'\s*,/g)) seeded.add(row[1] as string);
    const packs = read("packages/db/src/asset-domains-seed.ts");
    const packBlock = packs.slice(packs.indexOf("PACK_ASSET_DOMAINS: readonly"));
    for (const row of packBlock.slice(0, packBlock.indexOf("];")).matchAll(/code:\s*"([a-z_]+)"/g)) {
      seeded.add(row[1] as string);
    }
    // Anti-vacuity: the five 0029 codes plus the two pack codes at least.
    expect(seeded.size).toBeGreaterThanOrEqual(7);

    const domains = new Set<string>();
    const seed = tsOnly(read("packages/db/src/point-keys-seed.ts"));
    for (const call of seed.matchAll(/keysForDomain\(([\s\S]*?)\)\s*,/g)) {
      const quoted = [...(call[1] as string).matchAll(/"([a-z_]+)"/g)];
      const last = quoted[quoted.length - 1];
      if (last) domains.add(last[1] as string);
    }
    expect(domains.size).toBeGreaterThanOrEqual(7);
    for (const d of domains) {
      expect(seeded.has(d), `keysForDomain domain "${d}" is not a seeded asset_domains code`).toBe(true);
    }
  });
});
