import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Through the built subpath, as `tests/ingest-contracts.test.ts` does: the
// ingest host and the worker load `dist/ingest.js`, so that is what must agree
// with the seed.
const require_ = createRequire(import.meta.url);
const { MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, mqttPayloadFormatDefinitionSchema } = require_(
  "@bms/shared/ingest",
) as {
  MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION: unknown;
  mqttPayloadFormatDefinitionSchema: {
    safeParse(input: unknown):
      | { success: true; data: { kind: string } }
      | { success: false; error: { issues: unknown[] } };
  };
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0130_mqtt_payload_formats.sql";
const TAG = "0130_mqtt_payload_formats";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The JSON literal of the seeded row whose code is `code`. */
const seededDefinition = (code: string): unknown => {
  const migration = sqlOnly(read(MIGRATION_REL));
  const from = migration.indexOf(`('${code}'`);
  expect(from, `the seed row for ${code} must exist`).toBeGreaterThanOrEqual(0);
  const literal = /'(\{.*?\})'::jsonb/s.exec(migration.slice(from));
  expect(literal, `the seed row for ${code} must carry a jsonb literal`).not.toBeNull();
  return JSON.parse(literal?.[1] ?? "null");
};

/**
 * `F4.334` / ADR 0116 decisions 1, 2 and 9 — the static half of migration `0130`
 * (`bms.mqtt_payload_formats`). What Postgres enforces is owed to the local
 * stack (the PR body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.334 — bms.mqtt_payload_formats (migration 0130)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    // SET ROLE, CREATE, INSERT, REVOKE, RESET ROLE, and the DO block's own
    // seven `;`-terminated pieces (three RAISEs, three END IFs, the END).
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBe(12);
  });

  it("registers migration 0130 in the journal as idx 131, after 0129 and not ahead of now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0129_dashboard_widget_sources_energy_cost_keys");
    expect(entry, "migration 0130 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(prev?.when).toBe(1794073157283);
    expect(entry?.idx).toBe(131);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("creates the table idempotently inside SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const create = migration.indexOf("CREATE TABLE IF NOT EXISTS bms.mqtt_payload_formats (");
    const revoke = migration.indexOf("REVOKE INSERT, UPDATE, DELETE ON bms.mqtt_payload_formats FROM bms_tenant;");
    const reset = migration.indexOf("RESET ROLE;");
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(setRole);
    expect(revoke).toBeGreaterThan(create);
    expect(reset).toBeGreaterThan(revoke);
    expect(migration).toContain("code varchar(64) NOT NULL UNIQUE");
    expect(migration).toContain("definition jsonb NOT NULL");
    expect(migration).toContain("builtin boolean NOT NULL DEFAULT false");
  });

  it("seeds exactly the two rows, without reverting a later edit", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/\bINSERT INTO\b/gi)).toHaveLength(1);
    expect(migration.match(/^\s*\('[a-z-]+',/gm)).toEqual([
      "  ('thinkiot-envelope',",
      "  ('thinkiot-register-array',",
    ]);
    expect(migration).toMatch(/\)\s*ON CONFLICT DO NOTHING;/);
  });

  it("seeds definitions the shared schema accepts (seed and schema cannot drift)", () => {
    expect(seededDefinition("thinkiot-envelope")).toEqual(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION);
    const bcpl = mqttPayloadFormatDefinitionSchema.safeParse(seededDefinition("thinkiot-register-array"));
    expect(bcpl.success, JSON.stringify("error" in bcpl ? bcpl.error.issues : null)).toBe(true);
    expect(bcpl.success && bcpl.data.kind).toBe("declarative");
  });

  it("issues no GRANT, no POLICY and no ROW LEVEL SECURITY (a platform catalog, plan Q1)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bPOLICY\b/i);
    expect(migration).not.toMatch(/\bROW LEVEL\b/i);
  });

  it("proves bms_tenant SELECT-only and bms_fleet read and write", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const verb of ["INSERT", "UPDATE", "DELETE", "SELECT"]) {
      expect(migration).toContain(`has_table_privilege('bms_tenant', 'bms.mqtt_payload_formats', '${verb}')`);
      expect(migration).toContain(`has_table_privilege('bms_fleet', 'bms.mqtt_payload_formats', '${verb}')`);
    }
  });

  it("declares the Drizzle table with its nine columns", () => {
    const schema = read("packages/db/src/schema/bms-schema.ts");
    const from = schema.indexOf('export const mqttPayloadFormats = bmsSchema.table("mqtt_payload_formats", {');
    expect(from).toBeGreaterThanOrEqual(0);
    const table = schema.slice(from, schema.indexOf("\n});", from));
    for (const column of [
      'id: uuid("id").primaryKey().defaultRandom()',
      'code: varchar("code", { length: 64 }).notNull().unique()',
      'name: varchar("name", { length: 128 }).notNull()',
      'description: text("description").notNull().default("")',
      'definition: jsonb("definition").notNull()',
      'builtin: boolean("builtin").notNull().default(false)',
      'createdAt: timestamp("created_at"',
      'updatedAt: timestamp("updated_at"',
      'updatedBy: uuid("updated_by")',
    ]) {
      expect(table).toContain(column);
    }
  });

  it("no seed writes mqtt_payload_formats, so a re-seed never reverts an admin edit", () => {
    const dir = join(repoRoot, "packages/db/src");
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    const mentions = (needle: string) =>
      sources.filter((f) => readFileSync(join(dir, f), "utf8").includes(needle));
    // Positive control: the scan reaches the seeds (the demo seed names location_types).
    expect(mentions("location_types").length).toBeGreaterThan(0);
    expect(mentions("mqtt_payload_formats")).toEqual([]);
  });
});
