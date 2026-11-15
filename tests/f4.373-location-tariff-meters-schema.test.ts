import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.373` / ADR 0134 Amendment 3 — migration `0156`, several billing meters on
 * one tariff mapping. Assertions inline (the `tests/f4.365-tariff-schema.test.ts`
 * model). What Postgres enforces is
 * `tests/f4.373-location-tariff-meters-schema.integration.test.ts`'s job.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => {
  const file = readdirSync(drizzleDir).find((f) => f.startsWith("0156_location_tariff_meters") && f.endsWith(".sql"));
  if (!file) throw new Error("no migration 0156_location_tariff_meters*.sql");
  return sqlOnly(readFileSync(join(drizzleDir, file), "utf8"));
};

type JournalEntry = { idx: number; when: number; tag: string };
const journal = (): JournalEntry[] =>
  (JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: JournalEntry[] }).entries;

const ORG_GUC = "nullif(current_setting('app.current_organization', true), '')::uuid";

describe("F4.373 — location_tariff_meters migration (static)", () => {
  const m = migration();

  it("is journaled right after 0155, strictly increasing, never ahead of the clock", () => {
    const entries = journal();
    const prev = entries.find((e) => e.tag === "0155_location_tariffs");
    const own = entries.find((e) => e.tag === "0156_location_tariff_meters");
    expect(prev && own).toBeTruthy();
    expect(own!.idx).toBe(prev!.idx + 1);
    expect(own!.when).toBeGreaterThan(prev!.when);
    expect(own!.when).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("creates the table inside SET ROLE bms_owner … RESET ROLE, with no GRANT", () => {
    const set = m.indexOf("SET ROLE bms_owner;");
    const reset = m.indexOf("RESET ROLE;");
    expect(set).toBeGreaterThanOrEqual(0);
    expect(set).toBeLessThan(reset);
    const create = m.indexOf("CREATE TABLE IF NOT EXISTS bms.location_tariff_meters");
    expect(create).toBeGreaterThan(set);
    expect(create).toBeLessThan(reset);
    expect(m).not.toMatch(/\bGRANT\b/);
    expect(m).not.toMatch(/CREATE EXTENSION|CONCURRENTLY/);
  });

  it("keys the row on (location_tariff_id, asset_id), the mapping by a composite FK, the asset with a cascade", () => {
    expect(m).toContain("PRIMARY KEY (location_tariff_id, asset_id)");
    expect(m).toContain("organization_id uuid NOT NULL");
    expect(m).toContain("asset_id uuid NOT NULL REFERENCES bms.assets(id) ON DELETE CASCADE");
    expect(m).toMatch(
      /CONSTRAINT location_tariff_meters_mapping_fk FOREIGN KEY \(location_tariff_id, organization_id\)\s+REFERENCES bms\.location_tariffs \(id, organization_id\) ON DELETE CASCADE/,
    );
    // The referenced pair needs a unique key, added only when absent (idempotent).
    expect(m).toContain("ADD CONSTRAINT location_tariffs_id_org_key UNIQUE (id, organization_id)");
    expect(m).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE conname = 'location_tariffs_id_org_key'/);
  });

  it("enables and forces RLS with one tenant_isolation policy: own column AND asset leg, in USING and WITH CHECK", () => {
    expect(m).toContain("ALTER TABLE bms.location_tariff_meters ENABLE ROW LEVEL SECURITY;");
    expect(m).toContain("ALTER TABLE bms.location_tariff_meters FORCE ROW LEVEL SECURITY;");
    expect(m.split("CREATE POLICY tenant_isolation ON bms.location_tariff_meters").length - 1).toBe(1);
    const start = m.indexOf("CREATE POLICY tenant_isolation ON bms.location_tariff_meters");
    const block = m.slice(start, m.indexOf("RESET ROLE;", start));
    const [using, check] = block.split("WITH CHECK");
    for (const half of [using, check]) {
      expect(half).toContain(`organization_id = ${ORG_GUC}`);
      expect(half).toContain("a.id = location_tariff_meters.asset_id");
      expect(half).toContain(`a.organization_id = ${ORG_GUC}`);
    }
  });

  it("backfills every existing billing meter AFTER RESET ROLE, as a role that bypasses row security, idempotently", () => {
    const reset = m.indexOf("RESET ROLE;");
    const guard = m.indexOf("r.rolsuper OR r.rolbypassrls");
    const insert = m.indexOf("INSERT INTO bms.location_tariff_meters");
    expect(guard).toBeGreaterThan(reset);
    expect(insert).toBeGreaterThan(guard);
    expect(m.split("INSERT INTO").length - 1).toBe(1);
    expect(m).toMatch(
      /INSERT INTO bms\.location_tariff_meters \(location_tariff_id, organization_id, asset_id\)\s+SELECT id, organization_id, billing_meter_asset_id FROM bms\.location_tariffs\s+ON CONFLICT DO NOTHING;/,
    );
  });

  it("the Drizzle schema declares the table", () => {
    const schema = read("packages/db/src/schema/tariffs-schema.ts");
    expect(schema).toContain('bmsSchema.table(\n  "location_tariff_meters"');
    expect(schema).toContain('uuid("location_tariff_id").notNull()');
  });
});
