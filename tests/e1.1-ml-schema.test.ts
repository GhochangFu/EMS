import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0157_ml_schema.sql";
const TAG = "0157_ml_schema";
const PREVIOUS_TAG = "0156_location_tariff_meters";
const TABLES = ["model_runs", "forecasts", "anomaly_scores"] as const;
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));
const flat = (): string => migration().replace(/\s+/g, " ");

const ownerBracket = (sql: string): string => {
  const start = sql.indexOf("SET ROLE bms_owner;");
  const end = sql.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return sql.slice(start, end);
};

/** One `CREATE POLICY tenant_isolation ON ml.<t> ...;` statement, whitespace-flattened. */
const policyFor = (table: string): string => {
  const f = flat();
  const start = f.indexOf(`CREATE POLICY tenant_isolation ON ml.${table} `);
  if (start < 0) throw new Error(`no tenant_isolation policy on ml.${table}`);
  return f.slice(start, f.indexOf(";", start));
};

/**
 * `E1.1` / ADR 0135 decisions 3 and 4, Amendment 2 — the static half of
 * migration `0157` (the `ml` schema and its three tenant tables). Plan
 * `docs/plans/e1.1-ml-serving-foundation.md` §6, T2.1.
 * `tests/e1.1-ml-schema.integration.test.ts` asserts what Postgres enforces.
 * Assertions inline (§4.6, top-level `tests/`).
 */
describe("E1.1 — ml schema (migration 0157)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(migration().length).toBeGreaterThan(3000);
    expect(migration().split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(20);
  });

  it("is the only migration numbered 0157", () => {
    const files = readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0157_"));
    expect(files).toEqual(["0157_ml_schema.sql"]);
  });

  it("registers 0157 in the journal right after 0156, above its when and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "0157 must have a journal entry, or drizzle never runs it").toBeDefined();
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

  it("creates the schema once, as the migrator, before one SET ROLE / RESET ROLE bracket, after lock_timeout", () => {
    const sql = migration();
    const create = sql.match(/CREATE SCHEMA IF NOT EXISTS ml AUTHORIZATION bms_owner;/g) ?? [];
    expect(create).toHaveLength(1);
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    const lock = sql.indexOf("SET LOCAL lock_timeout");
    const schema = sql.indexOf("CREATE SCHEMA IF NOT EXISTS ml");
    const role = sql.indexOf("SET ROLE bms_owner;");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(schema);
    expect(schema).toBeLessThan(role);
  });

  it("issues no role, extension, default-privilege, hypertable, retention or concurrent statement", () => {
    const sql = migration();
    for (const banned of [
      /\bCREATE ROLE\b/i,
      /\bALTER ROLE\b/i,
      /\bCREATE EXTENSION\b/i,
      /\bALTER DEFAULT PRIVILEGES\b/i,
      /\bcreate_hypertable\b/i,
      /\badd_retention_policy\b/i,
      /\bCONCURRENTLY\b/i,
    ]) {
      expect(sql, String(banned)).not.toMatch(banned);
    }
  });

  it("sets the schema-version marker and creates the three tables inside the bracket", () => {
    const owner = ownerBracket(migration());
    expect(owner).toContain("COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=1';");
    for (const table of TABLES) {
      expect(owner, table).toContain(`CREATE TABLE IF NOT EXISTS ml.${table} (`);
    }
  });

  it("forces row level security with an own-organization policy, USING and WITH CHECK, on every table", () => {
    const owner = ownerBracket(migration());
    for (const table of TABLES) {
      expect(owner, table).toContain(`ALTER TABLE ml.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(owner, table).toContain(`ALTER TABLE ml.${table} FORCE ROW LEVEL SECURITY;`);
      const drop = owner.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON ml.${table};`);
      const create = owner.indexOf(`CREATE POLICY tenant_isolation ON ml.${table}`);
      expect(drop, table).toBeGreaterThanOrEqual(0);
      expect(drop, table).toBeLessThan(create);
      const policy = policyFor(table);
      expect(policy).toMatch(new RegExp(`USING \\( ${OWN_ORG.replace(/[()|.*+?^$[\]\\]/g, "\\$&")} \\)`));
      expect(policy).toMatch(new RegExp(`WITH CHECK \\( ${OWN_ORG.replace(/[()|.*+?^$[\]\\]/g, "\\$&")} \\)`));
      expect(policy).not.toMatch(/\bOR\b/i);
      expect(policy).not.toMatch(/IS NULL/i);
    }
  });

  it("grants exactly USAGE and SELECT, INSERT to bms_fleet, and nothing to any other role", () => {
    // Case-sensitive: the keyword, not the word "grant" in the proof's messages.
    const grants = flat().match(/\bGRANT\b[^;]*;/g) ?? [];
    expect(grants).toEqual([
      "GRANT USAGE ON SCHEMA ml TO bms_fleet;",
      "GRANT SELECT, INSERT ON ml.model_runs, ml.forecasts, ml.anomaly_scores TO bms_fleet;",
    ]);
    for (const g of grants) {
      expect(g).not.toMatch(/\b(bms_tenant|bms_auth|bms_rollup|PUBLIC)\b/i);
      expect(g).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|ALL)\b/i);
    }
  });

  it("names every constraint and index the integration test and the proof rely on", () => {
    const owner = ownerBracket(migration());
    for (const name of [
      "model_runs_id_organization_id_key",
      "model_runs_status_check",
      "model_runs_config_hash_check",
      "model_runs_window_check",
      "model_runs_rows_written_check",
      "model_runs_outcome_check",
      "model_runs_org_started_idx",
      "forecasts_pkey",
      "forecasts_asset_id_organization_id_fkey",
      "forecasts_model_run_id_organization_id_fkey",
      "forecasts_horizon_bucket_check",
      "forecasts_quantiles_check",
      "forecasts_model_run_idx",
      "anomaly_scores_pkey",
      "anomaly_scores_asset_id_organization_id_fkey",
      "anomaly_scores_model_run_id_organization_id_fkey",
      "anomaly_scores_bucket_check",
      "anomaly_scores_score_check",
      "anomaly_scores_model_run_idx",
    ]) {
      expect(owner, name).toContain(name);
    }
  });

  it("keys anomaly_scores by run, so a re-run never overwrites (Amendment 2 ruling 4)", () => {
    expect(flat()).toContain(
      "CONSTRAINT anomaly_scores_pkey PRIMARY KEY (asset_id, bucket, detector, model_run_id)",
    );
  });

  it("checks whole hours in UTC, never in the session's zone (the 0150 lesson)", () => {
    const f = flat();
    expect(f).toContain("CHECK (horizon_bucket = date_trunc('hour', horizon_bucket, 'UTC'))");
    expect(f).toContain("CHECK (bucket = date_trunc('hour', bucket, 'UTC'))");
    expect(f).not.toMatch(/date_trunc\('hour', [a-z_]+\)/);
  });

  it("creates or alters nothing after RESET ROLE", () => {
    const sql = migration();
    const tail = sql.slice(sql.indexOf("RESET ROLE;"));
    expect(tail).not.toMatch(/\b(CREATE|ALTER) (TABLE|INDEX|POLICY|UNIQUE INDEX|SCHEMA)\b/);
    expect(tail).not.toMatch(/\bGRANT\b/);
  });
});
